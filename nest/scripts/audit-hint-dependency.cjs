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

(async () => {
  const prisma = new PrismaClient();
  try {
    // ── Load every protocol ───────────────────────────────────────────────
    const protocols = await prisma.$queryRawUnsafe(
      `SELECT id, slug, name, active FROM protocol ORDER BY active DESC, slug ASC`,
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
      let verdict;
      if (relational.length === 0 && viaHints.length > 0) verdict = 'HINT_ONLY';
      else if (relational.length === 0 && viaHints.length === 0) verdict = 'UNRESOLVED';
      else if (hintOnly.length > 0) verdict = 'HINT_ADDS';
      else verdict = 'RELATIONSHIP_ONLY';

      rows.push({
        slug: p.slug,
        active: Number(p.active) === 1,
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
    console.log('\n── SUMMARY ──');
    if (blockers.length === 0) {
      console.log('  ✅ No ACTIVE protocol depends on the hint tables.');
      console.log('     SINGLE_SYMBOL_HINTS and WATCHLIST_HINTS can be removed without changing');
      console.log('     any active protocol\'s symbol set.');
    } else {
      console.log(`  ⚠️  ${blockers.length} ACTIVE protocol(s) depend on the hint tables:`);
      for (const r of blockers) console.log(`       ${r.verdict.padEnd(16)} ${r.slug}`);
      console.log('     Wire each onto a watchlist FK (or an assignment) before removing the hints.');
    }

    const inactiveHintOnly = rows.filter((r) => !r.active && r.verdict === 'HINT_ONLY');
    if (inactiveHintOnly.length) {
      console.log(`\n  ℹ️  ${inactiveHintOnly.length} INACTIVE protocol(s) also resolve only via hints — these would`);
      console.log('     resolve to nothing if activated while the hints are gone:');
      for (const r of inactiveHintOnly) console.log(`       ${r.slug.padEnd(24)} hintOnly=[${r.hintOnly.join(', ')}]`);
    }
    console.log('');
  } finally {
    await prisma.$disconnect();
  }
})().catch((err) => {
  console.error('[audit] failed:', err.message);
  process.exit(1);
});
