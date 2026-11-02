#!/usr/bin/env node
/**
 * ab-stop-plan.cjs — measure a tightening stop against the SAME window, one declared difference.
 *
 * WHY: measured 2026-11-02, **42 of 95 closed trades (44%) peaked in profit and closed at or
 * below zero**. Every bot has `simTslEnabled = 0`, and `observeSimulatedTsl()` explicitly
 * "PLACES NOTHING AND MOVES NOTHING" — it records a decision point and stops there. So there is
 * no acting trailing stop anywhere on the live path, and a trade that goes +0.5% but never
 * reaches a 3% target simply reverses into the fixed stop.
 *
 * The backtest engine DOES model `StopPlan` (`lockAtPct` / `trailPct` / `stepPct`+`tightenPct`)
 * with deliberate no-look-ahead semantics (the stop tested on bar N was set from bars up to N-1).
 * So the value of a trail is measurable BEFORE any order is affected — which is what
 * `maths-change-requires-ab` requires, and what `backtest.service.ts` says this mechanism was
 * built for.
 *
 * ⚠️ ONE DECLARED DIFFERENCE. Every arm posts the identical request except `stopPlan`, and the
 * window comes from the canonical `dev-window-v1` period so the arms are directly comparable.
 * ⚠️ A BETTER PF IS NOT PROOF THE TRAIL WORKS — it is a simulation on one window. It bounds the
 * decision; it does not settle it.
 *
 * USAGE
 *   node scripts/ab-stop-plan.cjs --symbol XAGUSD --protocol probe-1dir-rsi --timeframe 1h
 *   node scripts/ab-stop-plan.cjs --symbol US500 --protocol spy-speed-v1 --timeframe 1h
 */

const ROOT = require('path').resolve(__dirname, '..');
const API = 'http://localhost:3201/api';
const N = (v) => (v === null || v === undefined ? null : Number(v));

const ARMS = [
  { name: 'baseline (no stopPlan)', plan: null },
  { name: 'lockAt 0.5%', plan: { lockAtPct: 0.5 } },
  { name: 'trail 0.5%', plan: { trailPct: 0.5 } },
  { name: 'trail 0.3%', plan: { trailPct: 0.3 } },
  { name: 'lock 0.5 + trail 0.4', plan: { lockAtPct: 0.5, trailPct: 0.4 } },
  { name: 'step 0.3 / tighten 0.2', plan: { stepPct: 0.3, tightenPct: 0.2 } },
];

function arg(flag, dflt) {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : dflt;
}

async function runArm(base, arm) {
  const body = { ...base };
  if (arm.plan) body.stopPlan = arm.plan;
  const res = await fetch(`${API}/backtest/run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  if (!res.ok || json.error) {
    return { ok: false, error: json.message || `HTTP ${res.status}` };
  }
  const s = json.stats || {};
  return {
    ok: true,
    id: json.id,
    trades: N(s.totalTrades),
    winRate: N(s.tradeWinRate),
    avgPct: N(s.avgTradePnl),
    pf: N(s.profitFactor),
    totalPnl: N(s.netPnl ?? s.totalPnl),
    dd: N(s.maxDrawdown10d),
    avgWin: N(s.avgWinPct),
    avgLoss: N(s.avgLossPct),
    breakEven: N(s.breakEvenWinRatePct),
    gap: N(s.breakEvenGapPp),
    trailExits: Array.isArray(json.trades) ? json.trades.filter((t) => t.exitReason === 'TRAIL').length : null,
    slExits: Array.isArray(json.trades) ? json.trades.filter((t) => t.exitReason === 'SL').length : null,
    tpExits: Array.isArray(json.trades) ? json.trades.filter((t) => t.exitReason === 'TP').length : null,
    eodExits: Array.isArray(json.trades) ? json.trades.filter((t) => t.exitReason === 'EOD').length : null,
    window: s.windowSource,
  };
}

async function main() {
  const base = {
    symbol: arg('--symbol', 'XAGUSD'),
    protocolId: arg('--protocol', 'probe-1dir-rsi'),
    timeframe: arg('--timeframe', '1h'),
    directionMode: arg('--direction', 'long'),
    newsExclusion: 'none',
    periodId: arg('--period', ''),
  };
  if (!base.periodId) delete base.periodId;

  console.log(`\nA/B tightening stop — ${base.symbol} ${base.protocolId} ${base.timeframe}, canonical window\n`);
  console.log('ARM                      | trades | win% |  avgPct |    PF |    netPnl | avgWin% | avgLoss% | TRAIL/SL/TP/EOD');
  console.log('-------------------------|--------|------|---------|-------|-----------|---------|----------|----------------');

  const results = [];
  for (const arm of ARMS) {
    const r = await runArm(base, arm);
    results.push({ arm: arm.name, ...r });
    if (!r.ok) {
      console.log(`${arm.name.padEnd(24)} | FAILED: ${r.error}`);
      continue;
    }
    const exits = r.trailExits === null ? '-' : `${r.trailExits}/${r.slExits}/${r.tpExits}/${r.eodExits}`;
    console.log(
      `${arm.name.padEnd(24)} | ${String(r.trades).padStart(6)} | ` +
      `${(r.winRate === null ? '-' : (r.winRate * 100).toFixed(0)).padStart(4)} | ` +
      `${(r.avgPct === null ? '-' : r.avgPct.toFixed(3)).padStart(7)} | ` +
      `${(r.pf === null ? '-' : r.pf.toFixed(2)).padStart(5)} | ` +
      `${(r.totalPnl === null ? '-' : r.totalPnl.toFixed(2)).padStart(9)} | ` +
      `${(r.avgWin === null ? '-' : r.avgWin.toFixed(2)).padStart(7)} | ` +
      `${(r.avgLoss === null ? '-' : r.avgLoss.toFixed(2)).padStart(8)} | ${exits}`,
    );
  }

  const baseArm = results.find((r) => r.arm && r.arm.startsWith('baseline') && r.ok);
  if (baseArm) {
    const better = results.filter((r) => r.ok && r !== baseArm && N(r.pf) > N(baseArm.pf) && N(r.totalPnl) > N(baseArm.totalPnl));
    console.log(`\nbaseline PF ${N(baseArm.pf).toFixed(2)} · net ${N(baseArm.totalPnl).toFixed(2)} · ${N(baseArm.trades)} trades`);
    console.log(better.length
      ? `${better.length} arm(s) beat baseline on BOTH profit factor and net: ${better.map((b) => b.arm).join(', ')}`
      : '⚠️ NO arm beat the baseline on both profit factor and net.');
  }
  console.log('');
}

main().catch((e) => {
  console.error('❌', e && e.message ? e.message : e);
  process.exit(1);
});
