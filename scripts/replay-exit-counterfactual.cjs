/**
 * replay-exit-counterfactual.cjs — would an exit rule have IMPROVED the trades we already have, or
 * killed the winners?
 *
 * ⚠️ WHY THIS EXISTS INSTEAD OF THE BACKTEST (#1024). The backtest engine models an exit as
 * `TP` / `SL` / `EOD` with no trail and no rule exit (`backtest.service.ts` L147, and its own
 * `caveats[]` at L962 confirms it), while LIVE exits via a moving ATR trail, a time-stop and
 * unattributed broker closes. Those are DIFFERENT SYSTEMS, so a backtest verdict on an exit change
 * would not transfer. This replays the REAL closed trades against the REAL bars instead — no broker,
 * no merge, no collision, and therefore no need to model anything.
 *
 * ⚠️ IT REPORTS WHAT IT DAMAGES, NOT ONLY WHAT IT IMPROVES. A rule that exits early cuts the losers
 * AND the winners. A counterfactual that reports only the improvement is an advertisement, so
 * `winnersCut` and `winnersTurnedRed` are printed beside every setting.
 *
 * ⚠️ EVALUATED ON BAR CLOSES ONLY, FILLED AT THAT CLOSE. A 5m bar does not reveal the path WITHIN
 * the bar, so a rule judged on intrabar highs/lows is optimistic and unfalsifiable. Closes-only is
 * conservative: it cannot manufacture a result.
 *
 * READ-ONLY. It writes nothing and changes no live number, so no A/B copy is owed.
 *
 *   node scripts/replay-exit-counterfactual.cjs                    # sweep the defaults
 *   node scripts/replay-exit-counterfactual.cjs --give-back 0.2    # one setting
 *   node scripts/replay-exit-counterfactual.cjs --close-before 13:30   # #928 session boundary (UTC)
 *   node scripts/replay-exit-counterfactual.cjs --self-test        # prove the rule can fire AND not fire
 *   node scripts/replay-exit-counterfactual.cjs --raw              # per-trade rows
 */
const { connect, query, selfTest: dbSelfTest } = require('./lib/mysql-cli.cjs');
// ⚠️ THE SHARED HARNESS (#1032). `runCases` is the NON-EXITING half, so this file keeps its own
// trailing line and its caller still owns the exit code. The loop that used to live here was a
// hand-rolled copy of it — a copy that a future fix to the harness would not have reached.
const { runCases } = require('./lib/validator-helpers.cjs');

const TIMEFRAME = process.env.REPLAY_TIMEFRAME || '5m';

// ── the rule (pure, so it can be self-tested without a database) ───────────────────────────────
/**
 * Walk the bars from ENTRY to the actual exit, deciding at each CLOSE whether to leave.
 *
 * Returns `null` when the rule never fires — meaning **the trade keeps its ACTUAL outcome**. That is
 * deliberate: this measures the rule as an ADDITION to what already happened, not as a replacement
 * for it, because the broker stop and the guardian trail already acted.
 *
 * @param bars        [{ t: number, close: number }] ascending, from openedAt to closedAt
 * @param side        'buy' | 'sell'
 * @param entryPrice  the real fill
 * @param giveBackPct bank profit after retracing this many % from the peak (null to disable)
 * @param slPct       the trade's OWN declared stop distance in % (drives the early-stop threshold)
 * @param earlyStopFrac  leave a loser once the adverse move reaches this fraction of slPct
 * @param sessionBoundaryMin  minutes past UTC midnight to leave by (#928), or null
 * @param openedAtMs  the trade's real entry time — decides whether the boundary even APPLIES
 */
