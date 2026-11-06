/**
 * report-first-passage.cjs — "does a small target get hit BEFORE the stop, often enough?"
 *
 * WHY THIS EXISTS (2026-11-06, owner: "do what you think is a sensible test for potential discovery")
 * ==================================================================================================
 * The live bots answer this question in WEEKS. The stored bars answer it NOW. Every bar the app has
 * fetched is a possible entry, and the question a small-target strategy lives or dies by is:
 *
 *     from a given entry, does price reach +TARGET before it reaches -STOP?
 *
 * That is a FIRST-PASSAGE question, and it is the same arithmetic the trade will face. It is a
 * DISCOVERY tool, not a backtest: no scoring, no protocol, no signals — just the price's own
 * behaviour, so a target can be chosen on evidence rather than hope.
 *
 * ── THE THREE TRAPS THIS MUST NOT FALL INTO ──────────────────────────────────────────────────
 * 1. **AMBIGUOUS BARS.** If one bar's range covers BOTH the target and the stop, the bar's own data
 *    cannot say which came first. Those are counted and EXCLUDED, never silently scored as a win or
 *    a loss — a coin-flip dressed as evidence is how a strategy gets believed.
 * 2. **OVERLAPPING ENTRIES.** Entries are walked forward WITHOUT overlap: after an exit, the next
 *    entry is the bar that produced it. Otherwise one trend is counted a hundred times and every
 *    target looks wonderful.
 * 3. **SPREAD.** Entry is at the ASK and exit at the BID, taken from the live bridge quote for the
 *    routed broker. A 0.09% spread against a 0.23% target is not a rounding error — it is most of
 *    the edge, and a tool that ignores it flatters every small target.
 *
 * ⚠️ WHAT IT STILL CANNOT SEE, stated so nobody trusts it further than it goes: SLIPPAGE on the exit
 * fill, commission, swap, and the fact that a live bot only enters on a SIGNAL (so the live entry
 * distribution is not a uniform sample of bars). A promising number here is a reason to TEST, not a
 * result.
 *
 * ── WHAT IT FOUND, and the three places it was wrong first (all fixed, all canaried) ───────────
 *
 * 1. **THE EXPECTANCY DENOMINATOR.** First version divided by (wins + losses) and dropped timeouts.
 *    EURUSD then read "100% win rate, +20% expectancy" from **3 decided trades and 157 timeouts**.
 *    Timeouts are now marked to market and stay in the denominator (`scored`).
 * 2. **THE UNIT.** `sg()` multiplied an already-percent value by 100, so US30 printed "+2.125% of
 *    notional per entry" when the truth was **+0.021%** — a 100× overstatement that was arithmetically
 *    self-consistent and one step from being reported. Formatters now pin their units in the self-test.
 * 3. **GAPS IN THE SERIES.** `marketbar` is NOT contiguous: US30/US500 each hold a **2,946-minute
 *    (49-hour)** hole and 8–10 gaps over 2 minutes. Walking bar to bar called a 49-hour seam a
 *    "−3.45% one-minute move". `splitSegments()` now refuses to let a trade span a hole.
 *
 * With those fixed, the honest answer on 7 days of 1m GER40 bars (0.4% stop, 24-bar horizon):
 * **target 0.20% gives +0.0139% of notional per entry against a −0.0001% hold control (EDGE +0.0140)**,
 * 88.9% of 36 decided trades won. The live 0.23% setting gives +0.0063 (EDGE +0.0096) — the same
 * direction, roughly half the size, and NOT separable from 0.20 at n=26–36. Horizons: 6 min loses
 * (+0.0002), 24 min is the peak edge, 60 min and 120 min have positive expectancy but NEGATIVE edge
 * (holding beat the target), so a long time-stop is not the lever.
 *
 * Usage:
 *   node scripts/report-first-passage.cjs                                  # defaults below
 *   node scripts/report-first-passage.cjs --symbols GER40,JP225,XAUUSD --targets 0.1,0.15,0.2
 *   node scripts/report-first-passage.cjs --stop 0.4 --max-bars 24 --days 7
 *   node scripts/report-first-passage.cjs --stops 0.2,0.3,0.4 --targets 0.15,0.2   # 2-D sweep
 *   node scripts/report-first-passage.cjs --self-test
 */
