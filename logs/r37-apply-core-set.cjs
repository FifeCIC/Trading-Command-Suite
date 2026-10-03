/**
 * logs/r37-apply-core-set.cjs — R37: reduce the app to its core set via `symbol.active`.
 *
 * OWNER DIRECTION 2026-10-03:
 *   "reduce the app down to 40 - the ones already active for starters, and the ones that are
 *    already fully active, then any that are easily supported."
 *
 * THE CORE SET, measured 2026-10-03, is the union of every way a symbol can be USED:
 *   - it has a bot            (trading_strategy.symbol)
 *   - it is assigned          (symbol_protocol_assignment.symbol)
 *   - it is routed to a broker(symbol_route, enabled)
 *   - it is the FOREX_FLOOR   (the 5 always-needed pairs)
 * That union is 39 symbols. Everything else is referenced by nothing.
 *
 * ⚠️ THE CARVE-OUT — a symbol with an OPEN POSITION is NEVER deactivated, whatever else is true.
 * It is held, it must keep being priced, and the stop guardian depends on it. `symbol.active` does
 * not gate the position path, but deactivating a held symbol would still be a lie in the data.
 *
 * ORDER MATTERS: this only flips a flag. Ingestion stops because `BarRefreshService` now reads
 * `active`. Deleting bars is a SEPARATE step, run only after this has been observed to work — the
 * #R32/#R39 lesson: deleting first races a writer that is still running.
 *
 * Usage:  node logs/r37-apply-core-set.cjs            (report only — default)
 *         node logs/r37-apply-core-set.cjs --apply    (deactivate)
 *         node logs/r37-apply-core-set.cjs --revert   (reactivate everything)
 */
const { connect, query } = require('../scripts/lib/mysql-cli.cjs');

const APPLY = process.argv.includes('--apply');
const REVERT = process.argv.includes('--revert');

const CORE = `
  SELECT ticker AS tk FROM symbol WHERE UPPER(ticker) IN (
    SELECT UPPER(ts.symbol) FROM trading_strategy ts
    UNION SELECT UPPER(a.symbol) FROM symbol_protocol_assignment a
    UNION SELECT UPPER(r.symbol) FROM symbol_route r WHERE r.enabled = 1
    UNION SELECT 'EURUSD' UNION SELECT 'GBPUSD' UNION SELECT 'USDCAD'
    UNION SELECT 'XAUUSD' UNION SELECT 'US500'
  )`;

/** Held positions — never deactivated. */
const HELD = `SELECT UPPER(symbol) AS tk FROM position`;

(async () => {
  const c = await connect();

  if (REVERT) {
    console.log('== reverting: every symbol active = 1 ==');
    console.log(await query(`UPDATE symbol SET active = 1 WHERE active = 0`, c));
    console.log(await query(`SELECT COUNT(*) AS now_active FROM symbol WHERE active = 1`, c));
    return;
  }

  console.log('== the core set ==');
  console.log(await query(
    `SELECT COUNT(*) AS core_symbols FROM (${CORE}) k`, c));

  console.log('== outside the core: active now, and whether they cost anything ==');
  console.log(await query(
    `SELECT
       CASE WHEN EXISTS (SELECT 1 FROM marketbar b WHERE b.symbolId = s.id) THEN 'has bars' ELSE 'no bars' END AS bars,
       COUNT(*) AS symbols
     FROM symbol s
     WHERE s.active = 1 AND UPPER(s.ticker) NOT IN (${CORE})
     GROUP BY bars ORDER BY symbols DESC`, c));

  console.log('== PROTECTED — outside the core but HELD, so never deactivated ==');
  console.log(await query(
    `SELECT s.ticker FROM symbol s
     WHERE s.active = 1 AND UPPER(s.ticker) NOT IN (${CORE})
       AND UPPER(s.ticker) IN (${HELD})`, c));

  console.log(`== the exact set to deactivate (${APPLY ? 'APPLY' : 'DRY RUN'}) ==`);
  console.log(await query(
    `SELECT COUNT(*) AS will_deactivate FROM symbol s
     WHERE s.active = 1 AND UPPER(s.ticker) NOT IN (${CORE})
       AND UPPER(s.ticker) NOT IN (${HELD})`, c));

  if (!APPLY) {
    console.log('\nDRY RUN — nothing changed. Re-run with --apply.');
    return;
  }

  console.log('== deactivating ==');
  // ⚠️ MySQL 1093: an UPDATE may not subquery the table it is updating. Wrapping CORE in a
  // derived table materialises it first, which is what makes this legal.
  console.log(await query(
    `UPDATE symbol SET active = 0
     WHERE active = 1
       AND UPPER(ticker) NOT IN (SELECT tk FROM (${CORE}) AS core)
       AND UPPER(ticker) NOT IN (SELECT tk FROM (${HELD}) AS held)`, c));

  console.log('== verify ==');
  console.log(await query(
    `SELECT (SELECT COUNT(*) FROM symbol WHERE active = 1) AS active_now,
            (SELECT COUNT(*) FROM symbol) AS total`, c));

  console.log('== verify: nothing HELD was deactivated ==');
  console.log(await query(
    `SELECT COUNT(*) AS held_but_inactive
     FROM symbol s WHERE s.active = 0 AND UPPER(s.ticker) IN (${HELD})`, c));
})();
