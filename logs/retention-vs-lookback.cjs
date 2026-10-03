/**
 * logs/retention-vs-lookback.cjs — is the 60-day marketbar window deep enough for the directives?
 *
 * Directives declare `minBars` per timeframe. The deepest daily declarations are:
 *   btc-halving-cycle  '1d': 365     <- 365 DAYS of daily bars
 *   bollinger-squeeze  '1d': 72
 *   ema-structure      '1d': 51
 *   hurst-memory       '1d': 50
 *
 * `marketbar` retention is `defaultDays: 60` on `timestamp`. If that prune RUNS, no directive can
 * ever hold 365 daily bars — and the failure is SILENT, because a short bar array is a legitimate
 * state (a new symbol has no history), so nothing errors.
 */
const { connect, query } = require('../scripts/lib/mysql-cli.cjs');

(async () => {
  const c = await connect();

  console.log('== how deep is marketbar really? (if the oldest row is < 60d, the window binds) ==');
  console.log(await query(
    `SELECT MIN(timestamp) AS oldest_bar, MAX(timestamp) AS newest_bar,
            TIMESTAMPDIFF(DAY, MIN(timestamp), UTC_TIMESTAMP()) AS oldest_age_days,
            COUNT(*) AS rows_now
     FROM marketbar`, c));

  console.log('== daily bars available for the symbols that HAVE bots (the tradeable set) ==');
  console.log(await query(
    `SELECT s.ticker, COUNT(*) AS daily_bars,
            TIMESTAMPDIFF(DAY, MIN(b.timestamp), UTC_TIMESTAMP()) AS depth_days
     FROM marketbar b JOIN symbol s ON s.id = b.symbolId
     WHERE b.timeframe = '1d' AND UPPER(s.ticker) IN (SELECT UPPER(symbol) FROM trading_strategy)
     GROUP BY s.ticker ORDER BY daily_bars DESC LIMIT 12`, c));

  console.log('== which ACTIVE protocols contain a directive needing >60 daily bars? ==');
  console.log(await query(
    `SELECT COUNT(*) AS active_protocols, SUM(CASE WHEN p.slug LIKE '%btc%' THEN 1 ELSE 0 END) AS btc_named
     FROM protocol p WHERE p.active = 1`, c));
})();