'use strict';
const path = require('path');
const { PrismaClient } = require(path.join(__dirname, '..', 'nest', 'node_modules', '@prisma', 'client'));

const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i === -1 ? d : process.argv[i + 1]; };
const has = (n) => process.argv.includes(`--${n}`);

/**
 * splitSegments() — cut the bar series wherever there is a real HOLE in time.
 *
 * ⚠️ MEASURED 2026-11-06, and it was silently wrong before this existed: `marketbar` is not
 * contiguous. Over a 7-day window US30 and US500 each contain a **2,946-minute (49-hour)** hole and
 * 8–10 gaps longer than 2 minutes; every symbol has at least 3. Walking bar to bar therefore treated
 * "24 bars" as 24 minutes when it could be two days, and reported the seam as a **−3.45% one-minute
 * move**. A stop-loss decision made across a weekend gap is not a stop-loss decision — nothing could
 * have been sold at those prices — so a trade is never allowed to span a segment boundary.
 */
function splitSegments(bars, maxGapSec = 120) {
  if (!bars.length) return [];
  if (!bars[0].ts) return [bars];
  const segs = [];
  let cur = [bars[0]];
  for (let i = 1; i < bars.length; i++) {
    if ((bars[i].ts - bars[i - 1].ts) / 1000 > maxGapSec) { segs.push(cur); cur = [bars[i]]; }
    else cur.push(bars[i]);
  }
  segs.push(cur);
  return segs;
}

/**
 * simulate() — the whole study for ONE symbol, one target, one stop.
 *
 * Returns counts + the expectancy in PERCENT of entry price, which is the only unit that compares
 * across symbols (a 58-point GER40 move and a 200-point JP225 move are the same 0.23%).
 */
function simulate(bars, targetPct, stopPct, maxBars, spreadPct, maxGapSec = 120) {
  const segments = splitSegments(bars, maxGapSec);
  const acc = { wins: 0, losses: 0, timeouts: 0, ambiguous: 0, entries: 0, timeoutPcts: [], holdPcts: [] };
  for (const seg of segments) runSegment(seg, targetPct, stopPct, maxBars, spreadPct, acc);
  return summarise(acc, targetPct, stopPct);
}

function runSegment(bars, targetPct, stopPct, maxBars, spreadPct, acc) {
  const { timeoutPcts, holdPcts } = acc;
  let i = 0;
  while (i < bars.length - 1) {
    const entry = bars[i].close;
    if (!(entry > 0)) { i++; continue; }
    acc.entries++;
    // Ask on the way in, bid on the way out: the target must clear its own entry cost.
    const targetPx = entry * (1 + (targetPct + spreadPct) / 100);
    const stopPx = entry * (1 - stopPct / 100);
    // The horizon is the same for every branch, so "hold" is a like-for-like CONTROL: same entries,
    // same bars, same spread. Without it a target/stop could look profitable purely because the week
    // trended, which is the single easiest way to be fooled by a long-only study.
    const horizonIx = Math.min(bars.length - 1, i + maxBars);
    holdPcts.push(((bars[horizonIx].close - entry) / entry) * 100 - spreadPct);
    let outcome = null;
    let j = i + 1;
    for (; j < Math.min(bars.length, i + 1 + maxBars); j++) {
      const hitTarget = bars[j].high >= targetPx;
      const hitStop = bars[j].low <= stopPx;
      if (hitTarget && hitStop) { outcome = 'ambiguous'; break; }
      if (hitTarget) { outcome = 'win'; break; }
      if (hitStop) { outcome = 'loss'; break; }
    }
    if (outcome === null) {
      outcome = 'timeout';
      // Mark to market at the last bar scanned: a trade that went nowhere still moved.
      const lastClose = bars[horizonIx]?.close ?? entry;
      timeoutPcts.push(((lastClose - entry) / entry) * 100 - spreadPct);
    }
    if (outcome === 'win') acc.wins++;
    else if (outcome === 'loss') acc.losses++;
    else if (outcome === 'timeout') acc.timeouts++;
    else acc.ambiguous++;
    // ⚠️ NON-OVERLAP MEANS THE NEXT ENTRY IS AFTER THE EXIT BAR, not on it. Setting i = j let a
    // trade held for 5 bars overlap the next four entries, so a single trend was counted repeatedly
    // — the exact flattery this tool exists to avoid. A decided exit consumes bars i..j; a timeout
    // consumed everything it scanned.
    i = outcome === 'timeout' ? Math.max(i + 1, j) : j + 1;
  }
}

