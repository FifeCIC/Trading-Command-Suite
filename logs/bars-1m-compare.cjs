/**
 * logs/bars-1m-compare.cjs — THE 1m QUESTION (#AGENT-ATTENTION 2026-10-02).
 *
 * "Why is the newest 1m bar 24 minutes old when the refresh cycle is 1.72 min every 5 min?"
 *
 * The test: ask the BRIDGE for 1m candles for one symbol, and compare the newest timestamp it
 * returns against the newest we have STORED. The discrepancy names the cause:
 *   - bridge newest ≈ stored newest  -> ingestion is fine, the lag is upstream (broker feed)
 *   - bridge newest >> stored newest -> we are FAILING TO STORE what is available
 */
const { connect, query } = require('../scripts/lib/mysql-cli.cjs');

const SYMBOL = process.argv[2] || 'XAUUSD';

async function fromBridge(symbol, tf, limit, port) {
  const url = `http://localhost:${port}/candles?symbol=${encodeURIComponent(symbol)}&timeframe=${tf}&limit=${limit}`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) return { port, error: `HTTP ${res.status}` };
    const j = await res.json();
    const arr = Array.isArray(j) ? j : (j.candles || j.bars || j.data || []);
    if (!arr.length) return { port, error: 'empty', raw: JSON.stringify(j).slice(0, 120) };
    const times = arr.map((b) => new Date(b.time ?? b.timestamp ?? b.t).getTime()).filter(Number.isFinite);
    return {
      port,
      n: arr.length,
      newest: new Date(Math.max(...times)).toISOString(),
      oldest: new Date(Math.min(...times)).toISOString(),
    };
  } catch (e) {
    return { port, error: String(e.message).slice(0, 80) };
  }
}

(async () => {
  const c = await connect();

  console.log(`== what we have STORED for ${SYMBOL}, per timeframe ==`);
  console.log(await query(
    `SELECT b.timeframe AS tf, COUNT(*) AS n, MAX(b.timestamp) AS newest_bar,
            MAX(b.importedAt) AS last_imported,
            TIMESTAMPDIFF(MINUTE, MAX(b.timestamp), UTC_TIMESTAMP()) AS bar_age_min
     FROM marketbar b JOIN symbol s ON s.id = b.symbolId
     WHERE UPPER(s.ticker) = '${SYMBOL}'
     GROUP BY b.timeframe ORDER BY b.timeframe`, c));

  console.log(`== what the BRIDGE returns for ${SYMBOL} 1m ==`);
  for (const port of [5000, 5001]) {
    const r = await fromBridge(SYMBOL, '1m', 50, port);
    console.log('  :' + port, JSON.stringify(r));
  }
})();