function replayOne(
  bars, side, entryPrice, giveBackPct, slPct, earlyStopFrac,
  sessionBoundaryMin = null, openedAtMs = null,
) {
  const dir = side === 'buy' ? 1 : -1;
  const earlyStopPct =
    slPct != null && earlyStopFrac != null ? slPct * earlyStopFrac : null;

  /**
   * ⚠️ #928 — "do not hold into 13:30" only APPLIES to a trade that was already open before 13:30.
   *
   * A trade opened after the boundary never "held into" it, so firing on bar 0 would close it at
   * entry for ~0% and flood the comparison with no-op exits — the rule would appear to "improve" the
   * mean purely by removing trades from the sample. Applicability is therefore decided ONCE, from the
   * real `openedAt`, before the loop.
   *
   * The comparison is minutes-past-UTC-midnight, so a boundary plus a trade that crosses midnight
   * (boundary 00:10, trade at 23:50) is NOT modelled. Said plainly rather than silently wrong: the
   * replay reports how many trades were affected, and FX majors here do not straddle the boundary
   * used. Widen to a date-aware comparison before trusting a boundary near midnight.
   */
  const openedMin = utcMinutes(openedAtMs);
  const boundaryApplies =
    sessionBoundaryMin != null && openedMin != null && openedMin < sessionBoundaryMin;

  let peak = 0;
  for (let i = 0; i < bars.length; i++) {
    const ret = ((bars[i].close - entryPrice) / entryPrice) * 100 * dir;
    if (ret > peak) peak = ret;

    // Checked FIRST: at the boundary bar the exit price is the same whatever else was about to
    // fire, and naming the boundary is the more informative reason for this measurement.
    if (boundaryApplies && utcMinutes(bars[i].t) >= sessionBoundaryMin) {
      return { barIndex: i, ret, reason: 'session-boundary' };
    }
    if (giveBackPct != null && peak > 0 && peak - ret >= giveBackPct) {
      return { barIndex: i, ret, reason: 'give-back' };
    }
    if (earlyStopPct != null && ret <= -earlyStopPct) {
      return { barIndex: i, ret, reason: 'early-stop' };
    }
  }
  return null;
}

/** Minutes past UTC midnight for an epoch-ms timestamp, or null when it is not a number. */
function utcMinutes(ms) {
  if (ms == null || !Number.isFinite(Number(ms))) return null;
  const d = new Date(Number(ms));
  return d.getUTCHours() * 60 + d.getUTCMinutes();
}

/**
 * Parse a `HH:MM` UTC boundary into minutes past midnight.
 * Returns null when it cannot be read — and the caller treats that as an ERROR, never as "no".
 */
function parseBoundary(spec) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(spec ?? '').trim());
  if (!m) return null;
  const h = Number(m[1]);
  const mi = Number(m[2]);
  if (h > 23 || mi > 59) return null;
  return h * 60 + mi;
}

/** Signed % move from entry to the actual exit. */
function actualRet(side, entryPrice, exitPrice) {
  return ((exitPrice - entryPrice) / entryPrice) * 100 * (side === 'buy' ? 1 : -1);
}

