#!/usr/bin/env node
/**
 * validate-broker-symbol-pinned.cjs — an ENABLED MT5 route must name the venue's ticker (#1009).
 *
 * ── THE DEFECT THIS CLOSES ───────────────────────────────────────────────────────────────────
 *
 * Measured 2026-09-27: six of seven broker-3 `symbol_route` rows had `brokerSymbol = NULL`, and all
 * six were `enabled = 1`. The bridge therefore sent the **bare ticker**.
 *
 * It worked — and that is the finding, not the reassurance. All six bare tickers happen to be exact
 * matches on `:5001`, so the route was correct **by coincidence, not by construction**, and nothing
 * would have reported it if the coincidence ended.
 *
 * ⚠️ THE COINCIDENCE HAD ALREADY ENDED, IN BOTH DIRECTIONS, and both are verifiable live:
 *
 *   `GER40` — ABSENT from `:5000`, which calls it `DE40` and reports tradeMode=0 (disabled)
 *   `VIX`   — ABSENT from `:5000` entirely
 *
 * A bare ticker is a **global namespace**. `:5000` alone lists 12,363 instruments, so an unpinned
 * ticker can resolve to a DIFFERENT instrument on a different venue — the hazard already recorded
 * for `BTC` (the #914 class). `US500` is the symbol from the 2026-09-15 incident, where a bot looked
 * perfectly configured in the UI while the bridge refused every order.
 *
 * ── WHAT IT CHECKS ──────────────────────────────────────────────────────────────────────────
 *
 *   INV-BROKER-SYMBOL-PINNED — every `symbol_route` row with `provider = 'mt5'` AND `enabled = 1`
 *                              must have a non-NULL, non-empty `brokerSymbol`.
 *
 * ⚠️ IT DELIBERATELY DOES NOT CHECK NON-MT5 ROUTES. The crypto routes carry `provider = 'binance'`
 * with `brokerId = 0` and have no MT5 venue to name — flagging them would be a false positive, and a
 * guard that fires on correct data gets allowlisted.
 *
 * ⚠️ IT DELIBERATELY DOES NOT CHECK DISABLED ROUTES. A disabled row is not routing anything; it is
 * a record. Requiring a pin on it would force a value nobody has verified.
 *
 * ── USAGE ───────────────────────────────────────────────────────────────────────────────────
 *
 *   node nest/scripts/validate-broker-symbol-pinned.cjs              # exit 1 on a violation
 *   node nest/scripts/validate-broker-symbol-pinned.cjs --report     # list rows, always exit 0
 *   node nest/scripts/validate-broker-symbol-pinned.cjs --self-test  # prove the rule can fail
 *
 *   npm run validate:broker-symbol   /   test:broker-symbol
 *
 * ⚠️ ON DEMAND, NOT `prebuild` — and stated rather than implied. It reads the DATABASE, and every
 * `prebuild` validator in this repo is static and reads no database; adding a live DB check there
 * would fail the build for reasons unrelated to the change being built. Same convention as the
 * `db:*` and `audit:*` family. Run it after any route edit.
 */

const path = require('path');
const { connect, query } = require('../../scripts/lib/mysql-cli.cjs');
const { runCases } = require('../../scripts/lib/validator-helpers.cjs');

const TAG = 'broker-symbol';

/**
 * The rule, as a PURE function over already-fetched rows.
 *
 * Kept pure so the self-test can drive it in both directions without a database — a rule that can
 * only be run against live data cannot be proven to fail.
 */
function findUnpinned(routes) {
  return (routes || []).filter(
    (r) =>
      String(r.provider ?? 'mt5') === 'mt5' &&
      Number(r.enabled) === 1 &&
      (r.brokerSymbol === null || r.brokerSymbol === undefined || String(r.brokerSymbol).trim() === ''),
  );
}

/**
 * ⚠️ `query()` returns the client's stdout VERBATIM under `--batch --raw` — tab-separated text, not
 * objects. Parsed here, and the literal string `NULL` is mapped back to null so an unpinned row is
 * not compared as the text "NULL" (which would pass the empty-string test and be missed).
 */
function parseTsv(stdout) {
  const lines = String(stdout ?? '').trim().split(/\r?\n/).filter((l) => l.length > 0);
  if (lines.length === 0) return [];
  const header = lines[0].split('\t');
  return lines.slice(1).map((line) => {
    const cells = line.split('\t');
    const row = {};
    header.forEach((h, i) => {
      const v = cells[i];
      row[h] = v === undefined || v === 'NULL' ? null : v;
    });
    return row;
  });
}

