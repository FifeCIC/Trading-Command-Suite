/**
 * logs/r37-core-set.cjs — measure the bill of materials for a core set of ~40 symbols.
 *
 * OWNER DIRECTION 2026-10-03:
 *   "reduce the app down to 40 - the ones already active for starters, and the ones that are
 *    already fully active, then any that are easily supported. I'm happy to go above 40 if it adds
 *    genuine opportunity but I think for now our core set should be 40."
 *
 * So the rank is: (1) has a BOT, (2) has a bot AND a protocol assignment, (3) otherwise supported.
 * ⚠️ Joins are on TICKER — `symbol_protocol_assignment.symbol` is a varchar(20) ticker, not an id.
 */
const { connect, query } = require('../scripts/lib/mysql-cli.cjs');

(async () => {
  const c = await connect();

  console.log('== the population ==');
  console.log(await query(
    `SELECT
       (SELECT COUNT(*) FROM symbol) AS all_symbols,
       (SELECT COUNT(*) FROM symbol WHERE active = 1) AS active_symbols,
       (SELECT COUNT(DISTINCT symbolId) FROM marketbar) AS symbols_with_bars,
       (SELECT COUNT(DISTINCT symbol) FROM trading_strategy) AS symbols_with_a_bot,
       (SELECT COUNT(DISTINCT symbol) FROM symbol_protocol_assignment) AS assigned_symbols,
       (SELECT COUNT(DISTINCT symbol) FROM symbol_route WHERE enabled = 1) AS routed_symbols`, c));

  console.log('== RANK 1+2: symbols that HAVE A BOT (and how many bots) — the tradeable core ==');
  console.log(await query(
    `SELECT ts.symbol AS ticker, COUNT(*) AS bots,
            SUM(CASE WHEN ts.active = 1 THEN 1 ELSE 0 END) AS active_bots,
            CASE WHEN a.symbol IS NULL THEN 'no protocol assignment' ELSE 'assigned' END AS assigned,
            (SELECT COUNT(*) FROM marketbar b JOIN symbol s2 ON s2.id = b.symbolId
              WHERE s2.ticker = ts.symbol) AS bars
     FROM trading_strategy ts
     LEFT JOIN (SELECT DISTINCT symbol FROM symbol_protocol_assignment) a ON a.symbol = ts.symbol
     GROUP BY ts.symbol, assigned ORDER BY bots DESC, ticker`, c));

  console.log('== the union that would form the CORE ==');
  console.log(await query(
    `SELECT COUNT(*) AS core_candidates FROM (
       SELECT symbol AS tk FROM trading_strategy
       UNION
       SELECT symbol AS tk FROM symbol_protocol_assignment
       UNION
       SELECT symbol AS tk FROM symbol_route WHERE enabled = 1
     ) u`, c));
})();