// ── self-test: prove the rule CAN fire and CAN decline to ──────────────────────────────────────
function selfTest() {
  const bars = (closes) => closes.map((c, i) => ({ t: i, close: c }));
  const cases = [
    ['fires on a peak then give-back', () => {
      // entry 100, up to 105 (+5%), back to 104.5 (-0.5 from peak) -> give-back 0.4 fires
      const r = replayOne(bars([101, 103, 105, 104.5]), 'buy', 100, 0.4, null, null);
      return r !== null && r.reason === 'give-back';
    }],
    ['does NOT fire when the retrace is smaller than the give-back', () => {
      const r = replayOne(bars([101, 103, 105, 104.9]), 'buy', 100, 0.4, null, null);
      return r === null;
    }],
    ['does NOT fire from a peak that never went positive', () => {
      // never above entry -> give-back must not treat 0 as a peak
      const r = replayOne(bars([99.9, 99.8, 99.7]), 'buy', 100, 0.1, null, null);
      return r === null;
    }],
    ['fires the early stop at the declared fraction of slPct', () => {
      // slPct 2% -> half is 1% adverse -> close at 99.0 exactly
      const r = replayOne(bars([99.5, 99.0]), 'buy', 100, null, 2, 0.5);
      return r !== null && r.reason === 'early-stop' && Math.abs(r.ret + 1) < 1e-9;
    }],
    ['does NOT fire the early stop one tick above the threshold', () => {
      const r = replayOne(bars([99.5, 99.01]), 'buy', 100, null, 2, 0.5);
      return r === null;
    }],
    ['is SIDE-AWARE: a SHORT peaks on a DOWN move', () => {
      // short entry 100, down to 95 (+5% for the short), back to 95.5 -> give-back 0.4 fires
      const r = replayOne(bars([99, 97, 95, 95.5]), 'sell', 100, 0.4, null, null);
      return r !== null && r.reason === 'give-back';
    }],
    ['a LONG does not fire on the same series', () => {
      const r = replayOne(bars([99, 97, 95, 95.5]), 'buy', 100, 0.4, null, null);
      return r === null;
    }],
    ['actualRet is side-aware', () => actualRet('sell', 100, 95) === 5 && actualRet('buy', 100, 95) === -5],
    ['no bars -> no rule exit', () => replayOne([], 'buy', 100, 0.4, 2, 0.5) === null],

    // ── #928, the session-boundary rule ──────────────────────────────────────────────────────
    ['BOUNDARY fires at the first bar at or after 13:30 UTC', () => {
      // 13:25, 13:30, 13:35 -> the 13:30 bar is the first at/after the boundary
      const ts = ['2026-09-21T13:25:00Z', '2026-09-21T13:30:00Z', '2026-09-21T13:35:00Z'].map((x) => Date.parse(x));
      const b = ts.map((t, i) => ({ t, close: [100, 99, 98][i] }));
      const r = replayOne(b, 'buy', 100, null, null, null, parseBoundary('13:30'), Date.parse('2026-09-21T12:00:00Z'));
      return r !== null && r.reason === 'session-boundary' && r.barIndex === 1;
    }],
    ['BOUNDARY does NOT apply to a trade opened AT the boundary', () => {
      const ts = ['2026-09-21T13:30:00Z', '2026-09-21T13:35:00Z'].map((x) => Date.parse(x));
      const b = ts.map((t, i) => ({ t, close: [100, 98][i] }));
      return replayOne(b, 'buy', 100, null, null, null, parseBoundary('13:30'), Date.parse('2026-09-21T13:30:00Z')) === null;
    }],
    ['BOUNDARY does NOT apply to a trade opened AFTER it', () => {
      const ts = ['2026-09-21T14:00:00Z'].map((x) => Date.parse(x));
      const b = ts.map((t) => ({ t, close: 98 }));
      return replayOne(b, 'buy', 100, null, null, null, parseBoundary('13:30'), Date.parse('2026-09-21T14:00:00Z')) === null;
    }],
    ['BOUNDARY does NOT fire when the trade closed before it', () => {
      const ts = ['2026-09-21T13:00:00Z', '2026-09-21T13:25:00Z'].map((x) => Date.parse(x));
      const b = ts.map((t, i) => ({ t, close: [100, 101][i] }));
      return replayOne(b, 'buy', 100, null, null, null, parseBoundary('13:30'), Date.parse('2026-09-21T12:00:00Z')) === null;
    }],
    ['BOUNDARY with no openedAt cannot apply (never a silent yes)', () => {
      const ts = ['2026-09-21T13:35:00Z'].map((x) => Date.parse(x));
      const b = ts.map((t) => ({ t, close: 98 }));
      return replayOne(b, 'buy', 100, null, null, null, parseBoundary('13:30'), null) === null;
    }],
    ['BOUNDARY null disables the rule even with an applicable entry', () => {
      const ts = ['2026-09-21T13:35:00Z'].map((x) => Date.parse(x));
      const b = ts.map((t) => ({ t, close: 98 }));
      return replayOne(b, 'buy', 100, null, null, null, null, Date.parse('2026-09-21T12:00:00Z')) === null;
    }],
    ['parseBoundary reads HH:MM and REFUSES anything else', () =>
      parseBoundary('13:30') === 810 && parseBoundary('00:00') === 0 && parseBoundary('23:59') === 1439
      && parseBoundary('24:00') === null && parseBoundary('13:60') === null
      && parseBoundary('1330') === null && parseBoundary('') === null && parseBoundary(null) === null],
    ['BOUNDARY is compared in UTC, not local time', () => {
      // 13:30Z is 13:30 UTC whatever the host offset — the parse must not shift it
      const b = [{ t: Date.parse('2026-09-21T13:30:00Z'), close: 99 }];
      const r = replayOne(b, 'buy', 100, null, null, null, parseBoundary('13:30'), Date.parse('2026-09-21T12:00:00Z'));
      return r !== null && r.barIndex === 0;
    }],
    ['BOUNDARY composes with give-back without changing its outcome', () => {
      const ts = ['2026-09-21T13:25:00Z', '2026-09-21T13:30:00Z'].map((x) => Date.parse(x));
      const b = ts.map((t, i) => ({ t, close: [105, 104.5][i] }));
      const r = replayOne(b, 'buy', 100, 0.4, null, null, parseBoundary('13:30'), Date.parse('2026-09-21T12:00:00Z'));
      return r !== null && r.reason === 'session-boundary';
    }],
  ];

  // ⚠️ The harness is SHARED (#1032). `runCases` prints the PASS/FAIL lines and the `n/m` summary
  // and returns the failure count WITHOUT exiting, so this function's contract is unchanged.
  const failed = runCases(cases);
  if (failed) console.log('  — SELF-TEST FAILED\n');
  else console.log('');
  return failed;
}

