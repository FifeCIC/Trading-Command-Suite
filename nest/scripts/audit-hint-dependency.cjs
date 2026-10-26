#!/usr/bin/env node
/**
 * Audit which resolution path every protocol actually takes (#764).
 *
 * WHY
 * ---
 * `ProtocolDbService.resolveSymbols()` tries four paths in order:
 *
 *   0. symbol_protocol_assignment   (FK)      — a relationship
 *   1. watchlist.protocolId         (FK)      — a relationship
 *   2. SINGLE_SYMBOL_HINTS          (substring match on the protocol SLUG) — a GUESS
 *   3. WATCHLIST_HINTS              (substring match → watchlist NAME)     — a GUESS
 *
 * Paths 2 and 3 cannot be trusted: they go stale when a symbol or watchlist is renamed,
 * and they report nothing when they do. This script reports which protocols depend on
 * them, because that dependence is the ONLY thing blocking removal of the guess tables.
 *
 * WHAT "DEPENDS" MEANS
 * --------------------
 * A protocol depends on a hint if, with the hint tables empty, it would resolve to a
 * DIFFERENT (or empty) symbol set. So we compute both:
 *
 *   - symbolsViaRelationships : union of paths 0 and 1
 *   - symbolsViaHints         : union of paths 2 and 3
 *
 * and classify:
 *   RELATIONSHIP_ONLY  hints add nothing        → safe, hints removable for this protocol
 *   HINT_ONLY          no relationship at all   → MUST be wired before hints are removed
 *   HINT_ADDS         relationship exists but
 *                     hints contribute symbols → investigate; hints are masking a gap
 *
 * Usage:  node scripts/audit-hint-dependency.cjs [--json]
 */

const path = require('path');
const { PrismaClient } = require(path.join(__dirname, '..', 'node_modules', '@prisma', 'client'));

// Import the REAL hint tables from compiled output, so the audit cannot drift from the code.
let SINGLE_SYMBOL_HINTS, WATCHLIST_HINTS;
try {
  const mod = require(path.join(__dirname, '..', 'dist', 'src', 'modules', 'scoring', 'protocol-db.service.js'));
  SINGLE_SYMBOL_HINTS = mod.SINGLE_SYMBOL_HINTS;
  WATCHLIST_HINTS = mod.WATCHLIST_HINTS;
} catch (err) {
  console.error(`[audit] Could not load hint tables from dist/. Run \`npm run build\` first. (${err.message})`);
  process.exit(1);
}

/** Mirrors deriveSingleSymbolFromSlug(). */
function deriveSingleSymbol(slug) {
  const id = String(slug).toLowerCase();
  for (const h of SINGLE_SYMBOL_HINTS) if (id.includes(h.match)) return h.symbol;
  return null;
}

/** Mirrors the WATCHLIST_HINTS loop in deriveSymbolsFromId(). */
function deriveWatchlistName(slug) {
  const id = String(slug).toLowerCase();
  for (const h of WATCHLIST_HINTS) if (id.includes(h.match)) return h.watchlist;
  return null;
}

const norm = (a) => [...new Set(a.map((s) => String(s).toUpperCase()))].sort();

/**
 * Pure classifier, extracted so `--self-test` can prove it in both directions without a
 * database. Keeping the logic inline would make the only way to canary it a live run against
 * whatever the database happens to contain — which is not a canary, it is an observation.
 */
function classifyVerdict(relational, viaHints, hintOnly) {
  if (relational.length === 0 && viaHints.length > 0) return 'HINT_ONLY';
  if (relational.length === 0 && viaHints.length === 0) return 'UNRESOLVED';
  if (hintOnly.length > 0) return 'HINT_ADDS';
  return 'RELATIONSHIP_ONLY';
}

/**
 * A protocol that is ACTIVE but resolves no symbol by ANY path, and has not DECLARED itself
 * unwired, is a blocker. Extracted for the same reason as the classifier.
 *
 * The declared opt-out is not a loophole invented here: `contract-probe.cjs`
 * (INV-NO-SYMBOL-GUESSING) already honours this exact wording, and two guards that disagree
 * about the same exception are worse than one.
 */
function isDeclaredUnwired(note) {
  return /sandbox|intentionally not wired|not wired to live symbols/i.test(String(note || ''));
}

function isActiveUnresolvedBlocker(row) {
  return row.active && row.verdict === 'UNRESOLVED' && !isDeclaredUnwired(row.note);
}

