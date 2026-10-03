/**
 * logs/bars-weekend-check.cjs — is our newest 5m bar real?
 *
 * The 1m series matches the bridge exactly (20:54). But the DB reported a 5m bar dated TODAY
 * (Saturday 2026-10-03 13:40) while the bridge's own answers all end on Friday evening.
 * A bar timestamped during market closure would be a FABRICATED bar, and it would feed scoring.
 *
 * This compares the newest bar we hold against the newest the bridge actually has.
 */
const { connect, query } = require('../scripts/lib/mysql-cli.cjs');

async function newestFromBridge(symbol, tf, port) {
  const url = `http://localhost:${port}/candles?symbol=${encodeURIComponent(symbol)}&timeframe=${tf}&limit=300`;
  const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
  const j = await res.json();
  const arr = Array.isArray(j) ? j : (j.bars || j.candles || j.data || []);
  if (!arr.length) return up({ port, error: 'empty' });
  const times = arr.map((b) => new Date(b.timestamp ?? b.time ?? b.t).getTime()).filter(Number.isFinite);
  const newest = Math.max(...times);
  const last = arr.find((b) => new Date(b.timestamp ?? b.time ?? b.t).getTime() === newest);
  return { port, n: arr.length, newest: new Date(newest).toISOString(), close: last?.close };
}
const up = (x) => x;

(async () => {
  const c = await connect();

  console.log('== clock ==');
  console.log(await query(`SELECT @@global.time_zone AS mysql_tz, @@session.time_zone AS session_tz,
                                  UTC_TIMESTAMP() AS utc_now, NOW() AS local_now`, c));

  console.log('\n== newest 5m rows WE HOLD for XAUUSD ==');
  console.log(await query(
    `SELECT b.timestamp, b.provider, b.open, b.close, b.volume, b.recordingSessionId, b.importedAt
     FROM marketbar b JOIN symbol s ON s.id = b.symbolId
     WHERE UPPER(s.ticker) = 'XAUUSD' AND b.timeframe = '5m'
     ORDER BY b.timestamp DESC LIMIT 5`, c));

  console.log('\n== newest 1m rows WE HOLD for XAUUSD ==');
  console.log(await query(
    `SELECT b.timestamp, b.provider, b.close, b.recordingSessionId, b.importedAt
     FROM marketbar b JOIN symbol s ON s.id = b.symbolId
     WHERE UPPER(s.ticker) = 'XAUUSD' AND b.timeframe = '1m'
     ORDER BY b.timestamp DESC LIMIT 5`, c));

  console.log('\n== WHERE did bars newer than Friday come from? (any symbol) ==');
  console.log(await query(
    `SELECT b.timeframe, b.provider, COUNT(*) AS n, MIN(b.timestamp) AS first_bar,
            MAX(b.timestamp) AS last_bar, MAX(b.importedAt) AS last_imported
     FROM marketbar b
     WHERE b.timestamp > '2026-10-02 21:30:00'
     GROUP BY b.timeframe, b.provider ORDER BY n DESC LIMIT 12`, c));

  console.log('\n== newest the BRIDGE has ==');
  for (const port of [5000, 5001]) {
    for (const tf of ['1m', '5m']) {
      try { console.log('  :' + port, tf, JSON.stringify(await newestFromBridge('XAUUSD', tf, port))); }
      catch (e) { console.log('  :' + port, tf, 'ERR', e.message.slice(0, 60)); }
    }
  }
})();
