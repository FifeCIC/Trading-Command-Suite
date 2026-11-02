#!/usr/bin/env node
/**
 * baseline-three-protocols.cjs — the shipped three, measured on the canonical window.
 *
 * Owner, 2026-11-02: *"goal to make the 3 whole strategies profit regularly… When backtesting
 * protocols shows that plenty signals will be generated we will move onto Backtesting Strategies."*
 *
 * So the FIRST question is not profit, it is SIGNALS: does the protocol produce enough entries to
 * even be judged? A protocol that scores every bar and never crosses its threshold is not a bad
 * strategy, it is a mis-tuned one — and the two need different fixes.
 *
 * Per arm it records, from `POST /api/backtest/run`:
 *   totalSignals  — bars where the composite crossed the entry threshold
 *   totalTrades   — signals that became a bracketed trade (affordability, brackets, exits)
 *   tradeWinRate / avgTradePnl / tradeProfitFactor / netPnl
 *
 * ⚠️ `profitFactor` is SIGNAL-based and invariant to exits; `tradeProfitFactor` is the trade-based
 * one. Both are printed so the difference is visible rather than assumed (register row 126).
 *
 * USAGE
 *   node scripts/baseline-three-protocols.cjs
 *   node scripts/baseline-three-protocols.cjs --json
 */

// ⚠️ 127.0.0.1, not `localhost`. Node's fetch resolves `localhost` to `::1` first and the API
// binds IPv4 only, so `localhost` fails with `fetch failed` while curl (which falls back) succeeds.
// Measured 2026-11-02: this script worked against `localhost` earlier the same day and then stopped.
const API = 'http://127.0.0.1:3201/api';
const N = (v) => (v === null || v === undefined ? null : Number(v));

/**
 * Each shipped bot, at the configuration it actually runs. `note` records where the canonical
 * window cannot measure the bot's own timeframe — stated per arm rather than silently substituted.
 */
const ARMS = [
  { protocol: 'xau-speed-v1', symbol: 'XAGUSD', timeframe: '5m', bot: 'Silver Speed Scalp' },
  { protocol: 'momentum-stock-v1', symbol: 'NVDA', timeframe: '1h', bot: 'Tech Giants - NVDA (runs 15m)' },
  { protocol: 'forex-session-v1', symbol: 'USDJPY', timeframe: '1h', bot: 'Tokyo USDJPY Session' },
];

async function run(arm) {
  const res = await fetch(`${API}/backtest/run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      symbol: arm.symbol,
      protocolId: arm.protocol,
      timeframe: arm.timeframe,
      directionMode: 'long',
      newsExclusion: 'none',
    }),
  });
  const json = await res.json();
  if (!res.ok || json.error || !json.stats) {
    return { ...arm, ok: false, error: json.message || `HTTP ${res.status}` };
  }
  const s = json.stats;
  return {
    ...arm,
    ok: true,
    runId: json.id,
    bars: json.scoreSeries ? json.scoreSeries.length : null,
    totalSignals: N(s.totalSignals),
    totalTrades: N(s.totalTrades),
    tradeWinRate: N(s.tradeWinRate),
    signalWinRate: N(s.winRate),
    avgPct: N(s.avgTradePnl),
    tradeProfitFactor: N(s.tradeProfitFactor),
    signalProfitFactor: N(s.profitFactor),
    netPnl: N(s.netPnl ?? s.totalPnl),
    avgWin: N(s.avgWinPct),
    avgLoss: N(s.avgLossPct),
    breakEven: N(s.breakEvenWinRatePct),
    gap: N(s.breakEvenGapPp),
    refused: N(s.tradesRefusedUnaffordable),
    window: s.windowSource,
  };
}

async function main() {
  const asJson = process.argv.includes('--json');
  const out = [];
  for (const arm of ARMS) out.push(await run(arm));

  if (asJson) {
    console.log(JSON.stringify(out, null, 2));
    return;
  }

  console.log('\n════════ THE THREE SHIPPED STRATEGIES — Protocol backtest, canonical window ════════\n');
  for (const r of out) {
    console.log(`── ${r.protocol} · ${r.symbol} ${r.timeframe}  (${r.bot})`);
    if (!r.ok) {
      console.log(`   ✖ ${r.error}\n`);
      continue;
    }
    console.log(`   signals ${r.totalSignals}   trades ${r.totalTrades}   refused(unaffordable) ${r.refused}`);
    console.log(
      `   win ${r.tradeWinRate === null ? '-' : (r.tradeWinRate * 100).toFixed(0) + '%'}   ` +
      `avg ${r.avgPct.toFixed(3)}%/trade   tradePF ${r.tradeProfitFactor === null ? 'n/a' : r.tradeProfitFactor.toFixed(2)}   ` +
      `net ${r.netPnl.toFixed(2)}`,
    );
    console.log(
      `   avgWin ${r.avgWin.toFixed(2)}%  avgLoss ${r.avgLoss.toFixed(2)}%  ` +
      `breakEven ${r.breakEven === null ? '-' : r.breakEven.toFixed(1) + '%'}  gap ${r.gap === null ? '-' : r.gap + 'pp'}`,
    );
    console.log(`   window ${r.window}\n`);
  }

  const ok = out.filter((r) => r.ok);
  console.log('───────────────────────────────────────────────────────────────────────────');
  const signalTotal = ok.reduce((a, r) => a + r.totalSignals, 0);
  console.log(`signals across the three: ${signalTotal}   trades: ${ok.reduce((a, r) => a + r.totalTrades, 0)}`);
  const profitable = ok.filter((r) => r.netPnl > 0);
  console.log(`profitable: ${profitable.length} of ${ok.length}` +
    (profitable.length ? ` (${profitable.map((r) => r.protocol).join(', ')})` : ''));
  console.log('');
}

main().catch((e) => {
  console.error('❌', e && e.message ? e.message : e);
  process.exit(1);
});