// ── data ───────────────────────────────────────────────────────────────────────────────────────
/**
 * ⚠️ ONE PROVIDER PER SYMBOL, and the pick is DECLARED rather than incidental. `marketbar` is keyed
 * by (symbolId, provider, timeframe), so joining without pinning a provider multiplies every bar and
 * would silently double a trade's path. The provider chosen is the one holding the most bars at this
 * timeframe — reported by `--self-test`'s sibling, `--providers`.
 */
function sqlForTrades() {
  return `
SELECT t.id, t.symbol, t.side, t.entryPrice, t.exitPrice, t.pnl, t.sl,
       DATE_FORMAT(t.openedAt, '%Y-%m-%d %H:%i:%s') AS openedAt,
       DATE_FORMAT(t.closedAt, '%Y-%m-%d %H:%i:%s') AS closedAt,
       DATE_FORMAT(b.timestamp, '%Y-%m-%d %H:%i:%s') AS barAt,
       b.close AS barClose, b.provider AS barProvider
FROM trade t
JOIN symbol s ON s.ticker = t.symbol
JOIN (
  SELECT symbolId, provider FROM (
    SELECT symbolId, provider, COUNT(*) c,
           ROW_NUMBER() OVER (PARTITION BY symbolId ORDER BY COUNT(*) DESC) rn
    FROM marketbar WHERE timeframe = '${TIMEFRAME}' GROUP BY symbolId, provider
  ) x WHERE x.rn = 1
) p ON p.symbolId = s.id
JOIN marketbar b ON b.symbolId = s.id AND b.provider = p.provider AND b.timeframe = '${TIMEFRAME}'
                AND b.timestamp >= t.openedAt AND b.timestamp <= t.closedAt
WHERE t.status = 'closed' AND t.pnlInvalid = 0 AND t.exitPrice IS NOT NULL
ORDER BY t.openedAt, b.timestamp`;
}

/** mysql --batch --raw: a header row, then tab-separated rows, `NULL` for null. */
function parseTsv(out) {
  const lines = out.split(/\r?\n/).filter((l) => l.length > 0);
  if (!lines.length) return [];
  const head = lines[0].split('\t');
  return lines.slice(1).map((l) => {
    const cells = l.split('\t');
    const row = {};
    head.forEach((h, i) => { row[h] = cells[i] === 'NULL' ? null : cells[i]; });
    return row;
  });
}

function loadTrades(conn) {
  const rows = parseTsv(query(sqlForTrades(), conn));
  const byId = new Map();
  for (const r of rows) {
    if (!byId.has(r.id)) {
      byId.set(r.id, {
        id: r.id, symbol: r.symbol, side: r.side,
        entryPrice: Number(r.entryPrice), exitPrice: Number(r.exitPrice), pnl: Number(r.pnl),
        slPct: r.sl == null ? null : Math.abs((Number(r.sl) - Number(r.entryPrice)) / Number(r.entryPrice)) * 100,
        openedAt: r.openedAt, closedAt: r.closedAt, provider: r.barProvider, bars: [],
      });
    }
    const t = byId.get(r.id);
    if (r.barAt) t.bars.push({ t: Date.parse(r.barAt.replace(' ', 'T') + 'Z'), close: Number(r.barClose) });
  }
  return [...byId.values()];
}

