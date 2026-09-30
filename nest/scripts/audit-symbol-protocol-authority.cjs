#!/usr/bin/env node
/**
 * audit-symbol-protocol-authority.cjs — #926 criterion 2.
 *
 * "For every protocol in `protocol_score_status` with `state=scoring`, that protocol is reachable
 *  from the symbol(s) it scores via the authority."
 *
 * HOW IT CHECKS, AND WHY THIS WAY
 * -------------------------------
 * The authority lives in `SymbolProtocolAuthorityService` (TypeScript). This script does NOT
 * re-implement its resolution — a second implementation of the very question #926 is about would
 * be the bug, not the guard. Instead it:
 *
 *   1. reads EVIDENCE from the database — the (protocolId, symbol) pairs that `score_snapshot`
 *      proves actually happened;
 *   2. asks the LIVE API (`GET /api/symbols/:symbol/protocols`), which reads the real authority;
 *   3. fails when evidence exists that the authority does not report.
 *
 * ⚠️ It needs the API running, so it is ON DEMAND by design and is NOT wired into `prebuild`.
 * Every `prebuild` validator in this repo is static and reads no database; adding a live,
 * DB-reading check there would make the build fail for reasons unrelated to the change being
 * built. Same convention as the `db:*` / `audit:*` family.
 *
 * ⚠️ A pairing that the authority CANNOT resolve is reported as `unresolved` by the API itself.
 * This script treats those as findings too, because an association pointing at a protocol that
 * does not exist is drift, and the whole point of #926 is that drift was invisible.
 *
 * USAGE
 *   node nest/scripts/audit-symbol-protocol-authority.cjs
 *   node nest/scripts/audit-symbol-protocol-authority.cjs --days 7
 *   node nest/scripts/audit-symbol-protocol-authority.cjs --self-test
 */

const http = require('http');
// ⚠️ THE SHARED HARNESS (#1032). Path reaches OUT of nest/ to the repo's scripts/lib, because the
// canonical harness is single-sourced there and a second copy under nest/ is the defect itself.
const { runCases } = require('../../scripts/lib/validator-helpers.cjs');

/** Pure: which evidence pairs the authority failed to account for. Self-testable. */
function findOrphans(evidencePairs, authorityBySymbol) {
  const orphans = [];
  for (const { symbol, protocolId } of evidencePairs) {
    const answer = authorityBySymbol.get(symbol);
    // No answer at all for a symbol that has scored => it is not in the authority's reach.
    if (!answer) {
      orphans.push({ symbol, protocolId, why: 'symbol had no authority answer' });
      continue;
    }
    if (!answer.protocolIds.has(protocolId)) {
      orphans.push({ symbol, protocolId, why: 'scored, but not listed by the authority' });
    }
  }
  return orphans;
}

/** Pure: the identity a GET response exposes, for set comparison. */
function protocolIdsOf(responseBody) {
  const ids = new Set();
  for (const p of responseBody?.protocols || []) {
    // ⚠️ The endpoint's public field is `id`; `protocolId` is the internal name. Reading the wrong
    // one yields an EMPTY set and therefore a silent, total false PASS — so the field is asserted.
    if (p && typeof p.id === 'string') ids.add(p.id);
  }
  return ids;
}

