/**
 * logs/week-prep.cjs — can every open position be priced when the market reopens?
 *
 * A position that cannot be priced cannot be stop-guarded. That is the one thing worth checking
 * before a trading week, because the failure is silent: the guardian compares against a price that
 * never updates, and "the stop did not fire" appears nowhere as an error.
 *
 * Also checks: which held symbols have NO bars, and whether the broker even offers them.
 */
const { connect, query } = require('../scripts/lib/mysql-cli.cjs');

(async () => {
  const c = await connect();

  console.log('== the live book ==');
  console.log(await query(
    `SELECT COUNT(*) AS positions, COUNT(DISTINCT symbol) AS symbols,
            SUM(CASE WHEN currentPrice IS NULL THEN 1 ELSE 0 END) AS no_price,
            SUM(CASE WHEN avgPrice IS NULL OR avgPrice = 0 THEN 1 ELSE 0 END) AS no_entry,
            MIN(openedAt) AS oldest, MAX(openedAt) AS newest
     FROM position`, c));

  console.log('== every position: does it have bars, and is it still ACTIVE as a symbol? ==');
  console.log(await query(
    `SELECT p.symbol AS ticker, p.side, p.quantity, p.avgPrice, p.currentPrice, p.provider,
            s.active AS symbol_active,
            (SELECT COUNT(*) FROM marketbar b WHERE b.symbolId = s.id) AS bars,
            (SELECT MAX(b.timestamp) FROM marketbar b WHERE b.symbolId = s.id) AS newest_bar
     FROM position p LEFT JOIN symbol s ON UPPER(s.ticker) = UPPER(p.symbol)
     ORDER BY bars ASC, ticker`, c));

  console.log('== positions whose symbol has ZERO bars (cannot be priced by our own feed) ==');
  console.log(await query(
    `SELECT p.symbol AS ticker, p.side, p.quantity, p.currentPrice,
            s.active AS symbol_active, s.name
     FROM position p LEFT JOIN symbol s ON UPPER(s.ticker) = UPPER(p.symbol)
     WHERE s.id IS NULL OR NOT EXISTS (SELECT 1 FROM marketbar b WHERE b.symbolId = s.id)
     ORDER BY ticker`, c));

  console.log('== bots: active and armed? ==');
  console.log(await query(
    `SELECT ts.active, ts.mode, COUNT(*) AS bots,
            SUM(CASE WHEN ts.symbol IN (SELECT symbol FROM position) THEN 1 ELSE 0 END) AS with_position
     FROM trading_strategy ts GROUP BY ts.active, ts.mode ORDER BY bots DESC`, c));

  console.log('== signal queue ==');
  console.log(await query(
    `SELECT status, COUNT(*) AS n, MIN(createdAt) AS oldest FROM strategy_signal_queue
     GROUP BY status ORDER BY n DESC`, c));
})();
