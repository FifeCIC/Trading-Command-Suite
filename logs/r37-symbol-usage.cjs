/**
 * logs/r37-symbol-usage.cjs — R37: are the symbols with no bot actually UNUSED, or only untraded?
 *
 * ⚠️ Both references join on TICKER, not symbolId:
 *   - `watchlist_item.symbolId` is NULLABLE, so a join on it silently drops rows
 *   - `symbol_protocol_assignment.symbol` is a varchar(20) TICKER, not an id
 * A wrong join returns no rows and no error, which reads as "no such usage".
 */
const { connect, query } = require('../scripts/lib/mysql-cli.cjs');

(async () => {
  const c = await connect();

  console.log('== every symbol holding bars: is it DISPLAYED (watchlist) or ASSIGNED (protocol)? ==');
  console.log(await query(
    `SELECT
       CASE WHEN w.ticker IS NULL THEN 'not on a watchlist' ELSE 'on a watchlist' END AS watchlisted,
       CASE WHEN a.symbol IS NULL THEN 'no assignment' ELSE 'assigned to a protocol' END AS assigned,
       COUNT(*) AS symbols, SUM(x.bars) AS bars
     FROM (SELECT b.symbolId AS sid, s.ticker AS tk, COUNT(*) AS bars
             FROM marketbar b JOIN symbol s ON s.id = b.symbolId
             GROUP BY b.symbolId, s.ticker) x
     LEFT JOIN (SELECT DISTINCT ticker FROM watchlist_item) w ON w.ticker = x.tk
     LEFT JOIN (SELECT DISTINCT symbol FROM symbol_protocol_assignment) a ON a.symbol = x.tk
     GROUP BY watchlisted, assigned ORDER BY symbols DESC`, c));

  console.log('== row counts of the reference tables (an EMPTY table and a wrong join look the same) ==');
  console.log(await query(
    `SELECT (SELECT COUNT(*) FROM watchlist_item) AS watchlist_item_rows,
            (SELECT COUNT(*) FROM watchlist) AS watchlist_rows,
            (SELECT COUNT(*) FROM symbol_protocol_assignment) AS assignment_rows`, c));

  console.log('== symbols holding bars, split on ASSIGNMENT alone (watchlist is unreliable) ==');
  console.log(await query(
    `SELECT CASE WHEN a.symbol IS NULL THEN 'no assignment - nothing scores it'
                 ELSE 'assigned to a protocol' END AS assigned,
            COUNT(*) AS symbols, SUM(x.bars) AS bars
     FROM (SELECT b.symbolId AS sid, s.ticker AS tk, COUNT(*) AS bars
             FROM marketbar b JOIN symbol s ON s.id = b.symbolId
             GROUP BY b.symbolId, s.ticker) x
     LEFT JOIN (SELECT DISTINCT symbol FROM symbol_protocol_assignment) a ON a.symbol = x.tk
     GROUP BY assigned ORDER BY symbols DESC`, c));
})();