// ─────────────────────────────────────────────────────────────────── self-test ──
if (process.argv.includes('--self-test')) {
  const cases = [];
  const t = (name, fn) => cases.push([name, fn]);

  const authority = (map) =>
    new Map(Object.entries(map).map(([k, v]) => [k, { protocolIds: new Set(v) }]));

  t('a scored pair the authority omits is an ORPHAN', () =>
    findOrphans(
      [{ symbol: 'XAUUSD', protocolId: 'gold-macro-v1' }],
      authority({ XAUUSD: ['xau-speed-1h'] }),
    ).length === 1);

  t('a scored pair the authority lists is NOT an orphan', () =>
    findOrphans(
      [{ symbol: 'XAUUSD', protocolId: 'xau-speed-1h' }],
      authority({ XAUUSD: ['xau-speed-1h'] }),
    ).length === 0);

  t('a symbol with no authority answer at all is an ORPHAN', () =>
    findOrphans([{ symbol: 'ZZZZ', protocolId: 'p1' }], authority({ XAUUSD: ['p1'] })).length === 1);

  t('protocolIdsOf reads the PUBLIC `id` field', () =>
    protocolIdsOf({ protocols: [{ id: 'a' }, { id: 'b' }] }).size === 2);

  t('protocolIdsOf does NOT accept the internal `protocolId` name (would silently pass)', () =>
    protocolIdsOf({ protocols: [{ protocolId: 'a' }] }).size === 0);

  t('an empty response yields no ids, so every pair orphans', () =>
    findOrphans([{ symbol: 'X', protocolId: 'p' }], new Map([['X', { protocolIds: protocolIdsOf({}) }]]))
      .length === 1);

  t('a pair is not an orphan just because OTHER symbols omit it', () =>
    findOrphans(
      [{ symbol: 'USDCAD', protocolId: 'forex-session-v1' }],
      authority({ USDCAD: ['forex-session-v1'], XAUUSD: [] }),
    ).length === 0);

  // ⚠️ The harness is SHARED (#1032). The trailing line is kept because it states WHAT was proven
  // (both directions, on fixtures) — information the generic `n/m passed` summary does not carry.
  const failed = runCases(cases);
  console.log(failed === 0 ? '\nSELFTEST PASSED — both directions proven on fixtures' : `\nSELFTEST FAILED (${failed})`);
  process.exit(failed === 0 ? 0 : 1);
}

// ─────────────────────────────────────────────────────────────────── live run ──

/** GET JSON, with an explicit distinction between "not running" and "failed". */
function getJson(url) {
  return new Promise((resolve) => {
    const req = http.get(url, { timeout: 15000 }, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => {
        if (res.statusCode !== 200) return resolve({ ok: false, status: res.statusCode });
        try { resolve({ ok: true, body: JSON.parse(body) }); }
        catch (e) { resolve({ ok: false, status: `unparseable: ${e.message}` }); }
      });
    });
    req.on('error', (e) => resolve({ ok: false, status: `unreachable (${e.code || e.message})` }));
    req.on('timeout', () => { req.destroy(); resolve({ ok: false, status: 'timeout' }); });
  });
}

