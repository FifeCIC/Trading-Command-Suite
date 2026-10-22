/**
 * check-backtest-determinism.cjs — PHASE 0 of #1133: is POST /api/backtest/run deterministic?
 *
 * ⚠️ WHY THIS IS A GATE. The one-change re-test epic rests on the backtester being a pure function of
 * (configuration, window, data). If two IDENTICAL requests produce different trades or P&L, then a
 * difference between a baseline and a variant cannot be attributed to the change, and the harness is
 * unbuildable as specified. Answering it costs one sitting; building on an unasked question costs the
 * whole epic.
 *
 * It posts the SAME body twice and reports, honestly:
 *   • whether the numeric summary is identical,
 *   • whether the TRADE LIST is identical (a summary can agree while the trades differ),
 *   • and by how much they differ when they do, because "differs" without a magnitude is not a finding.
 *
 *   node scripts/check-backtest-determinism.cjs [--delay=2]
 */
const API = process.env.TCS_API || 'http://localhost:3201';

const arg = (name, dflt) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split('=')[1] : dflt;
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * The run's own summary lives under `stats`; the top level carries identity and the period. Reading
 * the wrong level is not a cosmetic bug — it made every metric `null`, and `null === null` reported
 * "DETERMINISTIC" while nothing had been compared. The first version of this script did exactly that.
 */
const IDENTITY_KEYS = ['period', 'timeframe', 'protocolId', 'symbol', 'totalDays'];
const STAT_KEYS = [
  'totalSignals', 'winRate', 'totalTrades', 'totalPnl', 'profitFactor', 'sharpeRatio',
  'maxDrawdown', 'avgTradePnl', 'averageReturn10d', 'maxReturn10d', 'minReturn10d',
];

function summaryKeys(res) {
  // Discover, do not assume: a stat the response omits must not be silently compared as null.
  const present = Object.keys(res?.stats ?? {});
  return { identity: IDENTITY_KEYS, stats: STAT_KEYS.filter((k) => present.includes(k)) };
}

function fingerprint(res) {
  const out = {};
  for (const k of IDENTITY_KEYS) out[k] = res?.[k] ?? null;
  for (const [k, v] of Object.entries(res?.stats ?? {})) out[`stats.${k}`] = v;
  return out;
}

function diffSummary(a, b) {
  const diffs = [];
  for (const k of Object.keys(a)) {
    if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) diffs.push({ key: k, a: a[k], b: b[k] });
  }
  return diffs;
}

/**
 * A trade fingerprint that is order-insensitive: a deterministic engine may legitimately emit trades
 * in a different ORDER (a Map iteration is not a contract), and calling that non-determinism would be
 * a false alarm. What must match is the SET.
 */
function tradeSet(res) {
  const trades = res?.trades ?? res?.results ?? [];
  if (!Array.isArray(trades)) return null;
  return trades
    .map((t) => [
      t.entryTime ?? t.entryAt ?? t.date ?? t.time ?? '',
      t.exitTime ?? t.exitAt ?? '',
      Number(t.entryPrice ?? t.entry ?? 0).toFixed(6),
      Number(t.exitPrice ?? t.exit ?? 0).toFixed(6),
      Number(t.pnl ?? t.profit ?? 0).toFixed(6),
      String(t.side ?? t.direction ?? ''),
    ].join('|'))
    .sort();
}

function compareTradeSets(a, b) {
  const A = tradeSet(a);
  const B = tradeSet(b);
  if (A === null || B === null) return { comparable: false, note: 'the response carries no trade array' };
  if (A.length !== B.length) return { comparable: true, identical: false, nA: A.length, nB: B.length, note: 'different trade COUNT' };
  const mismatches = A.filter((x, i) => x !== B[i]).length;
  return { comparable: true, identical: mismatches === 0, nA: A.length, nB: B.length, mismatches };
}

(async () => {
  const delay = Number(arg('delay', 2)) * 1000;

  const bots = await (await fetch(`${API}/api/trading/strategies`)).json();
  const list = Array.isArray(bots) ? bots : (bots?.strategies ?? []);
  const bot = list.find((b) => b?.id && (b.active === true || b.active === 1)) ?? list[0];
  if (!bot?.id) {
    console.error('[determinism] ✖ ABORT: no bot to drive the run — nothing is measured.');
    process.exit(2);
  }
  const body = { botId: bot.id, days: 30 };
  console.log(`[determinism] identical request twice: ${JSON.stringify(body)}`);
  console.log(`[determinism] bot: ${bot.name ?? bot.id} · delay ${delay / 1000}s\n`);

  const post = async () => {
    const res = await fetch(`${API}/api/backtest/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} ${await res.text()}`);
    return res.json();
  };

  const a = await post();
  await sleep(delay);
  const b = await post();

  const fa = fingerprint(a);
  const fb = fingerprint(b);
  const keys = Object.keys(fa);
  console.log('  field                              run 1                    run 2');
  for (const k of keys) {
    const same = JSON.stringify(fa[k]) === JSON.stringify(fb[k]);
    console.log(`  ${k.padEnd(33)} ${String(fa[k]).padEnd(24)} ${String(fb[k]).padEnd(24)} ${same ? '' : '  ← DIFFERS'}`);
  }

  // ⚠️ AN ASSERTION OVER NOTHING IS NOT A PASS. If the response carried no `stats`, every metric
  // would compare `null === null` and the script would announce DETERMINISTIC without having
  // compared a single number. That is exactly what its first version did.
  const statCount = keys.filter((k) => k.startsWith('stats.')).length;
  if (statCount === 0) {
    console.error('\n[determinism] ✖ ABORT: the response carried no `stats` block — nothing was compared.');
    console.error('              Reporting "deterministic" here would be an assertion over nothing.');
    process.exit(2);
  }
  console.log(`\n  compared ${statCount} statistic(s) and ${IDENTITY_KEYS.length} identity field(s)`);

  const diffs = diffSummary(fa, fb);
  const trades = compareTradeSets(a, b);
  console.log('');
  if (trades.comparable) {
    console.log(`  trade list: ${trades.identical ? 'IDENTICAL' : 'DIFFERS'} `
      + `(${trades.nA} vs ${trades.nB} trades${trades.mismatches ? `, ${trades.mismatches} mismatched` : ''})`);
  } else {
    console.log(`  trade list: NOT COMPARABLE — ${trades.note}`);
  }

  if (diffs.length === 0 && trades.identical) {
    console.log('\n[determinism] ✅ DETERMINISTIC on this request — identical summary and identical trades.');
    console.log('              Phase 0 of #1133 passes for this body. It does NOT prove every path:');
    console.log('              re-run with a periodId, a different timeframe, and walk-forward before');
    console.log('              the epic treats determinism as settled.');
    process.exit(0);
  }

  console.log(`\n[determinism] ✖ NOT DETERMINISTIC — ${diffs.length} summary field(s) differ`
    + `${trades.comparable && !trades.identical ? ', and the trade list differs' : ''}.`);
  for (const d of diffs) console.log(`                ${d.key}: ${d.a} vs ${d.b}`);
  console.log('              #1133 rests on determinism. Record this on the epic before building:');
  console.log('              a one-change comparison cannot attribute a difference to the change if');
  console.log('              the same configuration already produces two different results.');
  process.exit(1);
})().catch((err) => {
  console.error(`[determinism] ✖ ABORT: ${err?.message ?? err}`);
  process.exit(2);
});
