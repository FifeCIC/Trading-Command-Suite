// #879 measurement: monday-effect, by the friday-drift method (difference-in-differences).
// For every symbol with enough 1d history: P(close DOWN | Monday) vs P(close DOWN | all
// other sessions) on the SAME series. The control cancels bar-source skew (the trap the
// issue documents: raw weekend-gap rates looked like an 80%+ edge and were an artefact).
// The honest threshold with K symbols tested is ~3.2 sigma (Bonferroni), not 2.
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
     WHERE m.timeframe = '1d'
     ORDER BY s.ticker, m.timestamp ASC`,
  );
  const bySymbol = new Map();
  for (const r of rows) {
    if (!bySymbol.has(r.ticker)) bySymbol.set(r.ticker, []);
    bySymbol.get(r.ticker).push({ ts: new Date(r.ts), close: Number(r.close) });
  }

  const results = [];
  for (const [ticker, bars] of bySymbol) {
    if (bars.length < 60) continue; // need both a Monday sample and a control sample
    let monN = 0, monDown = 0, othN = 0, othDown = 0;
    for (let i = 1; i < bars.length; i++) {
      const down = bars[i].close < bars[i - 1].close; // session return vs PREVIOUS close
      const isMon = bars[i].ts.getUTCDay() === 1;
      if (isMon) { monN++; if (down) monDown++; }
      else { othN++; if (down) othDown++; }
    }
    if (monN < 20 || othN < 20) continue;
    const pMon = monDown / monN, pOth = othDown / othN;
    const diff = pMon - pOth; // >0 => Mondays fall MORE (the directive's bearish claim)
    const se = Math.sqrt(pMon * (1 - pMon) / monN + pOth * (1 - pOth) / othN);
    results.push({ ticker, monN, pMon, pOth, diff, sigma: se > 0 ? diff / se : 0 });
  }

  results.sort((a, b) => b.diff - a.diff);
  console.log(`symbols tested: ${results.length} (per-symbol DiD: P(down|Mon) - P(down|others))\n`);
  console.log('ticker        nMon  P(down|Mon)  P(down|oth)   diff      sigma');
  for (const r of results) {
    console.log(
      `${r.ticker.padEnd(12)} ${String(r.monN).padStart(4)}  ${(r.pMon * 100).toFixed(1).padStart(9)}%  ${(r.pOth * 100).toFixed(1).padStart(9)}%  ${(r.diff * 100).toFixed(1).padStart(5)}pp  ${r.sigma.toFixed(2).padStart(6)}`,
    );
  }

  const meanDiff = results.reduce((s, r) => s + r.diff, 0) / results.length;
  const sd = Math.sqrt(results.reduce((s, r) => s + (r.diff - meanDiff) ** 2, 0) / results.length);
  const meanSigma = sd > 0 ? meanDiff / (sd / Math.sqrt(results.length)) : 0;
  const at2 = results.filter((r) => r.sigma >= 2).length;
  const at32 = results.filter((r) => r.sigma >= 3.2).length;
  console.log(`\nmean Monday-vs-other DOWN excess: ${(meanDiff * 100).toFixed(2)}pp (t=${meanSigma.toFixed(2)} across symbols)`);
  console.log(`symbols at >=2 sigma : ${at2} of ${results.length}`);
  console.log(`symbols at >=3.2 sigma (Bonferroni): ${at32} of ${results.length}`);
  await client.$disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
