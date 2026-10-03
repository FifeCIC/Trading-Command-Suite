/**
 * logs/r37-candidates-for-60.cjs — which symbols "earn a place" to take the core from 57 to 60?
 *
 * OWNER DIRECTION 2026-10-03: "it's looking like we should target 60 symbols then."
 * Their rule for inclusion: "the ones already active for starters, and the ones that are already
 * fully active, then any that are easily supported".
 *
 * "EASILY SUPPORTED" is measurable, not a judgement: `broker_symbol` is the per-broker symbol list
 * the app already caches, and it carries `tradeMode` — the same field `/order` refuses on when it is
 * not 4. So a candidate is a symbol a LIVE broker lists AND will accept a trade on.
 */
const { connect, query } = require('../scripts/lib/mysql-cli.cjs');

const CORE = `
  UPPER(ticker) IN (
    SELECT UPPER(ts.symbol) FROM trading_strategy ts
    UNION SELECT UPPER(a.symbol) FROM symbol_protocol_assignment a
    UNION SELECT UPPER(r.symbol) FROM symbol_route r WHERE r.enabled = 1
    UNION SELECT 'EURUSD' UNION SELECT 'GBPUSD' UNION SELECT 'USDCAD'
    UNION SELECT 'XAUUSD' UNION SELECT 'US500')`;

(async () => {
  const c = await connect();

  console.log('== broker_symbol: how many are FULLY TRADEABLE (tradeMode 4)? ==');
  console.log(await query(
    `SELECT brokerId, COUNT(*) AS listed,
            SUM(CASE WHEN tradeMode = 4 THEN 1 ELSE 0 END) AS tradeable,
            SUM(CASE WHEN registered = 1 THEN 1 ELSE 0 END) AS registered
     FROM broker_symbol GROUP BY brokerId ORDER BY brokerId`, c));

  console.log('== by asset class, the tradeable pool (the raw material for a wider core) ==');
  console.log(await query(
    `SELECT assetClass, COUNT(*) AS n FROM broker_symbol
     WHERE tradeMode = 4 GROUP BY assetClass ORDER BY n DESC LIMIT 10`, c));

  console.log('== NOT in the core but FULLY TRADEABLE and already REGISTERED — top candidates ==');
  console.log(await query(
    `SELECT bs.name AS ticker, bs.brokerId, bs.assetClass,
            (SELECT COUNT(*) FROM marketbar b JOIN symbol s ON s.id = b.symbolId
              WHERE UPPER(s.ticker) = UPPER(bs.name)) AS bars_held
     FROM broker_symbol bs
     WHERE bs.tradeMode = 4 AND bs.registered = 1
     GROUP BY bs.name, bs.brokerId, bs.assetClass
     ORDER BY bars_held DESC LIMIT 20`, c));

  console.log('== count of candidates that would NOT be a new symbol (already in `symbol`) ==');
  console.log(await query(
    `SELECT
       (SELECT COUNT(DISTINCT bs.name) FROM broker_symbol bs
         WHERE bs.tradeMode = 4 AND bs.registered = 1
           AND UPPER(bs.name) NOT IN (SELECT UPPER(ticker) FROM symbol WHERE (${CORE}))) AS not_yet_in_core,
       (SELECT COUNT(DISTINCT bs.name) FROM broker_symbol bs
         WHERE bs.tradeMode = 4 AND bs.registered = 1) AS total_registered_tradeable`, c));
})();
