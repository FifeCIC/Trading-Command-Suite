/**
 * logs/bars-flat-class.cjs — characterise the FLAT bars written after Friday's close.
 *
 * Measured so far: the bridge has NOTHING for XAUUSD 5m after Fri 20:50Z, yet we hold bars
 * stamped Sat 13:40 / Fri 22:40 / 22:30 / 22:25 / 22:20 all reading open=close=4147.795 vol=1.
 *
 * Questions this answers:
 *   1. Are they byte-identical on ALL FIVE OHLCV fields (i.e. is #1049's rule applicable)?
 *   2. How many are there, across how many symbols, on which timeframes/providers?
 *   3. When were they written, and how often?
 */
const { connect, query } = require('../scripts/lib/mysql-cli.cjs');

const CLOSED_FROM = '2026-10-02 21:00:00';   // Friday, after the last real XAUUSD bar (20:50Z)

(async () => {
  const c = await connect();

  console.log('== 1. Exact OHLCV of the newest XAUUSD 5m rows ==');
  console.log(await query(
    `SELECT b.timestamp, b.open, b.high, b.low, b.close, b.volume, b.provider,
            CASE WHEN b.open=b.high AND b.high=b.low AND b.low=b.close
                 THEN 'FLAT(o=h=l=c)' ELSE '' END AS flat
     FROM marketbar b JOIN symbol s ON s.id = b.symbolId
     WHERE UPPER(s.ticker)='XAUUSD' AND b.timeframe='5m'
     ORDER BY b.timestamp DESC LIMIT 10`, c));

  console.log(`== 2. ALL bars stamped after ${CLOSED_FROM}, by timeframe/provider ==`);
  console.log(await query(
    `SELECT b.timeframe AS tf, b.provider, COUNT(*) AS n,
            COUNT(DISTINCT b.symbolId) AS symbols,
            MIN(b.timestamp) AS first_bar, MAX(b.timestamp) AS last_bar,
            SUM(CASE WHEN b.open=b.high AND b.high=b.low AND b.low=b.close THEN 1 ELSE 0 END) AS flat_bars,
            SUM(CASE WHEN b.volume<=1 THEN 1 ELSE 0 END) AS vol_le_1
     FROM marketbar b
     WHERE b.timestamp > '${CLOSED_FROM}'
     GROUP BY b.timeframe, b.provider ORDER BY n DESC`, c));

  console.log('== 3. Which symbols hold FLAT bars after Friday close (mt5 only) ==');
  console.log(await query(
    `SELECT s.ticker, b.timeframe AS tf, COUNT(*) AS flat_n,
            MIN(b.timestamp) AS first_bar, MAX(b.timestamp) AS last_bar,
            MIN(b.importedAt) AS first_written, MAX(b.importedAt) AS last_written
     FROM marketbar b JOIN symbol s ON s.id = b.symbolId
     WHERE b.timestamp > '${CLOSED_FROM}' AND b.provider='mt5'
       AND b.open=b.high AND b.high=b.low AND b.low=b.close
     GROUP BY s.ticker, b.timeframe ORDER BY flat_n DESC LIMIT 20`, c));
})();
