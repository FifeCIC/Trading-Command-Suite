/**
 * logs/r37-reclaim.cjs — what would "erasing the redundant data" actually free?
 *
 * The owner: "I think 40 right now allows us erase a lot of redundant data."
 * Measure before deleting: how much of `marketbar` belongs to symbols now outside the core set,
 * and which of those were still being refreshed (ingested) vs already dormant.
 */
const { connect, query } = require('../scripts/lib/mysql-cli.cjs');

(async () => {
  const c = await connect();

  console.log('== marketbar rows held by ACTIVE vs DEACTIVATED symbols ==');
  console.log(await query(
    `SELECT CASE WHEN s.active = 1 THEN 'active (core + held)' ELSE 'DEACTIVATED' END AS state,
            COUNT(DISTINCT s.id) AS symbols, COUNT(b.id) AS rows_held, MAX(b.timestamp) AS newest_bar
     FROM symbol s LEFT JOIN marketbar b ON b.symbolId = s.id
     GROUP BY state ORDER BY rows_held DESC`, c));

  console.log('== table size now ==');
  console.log(await query(
    `SELECT TABLE_NAME AS tbl, ROUND((DATA_LENGTH + INDEX_LENGTH) / 1048576) AS total_mb,
            ROUND(DATA_LENGTH / 1048576) AS data_mb, ROUND(INDEX_LENGTH / 1048576) AS index_mb
     FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = 'tradingcs' AND TABLE_NAME = 'marketbar'`, c));

  console.log('== the deactivated symbols that STILL hold the most bars (the reclaim target) ==');
  console.log(await query(
    `SELECT s.ticker, COUNT(b.id) AS bars, MAX(b.timestamp) AS newest_bar
     FROM symbol s JOIN marketbar b ON b.symbolId = s.id
     WHERE s.active = 0
     GROUP BY s.ticker ORDER BY bars DESC LIMIT 12`, c));
})();
