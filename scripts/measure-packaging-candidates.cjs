#!/usr/bin/env node
/**
 * measure-packaging-candidates.cjs — the evidence behind "which 2-3 strategies ship?".
 *
 * Owner, 2026-11-02: only 2-3 strategies will be packaged for the public; the rest stay in the
 * local database. The question is which, and the owner named a specific worry: positions reach
 * profit and then bleed it away before closing.
 *
 * ⚠️ WHY THIS IS A SCRIPT AND NOT A ONE-OFF QUERY. Every figure below is re-derivable after the
 * next change, and the previous session's attempt to rank protocols by P&L was unusable because
 * the numbers were gathered ad hoc and could not be re-measured. This prints the basis for each
 * number (which table, which filter, which window) so a reader can check it rather than trust it.
 *
 * WHAT IT MEASURES, AND WHAT EACH THING CANNOT TELL YOU
 *   1. Realised P&L per protocol/bot — cannot rank strategies: sample sizes are 1-23 and the P&L
 *      unit differs per instrument (0.01-lot FX pennies vs 0.1-lot index pounds).
 *   2. GIVE-BACK — of the trades that were ever in profit, how many closed at or below zero, and
 *      how much peak profit was surrendered. This is the owner's complaint, measured.
 *      ⚠️ Only meaningful for trades after #998 (2026-09-25) because `trade.peakProfitPct` did
 *      not exist before it. The script states the earliest usable date rather than blending.
 *   3. Backtest evidence per protocol — the only place a strategy can be judged on more than a
 *      handful of trades.
 *   4. Instrument coverage — whether a candidate can actually be traded (bars, route, floor).
 *
 * USAGE
 *   node scripts/measure-packaging-candidates.cjs
 *   node scripts/measure-packaging-candidates.cjs --json > logs/packaging.json
 */

const ROOT = require('path').resolve(__dirname, '..');
const N = (v) => (v === null || v === undefined ? null : Number(v));
const money = (v) => (v === null ? '     -' : N(v).toFixed(2).padStart(9));
const pct = (v) => (v === null ? '   -' : N(v).toFixed(1).padStart(6));