(async () => {
  const daysArg = process.argv.indexOf('--days');
  const days = daysArg > -1 ? Number(process.argv[daysArg + 1]) || 7 : 7;
  const API = process.env.TCS_API || 'http://localhost:3201';

  const { PrismaClient } = require('@prisma/client');
  const prisma = new PrismaClient();

  let evidence = [];
  let scoringNow = new Set();
  try {
    const since = new Date(Date.now() - days * 86400000);
    const rows = await prisma.$queryRawUnsafe(
      `SELECT DISTINCT protocolId, symbol FROM score_snapshot WHERE snappedAt >= ?`,
      since,
    );
    evidence = rows.map((r) => ({ protocolId: String(r.protocolId), symbol: String(r.symbol).toUpperCase() }));

    // ⚠️ Criterion 2 is worded about protocols that are CURRENTLY TICKING
    // (`protocol_score_status.state = 'scoring'`). That set is what makes a finding actionable:
    // a protocol the pipeline believes it is scoring right now, which the authority cannot
    // account for, is current incoherence. A single row left behind by a long-deleted protocol is
    // historical drift with a different fix and a different owner — see the report split below.
    const scoringRows = await prisma.$queryRawUnsafe(
      `SELECT protocolId FROM protocol_score_status WHERE state = 'scoring'`,
    );
    scoringNow = new Set(scoringRows.map((r) => String(r.protocolId)));
  } catch (err) {
    // ⚠️ A guard that cannot read its input must ERROR, never pass.
    console.error(`✖ could not read score_snapshot evidence — ${err.message}`);
    await prisma.$disconnect();
    process.exit(2);
  }

  console.log(`[symbol-protocol-authority] evidence window: last ${days} day(s)`);
  console.log(`[symbol-protocol-authority] ${evidence.length} scored pair(s) across ${new Set(evidence.map((e) => e.symbol)).size} symbol(s)`);
  console.log(`[symbol-protocol-authority] ${scoringNow.size} protocol(s) report state=scoring`);

  const authorityBySymbol = new Map();
  const unresolvedFindings = [];
  let unreachable = 0;

  const symbols = [...new Set(evidence.map((e) => e.symbol))];

  for (const symbol of symbols) {
    const res = await getJson(`${API}/api/symbols/${symbol}/protocols`);
    if (!res.ok) {
      // "Could not ask" is NOT "no orphans" — said out loud, and it fails below.
      unreachable++;
      console.log(`  ?? ${symbol}: authority unreachable — ${res.status}`);
      continue;
    }
    authorityBySymbol.set(symbol, { protocolIds: protocolIdsOf(res.body) });
    for (const u of res.body.unresolved || []) {
      unresolvedFindings.push(`${symbol}: ${u.id} (from ${u.from})`);
    }
  }

  const orphans = findOrphans(evidence, authorityBySymbol);

  // ⚠️ Split by ACTIONABILITY, measured 2026-09-27 after the first run mixed the two and went red
  // on data that ended in AUGUST.
  //
  // FATAL — a pair scored inside the window whose protocol reports `state='scoring'` and which the
  // authority cannot reach. That is criterion 2, verbatim, and it is current incoherence.
  //
  // NOTE — everything else: a protocol row that no longer exists (deleting a protocol orphans its
  // `score_snapshot` history — `cad-sniper-v1` 4,237 rows ending 2026-08-03; `default-short` 112
  // ending 2026-08-19) and a pair scored by a protocol that is no longer ticking. Real drift, but
  // failing on it would make this guard red from birth and therefore ignored — the failure mode the
  // repo warns about. Reported, counted, and it owns its own issue.
  const fatal = orphans.filter((o) => scoringNow.has(o.protocolId));
  const historical = orphans.filter((o) => !scoringNow.has(o.protocolId));

  if (fatal.length) {
    console.error("\n✖ SCORING NOW, BUT NOT REACHABLE VIA THE AUTHORITY (#926 criterion 2):");
    for (const o of fatal) console.error(`  ${o.symbol} / ${o.protocolId} — ${o.why}`);
  }
  if (historical.length) {
    console.error(
      `\n⚠️  ${historical.length} pair(s) scored in the window by a protocol that is NOT currently ` +
        'ticking and that the authority cannot resolve — historical, not fatal:',
    );
    for (const o of historical.slice(0, 6)) console.error(`  ${o.symbol} / ${o.protocolId}`);
    if (historical.length > 6) console.error(`  … and ${historical.length - 6} more`);
  }
  if (unresolvedFindings.length) {
    console.error(
      `\n⚠️  ${unresolvedFindings.length} all-time association(s) point at a protocol row that no longer ` +
        'exists — HISTORICAL, not fatal (deleting a protocol orphans its score history):',
    );
    for (const u of unresolvedFindings.slice(0, 8)) console.error(`  ${u}`);
    if (unresolvedFindings.length > 8) {
      console.error(`  … and ${unresolvedFindings.length - 8} more`);
    }
  }
  if (unreachable) {
    console.error(`\n✖ ${unreachable} symbol(s) could not be resolved because the API did not answer.`);
    console.error('  This is NOT evidence of no orphans — it is the absence of evidence either way.');
  }

  await prisma.$disconnect();

  // Only CURRENT incoherence and an unreachable API are fatal.
  if (fatal.length || unreachable) {
    console.error(
      `\n[FAIL] ${fatal.length} currently-scoring orphan(s), ${unreachable} unreachable.` +
        (historical.length || unresolvedFindings.length
          ? ` (${historical.length + unresolvedFindings.length} historical finding(s) NOT counted.)`
          : ''),
    );
    process.exit(1);
  }
  console.log(
    `\n[symbol-protocol-authority] ✅ OK — every pair scored in the last ${days} day(s) by a ` +
      `currently-scoring protocol is reachable via the authority` +
      (historical.length || unresolvedFindings.length
        ? ` (${historical.length + unresolvedFindings.length} historical finding(s) reported above, not fatal.)`
        : ''),
  );
})().catch((err) => {
  console.error(`[FAIL] ${err.message}`);
  process.exit(2);
});
