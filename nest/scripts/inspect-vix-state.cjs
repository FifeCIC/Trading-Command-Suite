const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
const safe = (o) => JSON.stringify(o, (k, v) => (typeof v === 'bigint' ? Number(v) : v));
(async () => {
  await p.$connect();
  const vixBars = await p.$queryRawUnsafe(
    "SELECT COUNT(*) n, MAX(timestamp) last FROM marketbar mb JOIN symbol s ON mb.symbolId=s.id WHERE s.ticker='VIX'"
  );
  console.log('vix bars:', safe(vixBars));
  const total = await p.$queryRawUnsafe("SELECT COUNT(*) n FROM score WHERE strategyId='vix-spike-v1'");
  console.log('total rows:', safe(total));
  const byTicker = await p.$queryRawUnsafe(`
    SELECT s.ticker, COUNT(*) n, MAX(sc.value) maxv FROM score sc JOIN symbol s ON sc.symbolId=s.id
    WHERE sc.strategyId='vix-spike-v1' GROUP BY s.ticker ORDER BY n DESC LIMIT 8
  `);
  console.log('tickers:', safe(byTicker));
  const recent = await p.$queryRawUnsafe(`
    SELECT s.ticker, sc.value, sc.timestamp FROM score sc JOIN symbol s ON sc.symbolId=s.id
    WHERE sc.strategyId='vix-spike-v1' ORDER BY sc.timestamp DESC LIMIT 5
  `);
  console.log('recent:', safe(recent));
  await p.$disconnect();
})();
