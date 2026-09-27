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

  let failed = 0;
  for (const [name, fn] of cases) {
    let ok = false;
    try { ok = fn() === true; } catch { ok = false; }
    console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}`);
    if (!ok) failed++;
  }
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
  try {
    const since = new Date(Date.now() - days * 86400000);
    const rows = await prisma.$queryRawUnsafe(
      `SELECT DISTINCT protocolId, symbol FROM score_snapshot WHERE snappedAt >= ?`,
      since,
    );
    evidence = rows.map((r) => ({ protocolId: String(r.protocolId), symbol: String(r.symbol).toUpperCase() }));
  } catch (err) {
    // ⚠️ A guard that cannot read its input must ERROR, never pass.
    console.error(`✖ could not read score_snapshot evidence — ${err.message}`);
    await prisma.$disconnect();
    process.exit(2);
  }

  const symbols = [...new Set(evidence.map((e) => e.symbol))];
  console.log(`[symbol-protocol-authority] evidence window: last ${days} day(s)`);
  console.log(`[symbol-protocol-authority] ${evidence.length} scored pair(s) across ${symbols.length} symbol(s)`);

  const authorityBySymbol = new Map();
  const unresolvedFindings = [];
  let unreachable = 0;

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

  if (orphans.length) {
    console.error('\n✖ SCORED, BUT NOT REACHABLE VIA THE AUTHORITY (#926):');
    for (const o of orphans) console.error(`  ${o.symbol} / ${o.protocolId} — ${o.why}`);
  }
  if (unresolvedFindings.length) {
    console.error('\n✖ UNRESOLVED ASSOCIATIONS — a row points at a protocol that does not exist:');
    for (const u of unresolvedFindings) console.error(`  ${u}`);
  }
  if (unreachable) {
    console.error(`\n✖ ${unreachable} symbol(s) could not be resolved because the API did not answer.`);
    console.error('  This is NOT evidence of no orphans — it is the absence of evidence either way.');
  }

  await prisma.$disconnect();

  if (orphans.length || unresolvedFindings.length || unreachable) {
    console.error(
      `\n[FAIL] ${orphans.length} orphan(s), ${unresolvedFindings.length} unresolved, ${unreachable} unreachable.`,
    );
    process.exit(1);
  }
  console.log(
    `\n[symbol-protocol-authority] ✅ OK — all ${evidence.length} scored pair(s) are reachable via the authority`,
  );
})().catch((err) => {
  console.error(`[FAIL] ${err.message}`);
  process.exit(2);
});