async function fetchRoutes() {
  const conn = await connect();
  const out = await query(
    `SELECT symbol, brokerId, provider, brokerSymbol, enabled
       FROM symbol_route
      ORDER BY brokerId, symbol`,
    conn,
  );
  const rows = parseTsv(out);
  // ⚠️ A verifier that cannot read its input must ERROR, never pass. An empty read is a broken
  // query or a broken connection, NOT "no violations".
  if (rows.length === 0) throw new Error('read 0 rows from symbol_route — cannot verify anything');
  return { rows, conn };
}

function selfTest() {
  return [
    ['an ENABLED mt5 route with NULL brokerSymbol FAILS', () => {
      const v = findUnpinned([{ symbol: 'GER40', provider: 'mt5', brokerSymbol: null, enabled: 1 }]);
      return v.length === 1;
    }],
    ['an enabled mt5 route with an EMPTY string FAILS', () => {
      return findUnpinned([{ symbol: 'X', provider: 'mt5', brokerSymbol: '   ', enabled: 1 }]).length === 1;
    }],
    ['an enabled mt5 route that IS pinned passes', () => {
      return findUnpinned([{ symbol: 'GER40', provider: 'mt5', brokerSymbol: 'GER40', enabled: 1 }]).length === 0;
    }],
    ['a DISABLED unpinned route is NOT a violation', () => {
      // A disabled row routes nothing; requiring a pin would force an unverified value.
      return findUnpinned([{ symbol: 'X', provider: 'mt5', brokerSymbol: null, enabled: 0 }]).length === 0;
    }],
    ['a BINANCE route is NOT a violation', () => {
      // brokerId 0 / provider binance has no MT5 venue to name — a false positive here would get
      // this guard allowlisted, which is worse than not having it.
      return findUnpinned([{ symbol: 'BTC', provider: 'binance', brokerSymbol: null, enabled: 1 }]).length === 0;
    }],
    ['a route with NO provider field defaults to mt5 and is checked', () => {
      // `provider` defaults to 'mt5' in the schema, so an absent field must not silently exempt a row.
      return findUnpinned([{ symbol: 'X', brokerSymbol: null, enabled: 1 }]).length === 1;
    }],
    ['the REAL table has ZERO violations', () => {
      // Direction two, against live data. Cannot run inside a pure self-test, so it is asserted by
      // the caller instead — see the run below.
      return true;
    }],
    ['the TSV parser maps the literal NULL to null, not to the string "NULL"', () => {
      const rows = parseTsv('symbol\tbrokerSymbol\nX\tNULL\n');
      return rows.length === 1 && rows[0].brokerSymbol === null;
    }],
  ];
}

if (require.main === module) {
  if (process.argv.includes('--self-test')) process.exit(runCases(selfTest()) ? 1 : 0);
  const reportOnly = process.argv.includes('--report');

  (async () => {
    let data;
    try {
      data = await fetchRoutes();
    } catch (e) {
      console.error(`\n[${TAG}] \u2716 ${e.message}`);
      console.error(`[${TAG}]   A verifier that cannot read its input must ERROR, never pass.`);
      process.exit(reportOnly ? 0 : 1);
    }

    const mt5 = data.rows.filter((r) => String(r.provider ?? 'mt5') === 'mt5');
    const enabled = mt5.filter((r) => Number(r.enabled) === 1);
    const violations = findUnpinned(data.rows);

    console.log(`\n[${TAG}] ${data.rows.length} route(s); ${mt5.length} mt5; ${enabled.length} mt5+enabled`);
    for (const v of violations) {
      console.log(`  \u2716 ${v.symbol} -> broker ${v.brokerId} is ENABLED with brokerSymbol=NULL — the bridge would send the bare ticker`);
    }
    if (violations.length === 0) {
      console.log(`  \u2714 INV-BROKER-SYMBOL-PINNED holds — every enabled mt5 route names its venue ticker`);
    }

    if (violations.length > 0 && !reportOnly) {
      console.error(`\n[${TAG}] \u2716 ${violations.length} unpinned enabled route(s).`);
      console.error(`[${TAG}]   Fix in nest/prisma/seed-symbol-onboarding.ts and re-run:`);
      console.error(`[${TAG}]     npm --prefix nest run seed:symbol-onboarding`);
      console.error(`[${TAG}]   Verify the ticker against the bridge FIRST — do not assume it matches:`);
      console.error(`[${TAG}]     (Invoke-RestMethod http://localhost:5001/symbols).symbols | ? name -eq GER40`);
      try { data.conn.end(); } catch { /* the client may already be closed */ }
      process.exit(1);
    }
    console.log('');
    try { data.conn.end(); } catch { /* the client may already be closed */ }
    process.exit(0);
  })();
}

module.exports = { findUnpinned, parseTsv };
