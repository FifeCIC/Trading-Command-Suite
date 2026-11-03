#!/usr/bin/env node
/**
 * run-contrast.cjs — a CONTRAST run (docs/GLOSSARY.md).
 *
 * DEFINITION BEING APPLIED: two backtests over the SAME bars, differing in EXACTLY ONE declared
 * input. Sides are `baseline` and `variant`. If a second input differed, this is not a contrast and
 * the script refuses rather than reporting a number nobody can attribute.
 *
 * HYPOTHESIS (from the live measurement, 2026-11-03): the 30-day system/broker exits show avg win
 * +4.50 against avg loss −15.27 — a break-even win rate of 77.2% against a realised 29.5%, with 21
 * stop-outs to 1 take-profit. If exits are the gap, then a stop that LOCKS and TRAILS should raise
 * the realised win/loss ratio without changing which trades are entered.
 *
 * ⚠️ 127.0.0.1, not `localhost` — Node resolves `localhost` to ::1 first and the API binds IPv4 only.
 */
const API = 'http://127.0.0.1:3201/api';

const BOT = process.env.BOT_NAME || 'Tokyo USDJPY Session Bot';

async function getBotId() {
  const res = await fetch(`${API}/trading/strategies`);
  const json = await res.json();
  const list = Array.isArray(json) ? json : (json.strategies || json.viable || []);
  const bot = list.find((b) => b.name === BOT);
  if (!bot) throw new Error(`bot "${BOT}" not found among ${list.length}`);
  return bot.id;
}

async function run(body) {
  const res = await fetch(`${API}/backtest/run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  if (!res.ok || !json.stats) {
    throw new Error(`${res.status}: ${json.message || json.error || 'no stats'}`);
  }
  return json;
}

const pick = (j) => {
  const s = j.stats;
  return {
    id: j.id,
    trades: s.totalTrades,
    winRate: s.tradeWinRate,
    netPnl: s.netPnl ?? s.totalPnl,
    tradePF: s.tradeProfitFactor ?? null,
    signalPF: s.profitFactor ?? null,
    avgWinPct: s.avgWinPct ?? null,
    avgLossPct: s.avgLossPct ?? null,
    breakEven: s.breakEvenWinRatePct ?? null,
    gapPp: s.breakEvenGapPp ?? null,
    maxDD: s.maxDrawdownPct ?? null,
    bars: j.scoreSeries?.length ?? null,
    overridden: j.drivenBy?.overridden ?? null,
  };
};

(async () => {
  const botId = await getBotId();
  console.log(`bot: ${BOT}  (${botId})`);

  // ⚠️ A PAIRED bot refuses a bare `botId` run, naming both legs — so the LEG is declared
  // explicitly and is therefore IDENTICAL on both sides. It is not the contrast's variable.
  const COMMON = { botId, legProtocolId: 'forex-session-v1' };

  console.log('\nbaseline …');
  const base = pick(await run(COMMON));

  console.log('variant  … (+ stopPlan)');
  const variant = pick(await run({
    ...COMMON,
    // THE ONE DECLARED DIFFERENCE.
    stopPlan: { lockAtPct: 1.0, trailPct: 0.5 },
  }));

  const rows = [
    ['trades', base.trades, variant.trades],
    ['win %', base.winRate, variant.winRate],
    ['net P&L', base.netPnl, variant.netPnl],
    ['trade PF', base.tradePF, variant.tradePF],
    ['avg win %', base.avgWinPct, variant.avgWinPct],
    ['avg loss %', base.avgLossPct, variant.avgLossPct],
    ['break-even %', base.breakEven, variant.breakEven],
    ['gap pp', base.gapPp, variant.gapPp],
    ['max DD %', base.maxDD, variant.maxDD],
  ];
  console.log('\n                                baseline        variant');
  for (const [label, b, v] of rows) {
    console.log(`${label.padEnd(28)} ${String(b).padStart(12)} ${String(v).padStart(14)}`);
  }
  console.log(`\nrun ids: ${base.id} / ${variant.id}`);

  // ── The contrast verdict, stated against the ONE-DIFFERENCE rule ──
  const differing = ['stopPlan'].filter((k) => JSON.stringify(COMMON[k]) !== JSON.stringify({ ...COMMON, stopPlan: { lockAtPct: 1.0, trailPct: 0.5 } }[k]));
  console.log(`declared difference(s): ${differing.length} (${differing.join(', ') || 'none'})`);
  if (differing.length !== 1) {
    console.log('⚠️ NOT A CONTRAST — the outcome difference cannot be attributed.');
    process.exitCode = 2;
    return;
  }

  const improved = variant.netPnl > base.netPnl;
  const sameSignals = variant.trades === base.trades;
  console.log(`\nverdict: ${improved ? 'variant better' : 'baseline better'} on net P&L ` +
    `(${base.netPnl} → ${variant.netPnl}, ${(variant.netPnl - base.netPnl).toFixed(2)}).`);
  console.log(`trade count ${sameSignals ? `IDENTICAL (${base.trades}) — same entries, different exits` : `CHANGED (${base.trades} → ${variant.trades}) — the stop altered which trades survived`}.`);
})().catch((e) => { console.error('FAILED:', e.message); process.exitCode = 1; });
