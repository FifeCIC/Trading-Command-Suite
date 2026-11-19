#!/usr/bin/env node
/**
 * baseline-three-protocols.cjs — the shipped three, measured on the canonical window.
 *
 * Requirement, 2026-11-02: goal to make the 3 whole strategies profit regularly… When backtesting
 * protocols shows that plenty signals will be generated we will move onto Backtesting Strategies.
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
  { protocol: 'xau-speed-v1-long', symbol: 'XAGUSD', timeframe: '5m', bot: 'Silver Speed Scalp Bot' },
  { protocol: 'momentum-stock-v1-long', symbol: 'NVDA', timeframe: '1h', bot: 'Tech Giants - NVDA (runs 15m)' },
  { protocol: 'forex-session-v1-long', symbol: 'USDJPY', timeframe: '1h', bot: 'Tokyo USDJPY Session Bot' },
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
      // ⚠️ `fullScoreSeries` IS ASKED FOR SO THE NOISE FLOOR CAN BE MEASURED (2026-11-14).
      // It changes nothing about the numbers below — `minComposite` already defaults to 0 here —
      // it only adds the per-bar scores, which is the only way to see whether the entry bar sits
      // ABOVE the score a protocol emits when nothing is happening.
      fullScoreSeries: true,
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
    floor: noiseFloor(json.scoreSeries),
  };
}

/**
 * noiseFloor() — the score a protocol emits most often, and how much of the run it is.
 *
 * ── WHY THIS EXISTS (measured 2026-11-14) ──
 * A protocol scored on USDJPY/1h produced **11,945 readings in 7 days with only 16 distinct
 * values**, and **84.6% of them were the identical 8.391608%** (= raw 60 of capacity 715). That is
 * not noise on top of a signal; that IS the no-signal state, and it carries a non-zero score.
 *
 * The consequence is arithmetic, not opinion: a bot whose `minComposite` is at or below that modal
 * value trades the protocol's *neutral* reading on every bar. Measured on the same protocol —
 * entry bar 8.0 → 803 trades and −£1,002; bar 8.4 → 159 trades and +£66. The whole difference is
 * whether the no-signal mode is admitted.
 *
 * ⚠️ `minComposite` is compared against `signalPct` (a percentage 0–100), NOT against the raw
 * additive `composite` (mean ~63). Both the live gate (`head.compositePct`) and the backtest
 * (`gated.signalPct`) read the percentage. Register row 178.
 */
function noiseFloor(series) {
  if (!Array.isArray(series) || series.length === 0) return null;
  const counts = new Map();
  for (const row of series) {
    const v = Number(row.signalPct);
    if (!Number.isFinite(v)) continue;
    counts.set(v, (counts.get(v) ?? 0) + 1);
  }
  if (counts.size === 0) return null;
  let mode = null;
  let n = 0;
  for (const [v, c] of counts) if (c > n) { mode = v; n = c; }
  const total = [...counts.values()].reduce((a, b) => a + b, 0);
  return { mode, share: (100 * n) / total, total, distinct: counts.size };
}

/** Active bots per protocol, so the bar can be compared against the measured floor. */
async function botsByProtocol() {
  try {
    const res = await fetch(`${API}/trading/strategies`);
    if (!res.ok) return new Map();
    const json = await res.json();
    const list = Array.isArray(json) ? json : (json.strategies ?? []);
    const map = new Map();
    for (const b of list) {
      if (!b || b.active === false || Number(b.active) === 0) continue;
      const key = b.protocolId;
      if (!key) continue;
      if (!map.has(key)) map.set(key, []);
      map.get(key).push({ name: b.name, bar: N(b.minComposite) });
    }
    return map;
  } catch {
    // A bot list that cannot be read must not take the measurement down — it only removes the
    // verdict, and the floor is still printed.
    return new Map();
  }
}


async function main() {
  const asJson = process.argv.includes('--json');
  const bots = await botsByProtocol();
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
    console.log(`   window ${r.window}`);

    // ── THE NOISE FLOOR (2026-11-14) ─────────────────────────────────────────────────────────
    // Printed on its own line and never merged into the performance numbers: it answers a
    // different question — "is the entry bar above the score this protocol emits when nothing is
    // happening?" A bar at or below the floor admits the no-signal state, which is arithmetic
    // rather than judgement.
    const f = r.floor;
    if (!f) {
      console.log('   floor   — could not be measured (no score series returned)\n');
      continue;
    }
    console.log(
      `   floor   ${f.mode.toFixed(2)}% is the MOST COMMON score — ${f.share.toFixed(1)}% of ${f.total} bars ` +
      `(${f.distinct} distinct value(s) in the whole run)`,
    );
    const bars = bots.get(r.protocol) ?? [];
    if (bars.length === 0) {
      console.log('   bar     — no active bot on this protocol could be read, so CANNOT JUDGE\n');
      continue;
    }
    for (const b of bars) {
      if (b.bar == null) {
        console.log(`   bar     ${b.name}: unreadable — cannot judge`);
        continue;
      }
      const verdict = b.bar > f.mode
        ? `✅ above the floor by ${(b.bar - f.mode).toFixed(2)}pp — admits genuine readings only`
        : `🛑 AT OR BELOW THE FLOOR — trades the protocol's no-signal state on every bar`;
      console.log(`   bar     ${b.name}: ${b.bar}% — ${verdict}`);
    }
    console.log('');
  }

  const ok = out.filter((r) => r.ok);
  console.log('───────────────────────────────────────────────────────────────────────────');
  const signalTotal = ok.reduce((a, r) => a + r.totalSignals, 0);
  console.log(`signals across the three: ${signalTotal}   trades: ${ok.reduce((a, r) => a + r.totalTrades, 0)}`);
  const profitable = ok.filter((r) => r.netPnl > 0);
  console.log(`profitable: ${profitable.length} of ${ok.length}` +
    (profitable.length ? ` (${profitable.map((r) => r.protocol).join(', ')})` : ''));
  const exposed = ok.filter((r) => {
    const f = r.floor;
    if (!f) return false;
    return (bots.get(r.protocol) ?? []).some((b) => b.bar != null && b.bar <= f.mode);
  });
  console.log(
    `entry bar at or below the noise floor: ${exposed.length} of ${ok.length}` +
    (exposed.length ? ` (${exposed.map((r) => r.protocol).join(', ')})` : ''),
  );
  console.log('');
}

main().catch((e) => {
  console.error('❌', e && e.message ? e.message : e);
  process.exit(1);
});
