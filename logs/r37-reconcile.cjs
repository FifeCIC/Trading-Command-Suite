/**
 * logs/r37-reconcile.cjs — why do the dry-run counts differ by one?
 * 137 (no bars) + 80 (has bars) = 217 active-and-non-core, but the deactivate set says 199,
 * and the protected list shows 19. 217 - 199 = 18, so one symbol is unaccounted for.
 * A set I cannot reconcile is a set I do not understand.
 */
const { connect, query } = require('../scripts/lib/mysql-cli.cjs');

const CORE = `
  SELECT ticker AS tk FROM symbol WHERE UPPER(ticker) IN (
    SELECT UPPER(ts.symbol) FROM trading_strategy ts
    UNION SELECT UPPER(a.symbol) FROM symbol_protocol_assignment a
    UNION SELECT UPPER(r.symbol) FROM symbol_route r WHERE r.enabled = 1
    UNION SELECT 'EURUSD' UNION SELECT 'GBPUSD' UNION SELECT 'USDCAD'
    UNION SELECT 'XAUUSD' UNION SELECT 'US500'
  )`;

(async () => {
  const c = await connect();

  console.log('== the three counts, together ==');
  console.log(await query(
    `SELECT
       (SELECT COUNT(*) FROM symbol s WHERE s.active = 1 AND UPPER(s.ticker) NOT IN (${CORE})) AS active_non_core,
       (SELECT COUNT(DISTINCT UPPER(s.ticker)) FROM symbol s
          WHERE s.active = 1 AND UPPER(s.ticker) NOT IN (${CORE})
            AND UPPER(s.ticker) IN (SELECT UPPER(p.symbol) FROM position p)) AS protected_count,
       (SELECT COUNT(*) FROM symbol s
          WHERE s.active = 1 AND UPPER(s.ticker) NOT IN (${CORE})
            AND UPPER(s.ticker) NOT IN (SELECT UPPER(p.symbol) FROM position p)) AS deactivate_count`, c));

  console.log('== the protected symbols, with their position count and bar presence ==');
  console.log(await query(
    `SELECT s.ticker, s.active,
            (SELECT COUNT(*) FROM position p WHERE UPPER(p.symbol) = UPPER(s.ticker)) AS positions,
            (SELECT COUNT(*) FROM marketbar b WHERE b.symbolId = s.id) AS bars
     FROM symbol s
     WHERE s.active = 1 AND UPPER(s.ticker) NOT IN (${CORE})
       AND UPPER(s.ticker) IN (SELECT UPPER(p.symbol) FROM position p)
     ORDER BY s.ticker`, c));
})();