// ── the sweep ──────────────────────────────────────────────────────────────────────────────────
function evaluate(trades, giveBackPct, earlyStopFrac, sessionBoundaryMin = null) {
  const s = {
    giveBackPct, earlyStopFrac, sessionBoundaryMin,
    fired: 0, notFired: 0, skippedNoBars: 0, skippedNoSl: 0,
    boundaryApplicable: 0, boundaryFired: 0,
    improved: 0, worsened: 0, unchanged: 0, winnersCut: 0, winnersTurnedRed: 0,
    deltaPctSum: 0, actualPctSum: 0, rulePctSum: 0,
  };
  for (const t of trades) {
    if (!t.bars.length) { s.skippedNoBars++; continue; }
    const a = actualRet(t.side, t.entryPrice, t.exitPrice);
    const useEarlyStop = t.slPct != null && earlyStopFrac != null;
    if (!useEarlyStop && earlyStopFrac != null) s.skippedNoSl++;

    // How many trades the boundary could even touch — the denominator behind `boundaryFired`.
    const openedMin = utcMinutes(Date.parse(t.openedAt.replace(' ', 'T') + 'Z'));
    const applicable = sessionBoundaryMin != null && openedMin != null && openedMin < sessionBoundaryMin;
    if (applicable) s.boundaryApplicable++;

    const hit = replayOne(
      t.bars, t.side, t.entryPrice, giveBackPct, t.slPct,
      useEarlyStop ? earlyStopFrac : null,
      sessionBoundaryMin,
      Date.parse(t.openedAt.replace(' ', 'T') + 'Z'),
    );
    if (hit && hit.reason === 'session-boundary') s.boundaryFired++;

    const r = hit ? hit.ret : a;   // no rule exit -> the ACTUAL outcome stands
    if (hit) s.fired++; else s.notFired++;

    const d = r - a;
    s.actualPctSum += a;
    s.rulePctSum += r;
    s.deltaPctSum += d;
    if (d > 1e-9) s.improved++;
    else if (d < -1e-9) s.worsened++;
    else s.unchanged++;

    // ⚠️ THE DAMAGE COUNTERS — the part that makes this a measurement
    if (a > 0 && hit && r < a) s.winnersCut++;
    if (a > 0 && r < 0) s.winnersTurnedRed++;
  }
  return s;
}

function fmt(n, d = 3) { return Number(n).toFixed(d); }

function main() {
  const argv = process.argv.slice(2);
  if (argv.includes('--self-test')) {
    let failed = selfTest();
    console.log('  --- database layer ---');
    failed += dbSelfTest();
    process.exit(failed ? 1 : 0);
  }

  const conn = connect();
  const trades = loadTrades(conn);
  const withBars = trades.filter((t) => t.bars.length);
  const providers = [...new Set(withBars.map((t) => t.provider))];

  console.log(`\n[exit-replay] timeframe ${TIMEFRAME} · provider per symbol: ${providers.join(', ')}\n`);
  console.log(`  trades with valid P&L, closed      : ${trades.length}`);
  console.log(`  trades with bars in their window   : ${withBars.length}`);
  console.log(`  trades with NO bars (skipped, not zero) : ${trades.length - withBars.length}`);
  const noSl = trades.filter((t) => t.slPct == null).length;
  console.log(`  trades with no recorded stop (early-stop rule cannot apply) : ${noSl}\n`);

  const gi = argv.indexOf('--give-back');
  if (gi >= 0) {
    const g = Number(argv[gi + 1]);
    const s = evaluate(trades, g, null);
    report([s], trades.length);
    return;
  }

  /**
   * #928 — `--close-before HH:MM` measures ONE UTC session boundary: "leave at the first bar close
   * at or after HH:MM". This is the rule the issue asks for evidence on before anyone builds it.
   *
   * ⚠️ A boundary it cannot PARSE is an error, never a silent no-op. `--close-before 1330` would
   * otherwise run the whole replay with no rule and report `fired 0` — which reads as "the rule
   * never helps" when in fact no rule was tested. Same rule as the validators: a check that reads
   * nothing must not report OK.
   */
  const cb = argv.indexOf('--close-before');
  if (cb >= 0) {
    const spec = argv[cb + 1];
    const min = parseBoundary(spec);
    if (min == null) {
      console.error(
        `[exit-replay] ✗ --close-before expects HH:MM in UTC (e.g. 13:30); got ${JSON.stringify(spec)}.\n` +
        '  Refusing to run: an unreadable boundary would report "the rule never fires", which is a different claim from "no rule was tested".',
      );
      process.exit(1);
    }
    report([evaluate(trades, null, null, min)], trades.length);
    return;
  }

  // Sweep. A single number would be a preference; a sweep is a measurement.
  const sweep = [];
  for (const gb of [0.15, 0.25, 0.4, 0.6]) sweep.push(evaluate(trades, gb, null));
  for (const es of [0.5, 0.7]) sweep.push(evaluate(trades, null, es));
  for (const es of [0.5, 0.7]) sweep.push(evaluate(trades, 0.25, es));
  // #928 — the session boundaries named in the issue, plus the pre-NY-open window it is about.
  for (const spec of ['12:00', '13:00', '13:30', '20:00']) {
    sweep.push(evaluate(trades, null, null, parseBoundary(spec)));
  }
  report(sweep, trades.length, argv.includes('--raw'));
}

