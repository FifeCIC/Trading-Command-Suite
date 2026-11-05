#!/usr/bin/env node
/**
 * rank-strategies-scale-free.cjs — rank backtests on metrics that survive a sizing change.
 *
 * ⚠️ WHY NOT `totalPnl`. Measured 2026-11-02 on `probe-1dir-rsi-long`/XAGUSD: `totalPnl` 2,792.68
 * across 13 trades while `avgTradePnl` was 1.62. Those are NOT in conflict — `totalPnl` sums
 * `trade.pnl` (CURRENCY, so it moves with notional and leverage) and `avgTradePnl` averages
 * `trade.pnlPct` (PERCENT, scale-free). `winRate` is likewise a FRACTION of entry signals while
 * `tradeWinRate` is a fraction of trades.
 *
 * So ranking strategies by `totalPnl` ranks them by how much notional each run happened to use.
 * This script ranks on the percentage metrics instead, and prints the currency figure beside them
 * only so a reader can see the difference rather than be misled by it.
 *
 * MIN_TRADES guards the noise floor: a 3-trade run averaging +8% is not evidence.
 *
 * USAGE
 *   node scripts/rank-strategies-scale-free.cjs
 *   node scripts/rank-strategies-scale-free.cjs --min-trades 12
 */

const ROOT = require('path').resolve(__dirname, '..');
const N = (v) => (v === null || v === undefined ? null : Number(v));

async function main() {
  const i = process.argv.indexOf('--min-trades');
  const MIN = i >= 0 ? Number(process.argv[i + 1]) : 10;

  const { PrismaClient } = require(`${ROOT}/nest/node_modules/@prisma/client`);
  const prisma = new PrismaClient();

  try {
    // Group by protocol + symbol + timeframe so a run is compared with a like run.
    // AVG over runs (not a single best run): one lucky run is not a strategy.
    // ⚠️ `tradeWinRate` exists on the in-memory result but is NOT a column on `backtestrun`
    // (checked with db-schema.cjs, 2026-11-02) — the persisted win rate is `winRate`, a FRACTION
    // of entry signals. That means a run can show a low `winRate` and still profit, because the
    // population differs; `profitFactor` is the trustworthy profitability measure here.
    const rows = await prisma.$queryRawUnsafe(`
      SELECT r.protocolId AS proto, s.ticker AS symbol, r.timeframe AS tf,
             COUNT(*) AS runs,
             AVG(r.totalTrades) AS avgTrades,
             AVG(r.avgTradePnl) AS avgPct,
             AVG(r.winRate) AS winRateFrac,
             AVG(r.profitFactor) AS pf,
             AVG(r.maxDrawdown) AS dd,
             MAX(r.avgTradePnl) AS bestPct,
             MIN(r.avgTradePnl) AS worstPct,
             AVG(r.totalPnl) AS avgTotalPnl
      FROM backtestrun r JOIN symbol s ON s.id = r.symbolId
      WHERE r.totalTrades >= ?
      GROUP BY r.protocolId, s.ticker, r.timeframe
      HAVING COUNT(*) >= 2
      ORDER BY AVG(r.avgTradePnl) DESC`, MIN);

    console.log(`\nSCALE-FREE RANKING — runs with >= ${MIN} trades, averaged over >= 2 runs per cell`);
    console.log('(avgPct = mean % return per trade · PF = profit factor · winFrac = winRate column, a fraction)\n');
    console.log('PROTOCOL             | SYMBOL  | TF | runs | trades |   avgPct |     PF | winFrac |    maxDD | bestPct | worstPct');
    console.log('---------------------|---------|----|------|--------|----------|--------|---------|----------|---------|---------');

    for (const r of rows) {
      const pf = N(r.pf);
      const pct = N(r.avgPct);
      // A cell is interesting when it makes money on average AND its worst run did not lose money.
      const marker = pct > 0 && N(r.worstPct) > 0 && pf > 1.2 ? ' ←' : '';
      console.log(
        `${String(r.proto).padEnd(20)} | ${String(r.symbol).padEnd(7)} | ${String(r.tf).padEnd(2)} | ` +
        `${String(N(r.runs)).padStart(4)} | ${String(Math.round(N(r.avgTrades))).padStart(6)} | ` +
        `${pct.toFixed(2).padStart(8)} | ${(pf === null ? '-' : pf.toFixed(2)).padStart(6)} | ` +
        `${(N(r.winRateFrac) === null ? '-' : N(r.winRateFrac).toFixed(2)).padStart(7)} | ` +
        `${(N(r.dd) === null ? '-' : N(r.dd).toFixed(2)).padStart(8)} | ` +
        `${N(r.bestPct).toFixed(2).padStart(7)} | ${N(r.worstPct).toFixed(2).padStart(8)}${marker}`,
      );
    }

    const winners = rows.filter((r) => N(r.avgPct) > 0 && N(r.worstPct) > 0 && N(r.pf) > 1.2);
    console.log(`\n${rows.length} cell(s) with enough trades · ${winners.length} where EVERY run made money:`);
    for (const w of winners) {
      console.log(`  ✔ ${w.proto} / ${w.symbol} ${w.tf} — ${N(w.avgPct).toFixed(2)}%/trade over ~${Math.round(N(w.avgTrades))} trades, PF ${N(w.pf).toFixed(2)}`);
    }
    console.log('');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error('❌', e && e.message ? e.message : e);
  process.exit(1);
});