async function main() {
  const asJson = process.argv.includes('--json');
  const { PrismaClient } = require(`${ROOT}/nest/node_modules/@prisma/client`);
  const prisma = new PrismaClient();

  try {
    // ── 1. realised P&L per protocol ──
    const perProtocol = await prisma.$queryRawUnsafe(`
      SELECT ts.protocolId AS proto, ts.name AS bot, ts.symbol AS symbol, ts.active AS active,
             COUNT(t.id) AS n,
             SUM(CASE WHEN t.pnl > 0 THEN 1 ELSE 0 END) AS wins,
             SUM(t.pnl) AS net, MIN(t.pnl) AS worst, MAX(t.pnl) AS best,
             AVG(t.pnl) AS avgPnl,
             MIN(DATE(t.openedAt)) AS firstSeen, MAX(DATE(t.openedAt)) AS lastSeen
      FROM trade t JOIN trading_strategy ts ON ts.id = t.scoringStrategyId
      WHERE t.closedAt IS NOT NULL
      GROUP BY ts.id, ts.protocolId, ts.name, ts.symbol, ts.active
      ORDER BY SUM(t.pnl) DESC`);

    // ── 2. GIVE-BACK — the owner's complaint ──
    // `trade.peakProfitPct` is the high-water mark of signed profit% while the position was open
    // (common/trading/peak.ts, #998). A trade that PEAKED positive and CLOSED <= 0 surrendered
    // the whole move.
    const giveBack = await prisma.$queryRawUnsafe(`
      SELECT ts.protocolId AS proto, ts.symbol AS symbol,
             COUNT(*) AS sampled,
             SUM(CASE WHEN t.peakProfitPct > 0 AND t.pnl <= 0 THEN 1 ELSE 0 END) AS bledToRed,
             SUM(CASE WHEN t.peakProfitPct >= 0.3 AND t.pnl <= 0 THEN 1 ELSE 0 END) AS bledFrom03,
             AVG(CASE WHEN t.peakProfitPct > 0 THEN t.peakProfitPct END) AS avgPeakPct,
             SUM(CASE WHEN t.peakProfitPct > 0 AND t.pnl <= 0 THEN t.peakProfitPct ELSE 0 END) AS surrenderedPct,
             MIN(DATE(t.openedAt)) AS firstSeen
      FROM trade t JOIN trading_strategy ts ON ts.id = t.scoringStrategyId
      WHERE t.closedAt IS NOT NULL AND t.peakProfitPct IS NOT NULL
      GROUP BY ts.protocolId, ts.symbol
      HAVING COUNT(*) >= 3
      ORDER BY bledToRed DESC, surrenderedPct DESC`);
    const giveBackOverall = await prisma.$queryRawUnsafe(`
      SELECT COUNT(*) AS sampled,
             SUM(CASE WHEN peakProfitPct > 0 AND pnl <= 0 THEN 1 ELSE 0 END) AS bledToRed,
             MIN(DATE(openedAt)) AS firstSeen, MAX(DATE(openedAt)) AS lastSeen
      FROM trade WHERE closedAt IS NOT NULL AND peakProfitPct IS NOT NULL`);

    // ── 3. backtest evidence per protocol ──
    // ⚠️ `backtestrun.totalPnl` is the run's own simulated result. It is the only sample large
    // enough to judge a strategy on, and it is still a simulation with its own cost assumptions.
    // ⚠️ There is no `status` column on this table — a run that finished IS the row. Runs with
    // `totalTrades = 0` are excluded because a zero-trade run carries no evidence either way.
    const backtests = await prisma.$queryRawUnsafe(`
      SELECT protocolId AS proto, COUNT(*) AS runs,
             SUM(CASE WHEN totalPnl > 0 THEN 1 ELSE 0 END) AS profitable,
             MAX(totalPnl) AS best, MIN(totalPnl) AS worst, AVG(totalPnl) AS mean,
             MAX(createdAt) AS lastRun
      FROM backtestrun
      WHERE totalTrades > 0
      GROUP BY protocolId
      ORDER BY COUNT(*) DESC`);
    const backtestSymbols = await prisma.$queryRawUnsafe(`
      SELECT r.protocolId AS proto, s.ticker AS symbol, COUNT(*) AS runs,
             SUM(CASE WHEN r.totalPnl > 0 THEN 1 ELSE 0 END) AS profitable,
             AVG(r.totalPnl) AS mean, MAX(r.totalPnl) AS best
      FROM backtestrun r JOIN symbol s ON s.id = r.symbolId
      WHERE r.totalTrades > 0
      GROUP BY r.protocolId, s.ticker
      HAVING COUNT(*) >= 3
      ORDER BY AVG(r.totalPnl) DESC
      LIMIT 25`);

    // ── 4. instrument coverage for the candidates ──
    const coverage = await prisma.$queryRawUnsafe(`
      SELECT s.ticker,
             (SELECT COUNT(*) FROM marketbar b WHERE b.symbolId = s.id) AS bars,
             (SELECT MAX(b.timestamp) FROM marketbar b WHERE b.symbolId = s.id) AS newestBar,
             (SELECT GROUP_CONCAT(DISTINCT pr.slug) FROM symbol_protocol_assignment a
                JOIN protocol pr ON pr.id = a.protocolId WHERE a.symbol = s.ticker) AS protos
      FROM symbol s
      WHERE s.ticker IN ('NVDA','XAGUSD','XAUUSD','SPY','QQQ','US500','USTEC','BTC','ETH','EURUSD','GBPUSD','USDJPY','VIX','TSLA','AAPL','MSFT')
      ORDER BY s.ticker`);

    if (asJson) {
      console.log(JSON.stringify({ perProtocol, giveBack, giveBackOverall, backtests, backtestSymbols, coverage },
        (k, v) => (typeof v === 'bigint' ? Number(v) : v), 2));
      return;
    }

    console.log('\n════════ 1. REALISED P&L PER BOT (trade table, closed only) ════════');
    console.log('PROTOCOL             | SYMBOL  | n  | wins |      net |    worst |     best |    avg');
    for (const r of perProtocol) {
      console.log(
        `${String(r.proto).padEnd(20)} | ${String(r.symbol).padEnd(7)} | ${String(N(r.n)).padStart(2)} | ` +
        `${String(N(r.wins)).padStart(4)} | ${money(r.net)} | ${money(r.worst)} | ${money(r.best)} | ${money(r.avgPnl)}`,
      );
    }

    console.log('\n════════ 2. GIVE-BACK (#998 peak record — the owner\'s complaint) ════════');
    console.log(`sampled: ${N(giveBackOverall[0].sampled)} trades with a recorded peak, ` +
      `${String(giveBackOverall[0].firstSeen).slice(0, 10)} -> ${String(giveBackOverall[0].lastSeen).slice(0, 10)}`);
    console.log(`PEAKED POSITIVE AND CLOSED AT/BELOW ZERO: ${N(giveBackOverall[0].bledToRed)} of ${N(giveBackOverall[0].sampled)}`);
    console.log('\nPROTOCOL             | SYMBOL  | n  | bled | >=0.3% | avgPeak% | surrendered%points');
    for (const r of giveBack) {
      console.log(
        `${String(r.proto).padEnd(20)} | ${String(r.symbol).padEnd(7)} | ${String(N(r.sampled)).padStart(2)} | ` +
        `${String(N(r.bledToRed)).padStart(4)} | ${String(N(r.bledFrom03)).padStart(6)} | ${pct(r.avgPeakPct)} | ${pct(r.surrenderedPct)}`,
      );
    }

    console.log('\n════════ 3. BACKTEST EVIDENCE (backtestrun, status=complete) ════════');
    console.log('PROTOCOL             | runs | profit |      best |     worst |      mean | last run');
    for (const r of backtests) {
      console.log(
        `${String(r.proto).padEnd(20)} | ${String(N(r.runs)).padStart(4)} | ${String(N(r.profitable)).padStart(6)} | ` +
        `${money(r.best)} | ${money(r.worst)} | ${money(r.mean)} | ${String(r.lastRun).slice(0, 10)}`,
      );
    }

    console.log('\n-- per protocol+symbol, runs >= 3, best mean first --');
    for (const r of backtestSymbols) {
      console.log(
        `${String(r.proto).padEnd(20)} ${String(r.symbol).padEnd(8)} runs=${String(N(r.runs)).padStart(3)} ` +
        `profit=${String(N(r.profitable)).padStart(3)} mean=${money(r.mean)} best=${money(r.best)}`,
      );
    }

    console.log('\n════════ 4. INSTRUMENT COVERAGE ════════');
    for (const r of coverage) {
      const age = r.newestBar ? ((Date.now() - new Date(r.newestBar).getTime()) / 3_600_000).toFixed(1) + 'h' : 'NONE';
      console.log(`${String(r.ticker).padEnd(8)} bars=${String(N(r.bars)).padStart(7)} newest=${age.padStart(8)} protos=${r.protos || '-'}`);
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
