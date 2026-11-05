#!/usr/bin/env node
/**
 * measure-short-legs.cjs — does the SHORT leg of a pair fire at all, on STORED bars?
 *
 * WHY THIS EXISTS (2026-11-03). The live evidence said the three short legs had never scored above
 * 9.9% signal — and that turned out to be uninterpretable: the legs were created THAT DAY and the
 * upstream bars had been frozen for the same period, so their whole history is one symbol on one
 * stale bar. A backtest is the right instrument because it reads STORED bars, which are unaffected
 * by the outage.
 *
 * The question: over a real window, does the short leg enter trades, and how does it compare with
 * its long counterpart on the same bot and the same bars?
 *
 * ⚠️ 127.0.0.1, not `localhost` — Node resolves `localhost` to ::1 first and the API binds IPv4 only.
 */
const API = 'http://127.0.0.1:3201/api';

const PAIRS = [
  { bot: 'Tokyo USDJPY Session Bot', long: 'forex-session-v1-long', short: 'forex-session-v1-short' },
  { bot: 'Silver Speed Scalp Bot', long: 'xau-speed-v1-long', short: 'xau-speed-v1-short' },
  { bot: 'Tech Giants NVDA Bot', long: 'momentum-stock-v1-long', short: 'momentum-stock-v1-short' },
];

async function botIdFor(name) {
  const res = await fetch(`${API}/trading/strategies`);
  const json = await res.json();
  const list = Array.isArray(json) ? json : (json.strategies || json.viable || []);
  const bot = list.find((b) => b.name === name);
  if (!bot) throw new Error(`bot "${name}" not found among ${list.length}`);
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
    return { error: `${res.status}: ${json.message || json.error || 'no stats'}` };
  }
  const s = json.stats;
  // Signal-side stats matter here even when no trade is taken: a leg can score without entering.
  return {
    trades: s.totalTrades ?? 0,
    winRate: s.tradeWinRate ?? null,
    netPnl: s.netPnl ?? s.totalPnl ?? null,
    bars: json.scoreSeries?.length ?? null,
    signals: json.scoreSeries ? json.scoreSeries.filter((b) => b.signal && b.signal !== 'HOLD').length : null,
    maxSignalPct: json.scoreSeries?.length
      ? Math.max(...json.scoreSeries.map((b) => Number(b.signalPct ?? 0) || 0))
      : null,
  };
}

(async () => {
  const out = [];
  for (const pair of PAIRS) {
    let id;
    try {
      id = await botIdFor(pair.bot);
    } catch (e) {
      out.push({ pair: pair.bot, leg: '—', error: e.message });
      continue;
    }
    for (const [leg, proto] of [['LONG', pair.long], ['SHORT', pair.short]]) {
      const r = await run({ botId: id, legProtocolId: proto });
      out.push({
        pair: pair.bot.replace(/ Bot$/, ''),
        leg,
        protocol: proto,
        trades: r.trades ?? null,
        winRate: r.winRate != null ? Number(r.winRate).toFixed(1) : null,
        netPnl: r.netPnl != null ? Math.round(r.netPnl) : null,
        bars: r.bars ?? null,
        actionableBars: r.signals ?? null,
        maxSignalPct: r.maxSignalPct != null ? Number(r.maxSignalPct).toFixed(1) : null,
        error: r.error ?? null,
      });
    }
  }
  console.table(out);
  const dead = out.filter((r) => !r.error && r.leg === 'SHORT' && (r.trades === 0 || r.trades == null));
  console.log(
    dead.length === 0
      ? '\nEvery SHORT leg entered at least one trade on stored bars.'
      : `\n${dead.length} SHORT leg(s) entered NO trades: ` +
          dead.map((d) => `${d.pair} (max signal ${d.maxSignalPct ?? '?'}%)`).join(', '),
  );
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