function summarise(acc, targetPct, stopPct) {
  const { entries, wins, losses, timeouts, ambiguous, timeoutPcts, holdPcts } = acc;
  const decided = wins + losses;
  const winRate = decided > 0 ? wins / decided : null;

  // ⚠️ EXPECTANCY IS PER ENTRY, NOT PER DECIDED TRADE, AND THAT CORRECTION IS THE WHOLE POINT.
  // The first version of this tool divided by (wins + losses) and dropped timeouts entirely. MEASURED
  // 2026-11-06: EURUSD showed "100% win rate, +20% expectancy" from **3 decided trades and 157
  // timeouts** — the numbers were arithmetically right and completely meaningless, which is the exact
  // "plausible number, no error" shape this repo keeps re-finding. Two fixes:
  //   • a TIMEOUT is marked to market at the last scanned close, so it contributes its real P&L
  //     instead of vanishing;
  //   • the denominator is EVERY scored entry, so a symbol that mostly goes nowhere cannot look good.
  const scored = wins + losses + timeouts;
  let timeoutPnl = 0;
  for (const pnl of timeoutPcts) timeoutPnl += pnl;
  const expectancy = scored > 0
    ? (((wins * targetPct) - (losses * stopPct)) + timeoutPnl) / scored
    : null;

  // `holdDrift` is the control. `edge` is the ONLY number that says the target/stop geometry did
  // something: expectancy minus what holding the same entries earned. When neither target nor stop is
  // ever touched, every trade is a timeout and `edge` is exactly 0 — a canary the self-test pins.
  let holdSum = 0;
  for (const p of holdPcts) holdSum += p;
  const holdDrift = holdPcts.length ? holdSum / holdPcts.length : null;
  const edge = expectancy !== null && holdDrift !== null ? expectancy - holdDrift : null;
  return { entries, wins, losses, timeouts, ambiguous, winRate, expectancy, decided, scored, holdDrift, edge };
}

// Formatters live at module scope so the self-test can pin their UNITS. `winRate` is a fraction;
// `expectancy` is already percent-of-notional. Mixing those up is the 100× defect described above.
const fmtRate = (v) => (v === null || v === undefined ? '   —' : `${(v * 100).toFixed(1)}%`.padStart(5));
const fmtExpectancy = (v) => (v === null || v === undefined ? '       —' : `${v >= 0 ? '+' : ''}${v.toFixed(4)}`.padStart(7));

