// #879: turnaround-tuesday's actual claim — P(Tuesday UP | Monday closed DOWN) vs the
// unconditional Tuesday UP rate, per symbol (difference-in-differences on the SAME series).
const path = require('path');
const fs = require('fs');
const NEST = 'C:\\wamp64\\www\\trading-command-suite\\nest';
for (const line of fs.readFileSync(path.join(NEST, '.env'), 'utf8').split(/\r?\n/)) {
  const kv = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (kv && !process.env[kv[1]]) process.env[kv[1]] = kv[2].replace(/^['"]|['"]$/g, '');
}
const { PrismaClient } = require(path.join(NEST, 'node_modules', '@prisma', 'client'));
const client = new PrismaClient();

(async () => {
  await client.$connect();
  const rows = await client.$queryRawUnsafe(
    `SELECT s.ticker AS ticker, m.timestamp AS ts, m.close AS close
     FROM marketbar m JOIN symbol s ON s.id = m.symbolId
     WHERE m.timeframe = '1d' ORDER BY s.ticker, m.timestamp ASC`,
  );
  const bySymbol = new Map();
  for (const r of rows) {
    if (!bySymbol.has(r.ticker)) bySymbol.set(r.ticker, []);
    bySymbol.get(r.ticker).push({ ts: new Date(r.ts), close: Number(r.close) });
  }
  const res = [];
  for (const [ticker, bars] of bySymbol) {
    if (bars.length < 60) continue;
    let condN = 0, condUp = 0, allTueN = 0, allTueUp = 0;
    for (let i = 2; i < bars.length; i++) {
      if (bars[i].ts.getUTCDay() !== 2) continue;
      const tueUp = bars[i].close > bars[i - 1].close;
      const monDown = bars[i - 1].close < bars[i - 2].close;
      allTueN++; if (tueUp) allTueUp++;
      if (monDown) { condN++; if (tueUp) condUp++; }
    }
    if (condN < 10 || allTueN < 20) continue;
    const pCond = condUp / condN, pAll = allTueUp / allTueN;
    const lift = pCond - pAll;
    const se = Math.sqrt(pCond * (1 - pCond) / condN + pAll * (1 - pAll) / allTueN);
    res.push({ ticker, condN, pCond, pAll, lift, sigma: se > 0 ? lift / se : 0 });
  }
  res.sort((a, b) => b.lift - a.lift);
  console.log(`symbols: ${res.length}   claim: Tuesday UP rate after a red Monday, minus the unconditional Tuesday UP rate\n`);
  console.log('ticker       nMon-red  P(Tue up|red Mon)  P(Tue up)   lift     sigma');
  for (const r of res) {
    console.log(`${r.ticker.padEnd(12)} ${String(r.condN).padStart(5)}  ${(r.pCond * 100).toFixed(1).padStart(15)}%  ${(r.pAll * 100).toFixed(1).padStart(7)}%  ${(r.lift * 100).toFixed(1).padStart(5)}pp ${r.sigma.toFixed(2).padStart(6)}`);
  }
  const mean = res.reduce((s, r) => s + r.lift, 0) / res.length;
  const sd = Math.sqrt(res.reduce((s, r) => s + (r.lift - mean) ** 2, 0) / res.length);
  console.log(`\nmean lift: ${(mean * 100).toFixed(2)}pp (t=${(mean / (sd / Math.sqrt(res.length))).toFixed(2)})`);
  console.log(`at >=2 sigma: ${res.filter((r) => r.sigma >= 2).length} of ${res.length};  at >=3.2 sigma: ${res.filter((r) => r.sigma >= 3.2).length}`);
  await client.$disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
