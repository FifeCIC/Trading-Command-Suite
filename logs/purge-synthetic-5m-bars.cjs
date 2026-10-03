/**
 * logs/purge-synthetic-5m-bars.cjs — one-off repair for the removed synthetic-quote writer.
 *
 * The refresh used to write a bar per symbol per 5m bucket from `(bid+ask)/2` with `volume 1`,
 * whenever a quote answered — including while the market was shut. Removed from the code
 * 2026-10-03; this removes the rows it left behind.
 *
 * ⚠️ WHY THIS IS PART OF THE CAUSE FIX AND NOT A WORKAROUND. These rows are not merely stale
 * history — they are stamped at the CURRENT bucket, so `MAX(timestamp)` for each affected symbol
 * is ~now and freshness checks read a dead feed as live. Leaving them means the symptom survives
 * the fix.
 *
 * The predicate is the exact measured signature, not a guess:
 *   provider='mt5' AND timeframe='5m'
 *   AND open=high AND high=low AND low=close   (a quote mid, never a traded range)
 *   AND volume <= 1                            (fabricated: real 5m volumes are 100s-1000s)
 *   AND timestamp > the last bar the bridge actually served (Fri 2026-10-02 20:55Z)
 *
 * Usage:  node logs/purge-synthetic-5m-bars.cjs            (report only — default)
 *         node logs/purge-synthetic-5m-bars.cjs --apply    (delete)
 */
const { connect, query } = require('../scripts/lib/mysql-cli.cjs');

const APPLY = process.argv.includes('--apply');

// The last bar the bridge demonstrably served for any symbol (XAUUSD 5m, :5001). Anything stamped
// after this with the fabricated signature cannot be market data.
const SERVE_CUTOFF = '2026-10-02 20:55:00';

const MATCH = `
  b.provider = 'mt5'
  AND b.timeframe = '5m'
  AND b.open = b.high AND b.high = b.low AND b.low = b.close
  AND b.volume <= 1
  AND b.timestamp > '${SERVE_CUTOFF}'`;

(async () => {
  const c = await connect();

  console.log(`== rows matching the fabricated signature (${APPLY ? 'APPLY' : 'DRY RUN'}) ==`);
  console.log(await query(
    `SELECT COUNT(*) AS fabricated_rows, COUNT(DISTINCT b.symbolId) AS symbols,
            MIN(b.timestamp) AS first_bar, MAX(b.timestamp) AS last_bar
     FROM marketbar b WHERE ${MATCH}`, c));

  console.log('== same signature ANYWHERE in history (context: is it only post-close?) ==');
  console.log(await query(
    `SELECT CASE WHEN b.timestamp > '${SERVE_CUTOFF}' THEN 'after Fri close' ELSE 'before' END AS era,
            COUNT(*) AS n, COUNT(DISTINCT b.symbolId) AS symbols
     FROM marketbar b
     WHERE b.provider='mt5' AND b.timeframe='5m'
       AND b.open=b.high AND b.high=b.low AND b.low=b.close AND b.volume<=1
     GROUP BY era`, c));

  console.log('== the symbols still reading FRESH because of them ==');
  console.log(await query(
    `SELECT s.ticker, COUNT(*) AS n, MAX(b.timestamp) AS newest_bar
     FROM marketbar b JOIN symbol s ON s.id = b.symbolId
     WHERE ${MATCH} GROUP BY s.ticker ORDER BY n DESC LIMIT 8`, c));

  if (!APPLY) {
    console.log('\nDRY RUN — nothing deleted. Re-run with --apply to remove the rows above.');
    return;
  }

  console.log('== deleting ==');
  console.log(await query(`DELETE b FROM marketbar b WHERE ${MATCH}`, c));

  console.log('== verify: rows remaining with the signature ==');
  console.log(await query(
    `SELECT COUNT(*) AS remaining FROM marketbar b WHERE ${MATCH}`, c));

  console.log('== verify: XAUUSD 5m newest is now the bridge-served bar ==');
  console.log(await query(
    `SELECT b.timestamp, b.close, b.volume, b.provider
     FROM marketbar b JOIN symbol s ON s.id = b.symbolId
     WHERE UPPER(s.ticker)='XAUUSD' AND b.timeframe='5m'
     ORDER BY b.timestamp DESC LIMIT 3`, c));
})();
