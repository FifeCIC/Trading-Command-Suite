import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
const DAY = '2026-11-10', CUT = '15:30';  // 10:30 ET

(async () => {
  // every symbol with 5m bars on the day
  const syms = await p.$queryRawUnsafe(`
    SELECT DISTINCT s.ticker FROM marketbar b JOIN symbol s ON s.id=b.symbolId
    WHERE b.timeframe='5m' AND b.timestamp >= '${DAY}' AND b.timestamp < DATE_ADD('${DAY}', INTERVAL 1 DAY)`);
  const tickers = syms.map(r => r.ticker);

  const rows = await p.$queryRawUnsafe(`
    SELECT s.ticker, b.timestamp, b.close FROM marketbar b JOIN symbol s ON s.id=b.symbolId
    WHERE b.timeframe='5m' AND s.ticker IN (${tickers.map(t => `'${t}'`).join(',')})
      AND b.timestamp >= DATE_SUB('${DAY}', INTERVAL 6 DAY) AND b.timestamp < DATE_ADD('${DAY}', INTERVAL 1 DAY)
    ORDER BY s.ticker, b.timestamp`);

  const bySym = new Map();
  for (const r of rows) {
    const t = r.ticker; if (!bySym.has(t)) bySym.set(t, []);
    bySym.get(t).push({ ts: r.timestamp, close: Number(r.close) });
  }

  const dayKey = d => d.toISOString().slice(0, 10);
  const out = [];
  for (const [t, bars] of bySym) {
    const dayBars = bars.filter(b => dayKey(b.ts) === DAY);
    if (!dayBars.length) continue;
    const prior = [...new Set(bars.filter(b => dayKey(b.ts) < DAY).map(b => dayKey(b.ts)))].sort();
    const prevDay = prior[prior.length - 1];
    if (!prevDay) continue;
    const prevBars = bars.filter(b => dayKey(b.ts) === prevDay);
    const prevClose = prevBars[prevBars.length - 1].close;
    if (!prevClose) continue;
    const atCut = dayBars.filter(b => b.ts.toISOString().slice(11, 16) <= CUT);
    if (!atCut.length) continue;
    const cutClose = atCut[atCut.length - 1].close;
    const eod = dayBars[dayBars.length - 1].close;
    out.push({ t, cutPct: (cutClose - prevClose) / prevClose * 100, eodPct: (eod - prevClose) / prevClose * 100 });
  }

  const top = (arr, n, dir) => [...arr].sort((a, b) => dir * (a - b)).slice(0, n);
  const losersCut = top(out.map(o => ({ t: o.t, v: o.cutPct })), 10, 1).map(o => o.t);
  const losersEod = top(out.map(o => ({ t: o.t, v: o.eodPct })), 10, 1).map(o => o.t);
  const winnersCut = top(out.map(o => ({ t: o.t, v: o.cutPct })), 10, -1).map(o => o.t);
  const winnersEod = top(out.map(o => ({ t: o.t, v: o.eodPct })), 10, -1).map(o => o.t);
  const overlap = (a, b) => a.filter(x => b.includes(x));

  console.log(`symbols measured: ${out.length}`);
  console.log(`LOSERS  top10 @cutoff: ${losersCut.join(',')}`);
  console.log(`LOSERS  top10 @EOD   : ${losersEod.join(',')}`);
  console.log(`LOSERS  overlap      : ${overlap(losersCut, losersEod).length}/10  [${overlap(losersCut, losersEod).join(',')}]`);
  console.log(`WINNERS top10 @cutoff: ${winnersCut.join(',')}`);
  console.log(`WINNERS top10 @EOD   : ${winnersEod.join(',')}`);
  console.log(`WINNERS overlap      : ${overlap(winnersCut, winnersEod).length}/10  [${overlap(winnersCut, winnersEod).join(',')}]`);
  await p.$disconnect();
})();
