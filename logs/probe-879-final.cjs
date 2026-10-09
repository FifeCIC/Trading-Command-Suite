// #879 final measurements: (a) turnaround-tuesday claim (Tuesday bearish?) by the same DiD;
// (b) crypto-weekend-effect claims: weekend VOLUME vs weekday (measurable from daily bars)
// and weekend/Monday RETURNS (dow 0/6 vs others; Monday-early hours are not visible at 1d).
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
    `SELECT s.ticker AS ticker, m.timestamp AS ts, m.close AS close, m.volume AS vol
     FROM marketbar m JOIN symbol s ON s.id = m.symbolId
     WHERE m.timeframe = '1d' ORDER BY s.ticker, m.timestamp ASC`,
  );
  const bySymbol = new Map();
  for (const r of rows) {
    if (!bySymbol.has(r.ticker)) bySymbol.set(r.ticker, []);
    bySymbol.get(r.ticker).push({ ts: new Date(r.ts), close: Number(r.close), vol: Number(r.vol) });
  }

  // (a) TUESDAY DiD — P(down|Tue) - P(down|others)
  const tue = [];
  for (const [ticker, bars] of bySymbol) {
    if (bars.length < 60) continue;
    let n1 = 0, d1 = 0, n0 = 0, d0 = 0;
    for (let i = 1; i < bars.length; i++) {
      const down = bars[i].close < bars[i - 1].close;
      if (bars[i].ts.getUTCDay() === 2) { n1++; if (down) d1++; } else { n0++; if (down) d0++; }
    }
    if (n1 < 20 || n0 < 20) continue;
    const p1 = d1 / n1, p0 = d0 / n0;
    const se = Math.sqrt(p1 * (1 - p1) / n1 + p0 * (1 - p0) / n0);
    tue.push({ ticker, diff: p1 - p0, sigma: se > 0 ? (p1 - p0) / se : 0 });
  }
  const meanT = tue.reduce((s, r) => s + r.diff, 0) / tue.length;
  const sdT = Math.sqrt(tue.reduce((s, r) => s + (r.diff - meanT) ** 2, 0) / tue.length);
  console.log(`== TUESDAY: ${tue.length} symbols; mean Tue-vs-other DOWN excess ${(meanT * 100).toFixed(2)}pp (t=${(meanT / (sdT / Math.sqrt(tue.length))).toFixed(2)}); at >=2 sigma ${tue.filter((r) => r.sigma >= 2).length}; at >=3.2 sigma ${tue.filter((r) => r.sigma >= 3.2).length}`);
  tue.sort((a, b) => b.diff - a.diff);
  for (const r of tue.slice(0, 3)) console.log(`   top: ${r.ticker} ${(r.diff * 100).toFixed(1)}pp sigma ${r.sigma.toFixed(2)}`);

  // (b) CRYPTO weekend volume + returns
  console.log('\n== CRYPTO (weekend-effect claims: weekend volume lower? Sat/Sun returns?)');
  for (const [ticker, bars] of bySymbol) {
    if (!/^(BTC|ETH|SOL)/.test(ticker)) continue;
    const byDow = new Map();
    for (let i = 1; i < bars.length; i++) {
      const d = bars[i].ts.getUTCDay();
      if (!byDow.has(d)) byDow.set(d, { n: 0, vol: 0, down: 0 });
      const e = byDow.get(d);
      e.n++; e.vol += bars[i].vol; if (bars[i].close < bars[i - 1].close) e.down++;
    }
    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const fmt = [...byDow.entries()].sort((a, b) => a[0] - b[0]).map(([d, e]) => `${days[d]} v=${Math.round(e.vol / e.n)} down=${((e.down / e.n) * 100).toFixed(0)}% n=${e.n}`);
    console.log(`${ticker}: ${fmt.join(' | ')}`);
  }
  await client.$disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