// ── --self-test ───────────────────────────────────────────────────────────
// Proves the classifier and the blocker rule can FAIL, not merely that they run. An audit whose
// logic has never been observed to produce the wrong verdict is a decoration.
if (process.argv.includes('--self-test')) {
  const cases = [
    // [label, relational, viaHints, hintOnly, expected]
    ['no relationship, no hint → UNRESOLVED', [], [], [], 'UNRESOLVED'],
    ['no relationship, hint only → HINT_ONLY', [], ['BTC'], ['BTC'], 'HINT_ONLY'],
    ['relationship also in hints → RELATIONSHIP_ONLY', ['EURUSD'], ['EURUSD'], [], 'RELATIONSHIP_ONLY'],
    ['relationship plus an extra hinted symbol → HINT_ADDS', ['EURUSD'], ['EURUSD', 'GBPUSD'], ['GBPUSD'], 'HINT_ADDS'],
    ['relationship and hint are disjoint → HINT_ADDS', ['EURUSD'], ['GBPUSD'], ['GBPUSD'], 'HINT_ADDS'],
  ];
  let failed = 0;
  for (const [label, rel, hints, hintOnly, expected] of cases) {
    const actual = classifyVerdict(rel, hints, hintOnly);
    const ok = actual === expected;
    if (!ok) failed++;
    console.log(`  ${ok ? 'PASS' : 'FAIL'}  classify: ${label} → ${actual}${ok ? '' : ` (expected ${expected})`}`);
  }

  const blockerCases = [
    ['ACTIVE + UNRESOLVED + no note → BLOCKS', { active: true, verdict: 'UNRESOLVED', note: null }, true],
    ['ACTIVE + UNRESOLVED + parked note → BLOCKS', { active: true, verdict: 'UNRESOLVED', note: 'Parked 2026-08-20 — pending' }, true],
    ['ACTIVE + UNRESOLVED + declared sandbox → allowed', { active: true, verdict: 'UNRESOLVED', note: 'Sandbox protocol — intentionally not wired to live symbols.' }, false],
    ['INACTIVE + UNRESOLVED → allowed', { active: false, verdict: 'UNRESOLVED', note: null }, false],
    ['ACTIVE + HINT_ONLY → allowed by THIS rule', { active: true, verdict: 'HINT_ONLY', note: null }, false],
  ];
  for (const [label, row, expected] of blockerCases) {
    const actual = isActiveUnresolvedBlocker(row);
    const ok = actual === expected;
    if (!ok) failed++;
    console.log(`  ${ok ? 'PASS' : 'FAIL'}  blocker: ${label} → ${actual}${ok ? '' : ` (expected ${expected})`}`);
  }

  // Canary the canary: if the classifier were hardcoded to one answer, at least one case above
  // must disagree with it. Stated as an assertion so a future "simplification" that stubs the
  // classifier fails here rather than silently passing every case.
  const distinct = new Set(cases.map(([, r, h, ho]) => classifyVerdict(r, h, ho)));
  const canaryOk = distinct.size === 4;
  if (!canaryOk) failed++;
  console.log(`  ${canaryOk ? 'PASS' : 'FAIL'}  canary: classifier produces all 4 verdicts (got ${distinct.size})`);

  console.log(failed === 0 ? '\n✅ self-test passed' : `\n🛑 self-test FAILED (${failed})`);
  process.exit(failed === 0 ? 0 : 1);
}