/** minutes past UTC midnight -> `HH:MM`, for the report. */
function fmtBoundary(min) {
  if (min == null) return '        —';
  return `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`.padStart(9);
}

function report(rows, totalTrades, raw = false) {
  console.log('  closeByUTC  give-back  early-stop |  fired  | improved  worsened | winnersCut  turnedRed | meanActual%  meanRule%  delta%');
  console.log('  ' + '-'.repeat(120));
  for (const s of rows) {
    const n = s.fired + s.notFired;
    console.log(
      `  ${fmtBoundary(s.sessionBoundaryMin)}` +
      `  ${(s.giveBackPct == null ? '    —' : fmt(s.giveBackPct, 2)).padStart(9)}` +
      `  ${(s.earlyStopFrac == null ? '    —' : fmt(s.earlyStopFrac, 2)).padStart(10)} |` +
      ` ${String(s.fired).padStart(6)}  |` +
      ` ${String(s.improved).padStart(8)}  ${String(s.worsened).padStart(8)} |` +
      ` ${String(s.winnersCut).padStart(10)}  ${String(s.winnersTurnedRed).padStart(9)} |` +
      ` ${fmt(s.actualPctSum / n).padStart(11)}  ${fmt(s.rulePctSum / n).padStart(9)}  ${fmt(s.deltaPctSum / n).padStart(6)}`,
    );
  }

  // ⚠️ A boundary row's `fired` count is only meaningful against how many trades were OPEN across
  // it. Printed separately so a boundary that touches 3 of 200 trades cannot be read as a rule that
  // "did nothing" — it is a rule that had almost nothing to act on, which is a different finding.
  const boundaryRows = rows.filter((s) => s.sessionBoundaryMin != null);
  if (boundaryRows.length) {
    console.log('\n  session boundary — how much the rule had to act on:');
    for (const s of boundaryRows) {
      console.log(
        `    close by ${String(s.sessionBoundaryMin).padStart(4)} min UTC (${fmtBoundary(s.sessionBoundaryMin).trim()})` +
        ` — ${s.boundaryApplicable} trade(s) were open across it, ${s.boundaryFired} exited there`,
      );
    }
    console.log('    (a trade opened AT or AFTER the boundary is not eligible: it never held into it)');
  }

  const n = rows.length ? rows[0].fired + rows[0].notFired : 0;
  console.log(`\n  means are per TRADE over the ${n} trades that had bars; a rule that never fires reproduces the actual outcome, so delta 0 is the floor.\n`);
  console.log('  ⚠️ READ `winnersCut` AND `turnedRed` BEFORE `delta%`. A rule that improves the mean while cutting winners is not a win —');
  console.log('     95% of these trades reached profit at some point (#1017), so almost any early exit "improves" a loser and damages a winner.\n');
}

if (require.main === module) main();
module.exports = { replayOne, actualRet, evaluate, parseTsv, parseBoundary, utcMinutes };
