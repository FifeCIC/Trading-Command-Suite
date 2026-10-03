/**
 * logs/bars-flat-prices.cjs — THE DECISIVE TEST.
 *
 * 1,016 flat 5m bars, 52 symbols, all written since Friday's close.
 * If they ALL carry 4147.795 (XAUUSD's gold price), then every symbol's bar has been
 * contaminated with one instrument's value — far worse than a stale quote.
 * If each carries its OWN plausible price, it is a frozen last-quote written once per bucket.
 */
const { connect, query } = require('../scripts/lib/mysql-cli.cjs');

(async () => {
  const c = await connect();

  console.log('== the flat price held by each symbol (mt5, 5m, after Fri close) ==');
  console.log(await query(
    `SELECT s.ticker, COUNT(*) AS flat_n, MIN(b.close) AS min_close, MAX(b.close) AS max_close,
            MIN(b.timestamp) AS first_bar, MAX(b.timestamp) AS last_bar
     FROM marketbar b JOIN symbol s ON s.id = b.symbolId
     WHERE b.timestamp > '2026-10-02 21:00:00' AND b.provider='mt5'
       AND b.open=b.high AND b.high=b.low AND b.low=b.close
     GROUP BY s.ticker ORDER BY s.ticker LIMIT 60`, c));

  console.log('== distinct close prices across ALL flat bars (how many distinct values?) ==');
  console.log(await query(
    `SELECT COUNT(DISTINCT b.close) AS distinct_prices, COUNT(*) AS total_flat,
            MIN(b.close) AS lo, MAX(b.close) AS hi
     FROM marketbar b
     WHERE b.timestamp > '2026-10-02 21:00:00' AND b.provider='mt5'
       AND b.open=b.high AND b.high=b.low AND b.low=b.close`, c));

  console.log('== EVERY flat bar for XAUUSD, in order, with its write time ==');
  console.log(await query(
    `SELECT b.timestamp, b.close, b.volume, b.importedAt
     FROM marketbar b JOIN symbol s ON s.id = b.symbolId
     WHERE UPPER(s.ticker)='XAUUSD' AND b.timeframe='5m'
       AND b.timestamp > '2026-10-02 21:00:00'
     ORDER BY b.timestamp LIMIT 30`, c));
})();