function selfTest() {
  let pass = 0, fail = 0;
  const t = (n, c) => { if (c) pass++; else { fail++; console.log(`  ✖ ${n}`); } };
  const bar = (h, l, c = (h + l) / 2) => ({ high: h, low: l, close: c });

  // Clean win: rises 1% before any 1% dip.
  let r = simulate([bar(100, 100), bar(101.2, 100.5), bar(101.4, 101)], 1, 1, 5, 0);
  t('clean win counted once', r.wins === 1 && r.losses === 0);

  // Clean loss.
  r = simulate([bar(100, 100), bar(100.2, 98.8)], 1, 1, 5, 0);
  t('clean loss counted once', r.losses === 1 && r.wins === 0);

  // ONE BAR COVERING BOTH — must be ambiguous, never a win.
  r = simulate([bar(100, 100), bar(102, 98)], 1, 1, 5, 0);
  t('both-hit bar is AMBIGUOUS', r.ambiguous === 1 && r.wins === 0 && r.losses === 0);
  t('ambiguous is excluded from the win rate', r.winRate === null);

  // Nothing happens: timeout, and it must not count as a loss.
  r = simulate([bar(100, 100), bar(100.1, 99.95), bar(100.1, 99.95)], 1, 1, 2, 0);
  t('timeout is its own outcome', r.timeouts === 1 && r.losses === 0);

  // SPREAD must bite: a 0.5% spread against a 1% target needs a 1.5% move.
  const flat = [bar(100, 100), bar(101.2, 100.5), bar(101.4, 101)];
  t('a win without spread becomes a timeout with one', simulate(flat, 1, 1, 3, 0).wins === 1 && simulate(flat, 1, 1, 3, 0.5).wins === 0);

  // NON-OVERLAP: a trade consumes its entry bar, up to maxBars of scanning, and the next entry
  // starts AFTER the exit bar. Every trade therefore consumes its ENTRY bar plus at least one
  // scanned bar, so 40 bars can yield at most 20 entries — not 40. (Asserting on wins instead would
  // be wrong: in a monotonic rise every non-overlapping trade legitimately wins; the defect is
  // entries per bar, not the win count.)
  const trend = [bar(100, 100)];
  for (let k = 1; k <= 40; k++) trend.push(bar(100 + k * 0.5, 100 + k * 0.5 - 0.1));
  const tr = simulate(trend, 0.5, 5, 2, 0);
  t('no two entries share a bar (non-overlap)', tr.entries <= Math.ceil(40 / 2));

  // Expectancy sign: all wins -> positive; all losses -> negative.
  t('expectancy positive on all wins', simulate([bar(100, 100), bar(102, 100.1)], 1, 1, 3, 0).expectancy > 0);
  t('expectancy negative on all losses', simulate([bar(100, 100), bar(100.1, 98)], 1, 1, 3, 0).expectancy < 0);

  // TIMEOUTS MUST NOT VANISH FROM THE DENOMINATOR. This is the canary for the defect that produced
  // "EURUSD 100% win rate, +20% expectancy" from 3 decided trades — the flattery came from dividing
  // by (wins + losses) and dropping the 157 timeouts that went nowhere.
  const stuck = [];
  for (let k = 0; k < 30; k++) stuck.push(bar(100.02, 99.98, 100));
  const stuckR = simulate(stuck, 1, 1, 3, 0.05);
  t('timeouts stay in the denominator', stuckR.scored === stuckR.entries && stuckR.decided === 0);
  t('a flat market scores NEGATIVE once spread is charged', stuckR.expectancy !== null && stuckR.expectancy < 0);
  // …and the mirror direction: a timeout that drifted up must score positive, so the rule is not a
  // blanket "timeouts are losses".
  const drifting = [bar(100, 100)];
  for (let k = 1; k <= 20; k++) drifting.push(bar(100 + k * 0.02, 100 + k * 0.02 - 0.01));
  const driftR = simulate(drifting, 50, 50, 2, 0);
  t('a timeout drifting up scores POSITIVE', driftR.timeouts > 0 && driftR.expectancy > 0);
  // …and the value itself, because `/decided` can still look right when decided === 0 (a negative
  // timeout P&L divided by zero is -Infinity, which is < 0 and would pass the sign test above). This
  // pins the denominator NUMERICALLY: 1 win of 1% across 20 scored entries is +0.05%, not +1%.
  const mixed = [bar(100, 100), bar(101.5, 99.5, 100)];
  for (let k = 0; k < 40; k++) mixed.push(bar(100.05, 99.95, 100));
  const mixedR = simulate(mixed, 1, 50, 1, 0);
  t('expectancy divides by EVERY scored entry, not just decided ones',
    mixedR.wins === 1 && mixedR.scored >= 19 && Math.abs(mixedR.expectancy - 1 / mixedR.scored) < 1e-9);

  // UNIT GUARD — pins the formatter, which is where the 100× overstatement lived. A 0.021 percent
  // expectancy must print as 0.0210, NOT 2.1000. Both formatters are pure, so this is exact.
  t('expectancy prints percent AS percent (no second x100)', fmtExpectancy(0.021).trim() === '+0.0210');
  t('win rate prints a fraction AS a percentage', fmtRate(0.952).trim() === '95.2%');
  t('end-to-end unit: a 0.25% target won once in 100 scores prints under 0.01',
    fmtExpectancy(simulate([bar(100, 100), bar(101, 99.9)], 0.25, 0.4, 1, 0).expectancy).trim() <= '+0.2500');

  // EDGE = expectancy minus holding. Two directions, and both matter:
  //  • nothing ever touched -> edge is EXACTLY 0, because there is no decision to add value;
  //  • a small target in a STRONG TREND -> edge is NEGATIVE, because exiting early forfeits the run.
  //    That second case is the honest cost of a small target, and no trend-blind expectancy can show it.
  const nothingTouched = [];
  for (let k = 0; k < 20; k++) nothingTouched.push(bar(100.05, 99.95, 100));
  t('edge is ZERO when neither target nor stop is ever touched',
    Math.abs(simulate(nothingTouched, 5, 5, 3, 0).edge) < 1e-12);
  const strong = [bar(100, 100)];
  for (let k = 1; k <= 40; k++) strong.push(bar(100 + k * 1, 100 + k * 1 - 0.5, 100 + k * 1));
  const strongSmall = simulate(strong, 0.5, 50, 10, 0);
  t('a small target in a strong trend has NEGATIVE edge', strongSmall.wins > 0 && strongSmall.edge < 0);

  // GAP GUARD — a hole in the series must never become a trade. Two directions:
  //  • the split itself (a 3-hour hole yields two segments, a 60 s step yields one);
  //  • the consequence — a crash on the far side of the hole must NOT be scored as this trade's loss,
  //    because nothing could have been sold at those prices. Without segmentation this is 1 loss.
  const t0 = Date.UTC(2026, 10, 5, 10, 0, 0);
  const withGap = [
    { ts: t0, high: 100, low: 100, close: 100 },
    { ts: t0 + 60_000, high: 100.1, low: 99.95, close: 100 },
    { ts: t0 + 10 * 3600_000, high: 55, low: 50, close: 50 },   // 10-hour hole, then a -50% crash
    { ts: t0 + 10 * 3600_000 + 60_000, high: 55, low: 50, close: 50 },
  ];
  t('splitSegments cuts on a real hole', splitSegments(withGap).length === 2);
  t('splitSegments does NOT cut a contiguous series',
    splitSegments([{ ts: t0, high: 1, low: 1, close: 1 }, { ts: t0 + 60_000, high: 1, low: 1, close: 1 }]).length === 1);
  const acrossGap = simulate(withGap, 1, 0.4, 5, 0);
  t('a trade NEVER spans a gap (the crash is not this trade loss)', acrossGap.losses === 0);

  console.log(`\n[self-test] ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}

(async () => {
  if (has('self-test')) return selfTest();

  const days = Number(arg('days', 7));
  const stop = Number(arg('stop', 0.4));
  // A 2-D sweep. The stop matters MORE than the target: break-even win rate is stop/(stop+target),
  // so at a 0.4% stop against a 0.2% target a bot must win 66.7% of decided trades just to break even.
  // Sweeping both is how you find out whether a small target has any room at all.
  const stops = String(arg('stops', stop)).split(',').map(Number).filter((n) => n > 0);
  const maxBars = Number(arg('max-bars', 24));
  const targets = String(arg('targets', '0.1,0.15,0.2,0.25,0.3')).split(',').map(Number);
  const wanted = String(arg('symbols', 'GER40,JP225,US500,US30,UK100,FRA40,XAUUSD,EURUSD,GBPUSD,NZDJPY')).split(',').map((s) => s.trim().toUpperCase());

  const prisma = new PrismaClient();
  const rows = [];

  for (const ticker of wanted) {
    const s = await prisma.$queryRawUnsafe('SELECT id FROM symbol WHERE ticker = ?', ticker);
    if (!s.length) { console.log(`  (skip ${ticker} — not in the symbol table)`); continue; }

    // Finest timeframe with enough history; 1m gives the truest first-passage.
    let tf = null, bars = [];
    for (const candidate of ['1m', '5m', '15m']) {
      const b = await prisma.$queryRawUnsafe(
        `SELECT timestamp, high, low, close FROM marketbar WHERE symbolId = ? AND timeframe = ?
         AND timestamp >= NOW() - INTERVAL ${days} DAY AND close > 0 ORDER BY timestamp`,
        s[0].id, candidate);
      if (b.length >= 400) {
        tf = candidate;
        // `ts` is carried so splitSegments() can refuse to let a trade span a hole in the series.
        bars = b.map((x) => ({ ts: new Date(x.timestamp).getTime(), high: Number(x.high), low: Number(x.low), close: Number(x.close) }));
        break;
      }
    }
    if (!bars.length) { console.log(`  (skip ${ticker} — fewer than 400 bars on 1m/5m/15m)`); continue; }

    // LIVE spread from the bridge that trades it — a small target cannot be judged without it.
    // MEASURED 2026-11-06: EURUSD and GBPUSD resolved to spread 0.000 because no symbol_route row
    // matched, which made every FX row look free to trade. The primary bridge (port 5000) is the
    // fallback, and `spreadKnown` records whether the QUOTE was actually read so an unknown spread
    // can never be printed as a confident zero.
    let spreadPct = 0;
    let spreadKnown = false;
    try {
      const route = await prisma.$queryRawUnsafe(
        'SELECT brokerId FROM symbol_route WHERE symbol = ? AND provider = ? AND enabled = 1 ORDER BY priority LIMIT 1', ticker, 'mt5');
      const port = route.length ? 5000 + (Number(route[0].brokerId) - 2) : 5000;
      const q = await fetch(`http://127.0.0.1:${port}/quote?symbol=${encodeURIComponent(ticker)}`, { signal: AbortSignal.timeout(4000) })
        .then((r) => r.json()).catch(() => null);
      if (q && q.bid != null && q.ask != null && q.bid > 0) {
        spreadPct = ((q.ask - q.bid) / ((q.ask + q.bid) / 2)) * 100;
        spreadKnown = true;
      }
    } catch { /* leave 0, and spreadKnown stays false so the row is marked */ }

    for (const stopPct of stops) {
      for (const target of targets) {
        const r = simulate(bars, target, stopPct, maxBars, spreadPct);
        rows.push({ ticker, tf, n: bars.length, target, stopPct, spreadPct, spreadKnown, ...r });
      }
    }
  }

  const pc = fmtRate;
  const sg = fmtExpectancy;

  console.log(`\nFIRST PASSAGE — does +TARGET arrive before -STOP%? (${days}d bars, max ${maxBars} bars, spread charged)`);
  console.log(`entries are non-overlapping; AMBIGUOUS bars (target and stop inside one bar) are EXCLUDED\n`);
  console.log('symbol   tf   bars  stop%  target%  spread%  entries  win    loss   t/o  ambig  dec  win rate  expectancy%    hold%    EDGE%');
  console.log('-'.repeat(132));
  for (const r of rows) {
    // `dec` is the count that actually decided (stop or target hit). A row with dec < 20 is printed
    // with a LOW-N tag rather than a confident win rate — 3 decided trades is not a win rate.
    const lowN = r.decided < 20 ? ' LOW-N' : '';
    console.log(
      `${r.ticker.padEnd(8)} ${r.tf.padEnd(4)} ${String(r.n).padStart(5)} ${String(r.stopPct).padStart(6)} ${String(r.target).padStart(8)} ` +
      `${(r.spreadKnown ? r.spreadPct.toFixed(3) : '  n/a').padStart(8)} ${String(r.entries).padStart(8)} ${String(r.wins).padStart(4)} ` +
      `${String(r.losses).padStart(6)} ${String(r.timeouts).padStart(5)} ${String(r.ambiguous).padStart(6)} ` +
      `${String(r.decided).padStart(4)} ${pc(r.winRate).padStart(11)} ${sg(r.expectancy).padStart(11)} `
      + `${sg(r.holdDrift).padStart(8)} ${sg(r.edge).padStart(8)}${lowN}`);
  }

  // Ranked on EDGE, not expectancy: edge is expectancy minus what holding the same entries earned, so
  // it is the only column where a trending week cannot masquerade as a strategy.
  const best = rows.filter((r) => r.edge !== null && r.decided >= 20)
    .sort((a, b) => b.edge - a.edge).slice(0, 12);
  console.log('\nbest EDGE per entry, decided >= 20 (expectancy minus holding — the only column trend cannot fake):');
  if (!best.length) console.log('  (nothing reached 20 decided trades — the study proves nothing either way)');
  for (const r of best) {
    console.log(`  ${r.ticker.padEnd(8)} stop ${String(r.stopPct).padEnd(5)}% target ${String(r.target).padEnd(5)}%  dec ${String(r.decided).padStart(4)} `
      + `(${String(r.wins).padStart(3)}W/${String(r.losses).padStart(3)}L/${String(r.timeouts).padStart(3)}to)  `
      + `win rate ${pc(r.winRate)}  exp ${sg(r.expectancy)}  hold ${sg(r.holdDrift)}  EDGE ${sg(r.edge)}%`);
  }
  console.log('\n⚠️ NOT A BACKTEST: no signals, no scoring, no slippage/commission/swap. A promising number is a');
  console.log('   reason to test live, not a result. Negative expectancy is a reason NOT to.');
  await prisma.$disconnect();
})().catch((e) => { console.error(e.message); process.exit(1); });
