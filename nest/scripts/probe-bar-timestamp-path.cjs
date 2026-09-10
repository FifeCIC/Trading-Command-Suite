/**
 * Decisive test: does the bar-refresh INSERT path shift the timestamp?
 *
 * Context (#750, 2026-09-10): `marketbar` has rows dated in the future (invariant
 * INV-NO-FUTURE-ROWS fails). Verified so far:
 *   - the bridge returns CORRECT UTC (`/candles` gave 18:55:00 at 18:55:23 UTC)
 *   - a Prisma parameter round-trip is EXACT (0.0 min drift)
 *   - inserting a known Date into a `datetime(3)` column is EXACT (0.0 min drift)
 *
 * So neither the driver nor the column shifts. That leaves the VALUE handed to the
 * insert. This script pulls a real bar through the same path the refresh uses and
 * compares the bridge's value against what would be written.
 *
 * Read-only — it does NOT insert into marketbar.
 */
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const BRIDGES = [5000, 5001];

async function bridgeCandles(port, symbol, tf, limit = 5) {
  const url = `http://localhost:${port}/candles?symbol=${encodeURIComponent(symbol)}&timeframe=${tf}&limit=${limit}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`bridge ${port} -> ${res.status}`);
  const body = await res.json();
  return body.bars ?? [];
}

(async () => {
  const trueUtc = new Date();
  console.log('true UTC now        :', trueUtc.toISOString());
  console.log('system local now    :', new Date().toString());
  console.log('tz offset (min)     :', -trueUtc.getTimezoneOffset());

  const tf = '5m';
  const symbol = 'XAUUSD';
  const bridge = await bridgeCandles(5000, symbol, tf);
  console.log(`\nbridge ${symbol} ${tf} (last 3 as returned):`);
  for (const b of bridge.slice(-3)) {
    // This mirrors mt5-connection-manager.getCandles EXACTLY:
    //   timestamp: new Date(b.timestamp)
    const raw = b.timestamp;
    const asDate = new Date(raw);
    const driftMin = (asDate.getTime() - trueUtc.getTime()) / 60000;
    console.log(
      `  raw=${JSON.stringify(raw)}` +
      `  new Date()=${asDate.toISOString()}` +
      `  vs now=${driftMin.toFixed(1)}min` +
      (driftMin > 0 ? '   <-- FUTURE' : ''),
    );
  }

  // Which bars would land in the future if inserted verbatim?
  const future = bridge.filter((b) => new Date(b.timestamp).getTime() > trueUtc.getTime());
  console.log(`\nbars from this response that WOULD be future-dated: ${future.length}`);
  for (const b of future.slice(0, 3)) {
    console.log(`  ${JSON.stringify(b.timestamp)} -> ${new Date(b.timestamp).toISOString()}`);
  }

  // Compare against what is actually stored, newest-first, for the same symbol/tf.
  const stored = await prisma.$queryRawUnsafe(
    `SELECT b.timestamp, b.importedAt
       FROM marketbar b JOIN symbol s ON s.id = b.symbolId
      WHERE s.ticker = ? AND b.timeframe = ?
      ORDER BY b.timestamp DESC LIMIT 3`,
    symbol, tf,
  );
  console.log(`\nstored newest ${symbol} ${tf}:`);
  for (const r of stored) {
    const ts = r.timestamp instanceof Date ? r.timestamp : new Date(String(r.timestamp));
    console.log(`  stored=${ts.toISOString()}  vs true UTC now = ${((ts.getTime() - trueUtc.getTime()) / 60000).toFixed(0)}min`);
  }

  console.log('\nINTERPRETATION');
  console.log('  If the bridge values are NOT in the future but stored values ARE,');
  console.log('  the shift happens inside the refresh path, not at the source.');
  console.log('  If the bridge values ARE in the future, the bridge is the source.');

  await prisma.$disconnect();
})().catch(async (e) => {
  console.error('FAILED:', e.message);
  await prisma.$disconnect();
  process.exit(1);
});