(async () => {
  const prisma = new PrismaClient();
  try {
    // ── Load every protocol ───────────────────────────────────────────────
    const protocols = await prisma.$queryRawUnsafe(
      `SELECT id, slug, name, active, note FROM protocol ORDER BY active DESC, slug ASC`,
    );

    // ── Path 0: explicit symbol assignments (FK) ─────────────────────────
    const assignments = await prisma.$queryRawUnsafe(
      `SELECT protocolId, symbol FROM symbol_protocol_assignment`,
    );
    const assignsByProtocol = new Map();
    for (const a of assignments) {
      if (!assignsByProtocol.has(a.protocolId)) assignsByProtocol.set(a.protocolId, []);
      assignsByProtocol.get(a.protocolId).push(a.symbol);
    }

    // ── Path 1: watchlists linked by FK ──────────────────────────────────
    const linked = await prisma.$queryRawUnsafe(
      `SELECT protocolId, name, symbols FROM watchlist WHERE protocolId IS NOT NULL`,
    );
    const wlByProtocol = new Map();
    for (const w of linked) {
      let parsed;
      try { parsed = typeof w.symbols === 'string' ? JSON.parse(w.symbols) : w.symbols; } catch { continue; }
      if (!Array.isArray(parsed)) continue;
      const tickers = parsed
        .map((s) => (typeof s === 'string' ? s : s && (s.ticker || s.symbol)))
        .filter(Boolean);
      if (!wlByProtocol.has(w.protocolId)) wlByProtocol.set(w.protocolId, []);
      wlByProtocol.get(w.protocolId).push(...tickers);
    }

    // ── Path 3 support: named watchlists (unlinked, matched by name) ─────
    const allWatchlists = await prisma.$queryRawUnsafe(`SELECT name, symbols FROM watchlist`);
    const wlByName = new Map();
    for (const w of allWatchlists) {
      let parsed;
      try { parsed = typeof w.symbols === 'string' ? JSON.parse(w.symbols) : w.symbols; } catch { continue; }
      if (!Array.isArray(parsed)) continue;
      const tickers = parsed
        .map((s) => (typeof s === 'string' ? s : s && (s.ticker || s.symbol)))
        .filter(Boolean);
      // Same normalisation the resolver uses.
      const key = String(w.name).toLowerCase().replace(/[-_]/g, ' ');
      if (!wlByName.has(key)) wlByName.set(key, []);
      wlByName.get(key).push(...tickers);
    }

    // ── Classify ─────────────────────────────────────────────────────────
    const rows = [];
    for (const p of protocols) {
      const viaAssign = assignsByProtocol.get(p.id) || [];
      const viaWatchlist = wlByProtocol.get(p.id) || [];
      const relational = norm([...viaAssign, ...viaWatchlist]);

      const hints = [];
      const single = deriveSingleSymbol(p.slug);
      if (single) hints.push(single);
      const wlHintName = deriveWatchlistName(p.slug);
      if (wlHintName) {
        const key = String(wlHintName).toLowerCase().replace(/[-_]/g, ' ');
        const found = wlByName.get(key);
        if (found) hints.push(...found);
      }
      // The final fallback: a watchlist whose NAME equals the protocol slug.
      const slugAsWatchlist = wlByName.get(String(p.slug).toLowerCase().replace(/[-_]/g, ' '));
      if (slugAsWatchlist) hints.push(...slugAsWatchlist);
      const viaHints = norm(hints);

      const hintOnly = viaHints.filter((s) => !relational.includes(s));
      const verdict = classifyVerdict(relational, viaHints, hintOnly);

      rows.push({
        slug: p.slug,
        active: Number(p.active) === 1,
        note: p.note ?? null,
        relational,
        viaHints,
        hintOnly,
        verdict,
        single: single || null,
        wlHint: wlHintName || null,
      });
    }

    if (process.argv.includes('--json')) {
      console.log(JSON.stringify(rows, null, 2));
      return;
    }

    const active = rows.filter((r) => r.active);
    const byVerdict = (list) =>
      ['HINT_ONLY', 'HINT_ADDS', 'RELATIONSHIP_ONLY', 'UNRESOLVED']
        .map((v) => `${v}=${list.filter((r) => r.verdict === v).length}`)
        .join('  ');

    const show = (title, list) => {
      console.log(`\n── ${title} (${list.length}) ──`);
      for (const r of list) {
        const via = r.relational.length ? `rel=[${r.relational.join(', ')}]` : 'rel=[]';
        const hint = r.hintOnly.length ? ` hintOnly=[${r.hintOnly.join(', ')}]` : '';
        console.log(`  ${r.verdict.padEnd(18)} ${r.slug.padEnd(24)} ${via}${hint}`);
      }
    };

    console.log('\n[pipeline-contracts] hint-dependency audit (#764)');
    console.log(`\nACTIVE protocols: ${active.length}   ${byVerdict(active)}`);
    console.log(`ALL protocols:    ${rows.length}   ${byVerdict(rows)}`);

    show('ACTIVE — HINT_ONLY (no relationship; hints are the ONLY source)', active.filter((r) => r.verdict === 'HINT_ONLY'));
    show('ACTIVE — HINT_ADDS (relationship exists but hints add symbols)', active.filter((r) => r.verdict === 'HINT_ADDS'));
    show('ACTIVE — UNRESOLVED (no path produces any symbol)', active.filter((r) => r.verdict === 'UNRESOLVED'));

    const blockers = active.filter((r) => r.verdict === 'HINT_ONLY' || r.verdict === 'HINT_ADDS');
    // ── ACTIVE UNRESOLVED is a blocker too (2026-10-25) ──
    // BEFORE: only HINT_ONLY / HINT_ADDS counted. An ACTIVE protocol with NO relationship and
    //         NO hint (verdict UNRESOLVED) satisfied neither, so it was listed under a heading
    //         and then never mentioned again — and the summary printed
    //         "✅ No ACTIVE protocol depends on the hint tables" directly beneath it.
    // WHY THAT WAS WRONG: the sentence is TRUE and REASSURING while the protocol resolves to
    //         zero symbols and cannot score at all. Measured 2026-10-25: 1 ACTIVE protocol
    //         (`eurusd-macro-v1`) was in exactly that state and this script exited 0. A green
    //         line over a protocol that cannot run is the "plausible output, no error" shape.
    // A sandbox opt-out is honoured (the same regex contract-probe.cjs uses), because a guard
    // that fires on a DECLARED exception gets allowlisted, and an allowlisted guard is worse
    // than none.  → isDeclaredUnwired(), defined at module level so --self-test covers it.
    const activeUnresolved = active.filter((r) => r.verdict === 'UNRESOLVED');
    const activeUnresolvedUndeclared = activeUnresolved.filter((r) => !isDeclaredUnwired(r.note));
    const blockersAll = blockers.length + activeUnresolvedUndeclared.length;

    console.log('\n── SUMMARY ──');
    if (blockersAll === 0) {
      console.log('  ✅ No ACTIVE protocol depends on the hint tables.');
      console.log('     SINGLE_SYMBOL_HINTS and WATCHLIST_HINTS can be removed without changing');
      console.log('     any active protocol\'s symbol set.');
    } else {
      if (blockers.length) {
        console.log(`  ⚠️  ${blockers.length} ACTIVE protocol(s) depend on the hint tables:`);
        for (const r of blockers) console.log(`       ${r.verdict.padEnd(16)} ${r.slug}`);
        console.log('     Wire each onto a watchlist FK (or an assignment) before removing the hints.');
      }
      if (activeUnresolvedUndeclared.length) {
        console.log(`  🛑 ${activeUnresolvedUndeclared.length} ACTIVE protocol(s) resolve NO symbols by ANY path:`);
        for (const r of activeUnresolvedUndeclared) console.log(`       ${r.verdict.padEnd(16)} ${r.slug}`);
        console.log('     These cannot score at all. Either wire them, deactivate them, or declare');
        console.log('     the opt-out in the protocol\'s note (it must say "sandbox" or');
        console.log('     "intentionally not wired"). contract-probe.cjs INV-NO-SYMBOL-GUESSING fails on them.');
      }
    }
    if (activeUnresolved.length > activeUnresolvedUndeclared.length) {
      const declared = activeUnresolved.filter((r) => isDeclaredUnwired(r.note)).map((r) => r.slug);
      console.log(`\n  ℹ️  ${declared.length} ACTIVE protocol(s) are unwired by DECLARED intent: ${declared.join(', ')}`);
    }

    const inactiveHintOnly = rows.filter((r) => !r.active && r.verdict === 'HINT_ONLY');
    if (inactiveHintOnly.length) {
      console.log(`\n  ℹ️  ${inactiveHintOnly.length} INACTIVE protocol(s) also resolve only via hints — these would`);
      console.log('     resolve to nothing if activated while the hints are gone:');
      for (const r of inactiveHintOnly) console.log(`       ${r.slug.padEnd(24)} hintOnly=[${r.hintOnly.join(', ')}]`);
    }
    // ⚠️ INACTIVE + UNRESOLVED is reported, NOT gated. Measured 2026-10-25: 15 of them. They cost
    // nothing while inactive, but each one becomes an instant no-symbols protocol if someone
    // activates it — which is exactly how `eurusd-macro-v1` was found. Wiring them is a data
    // decision (which symbols should this protocol trade?), not a repair, so it is surfaced here
    // for a human and not turned into a build failure.
    const inactiveUnresolved = rows.filter((r) => !r.active && r.verdict === 'UNRESOLVED' && !isDeclaredUnwired(r.note));
    const inactiveDeclared = rows.filter((r) => !r.active && r.verdict === 'UNRESOLVED' && isDeclaredUnwired(r.note));
    if (inactiveUnresolved.length) {
      console.log(`\n  ℹ️  ${inactiveUnresolved.length} INACTIVE protocol(s) resolve NO symbols — harmless while`);
      console.log('     inactive, but they become unwired the moment they are activated:');
      console.log(`       ${inactiveUnresolved.map((r) => r.slug).join(', ')}`);
    }
    if (inactiveDeclared.length) {
      console.log(`\n  ℹ️  ${inactiveDeclared.length} INACTIVE protocol(s) are unwired by DECLARED intent: ${inactiveDeclared.map((r) => r.slug).join(', ')}`);
    }
    console.log('');

    // Exit 1 when an ACTIVE protocol cannot resolve a symbol by any path. Callers that gate on
    // this script (none today — it is on-demand) then cannot ignore it.
    if (activeUnresolvedUndeclared.length > 0 || blockers.length > 0) {
      console.log(`\n[audit] BLOCKED — ${blockersAll} ACTIVE protocol(s) need attention (see above).`);
      process.exitCode = 1;
    }
  } finally {
    await prisma.$disconnect();
  }
})().catch((err) => {
  console.error('[audit] failed:', err.message);
  process.exit(1);
});
