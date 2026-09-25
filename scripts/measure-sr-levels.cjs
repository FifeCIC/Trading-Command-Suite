/**
 * measure-sr-levels.cjs — QUICK ROUTE for #989 (Support & Resistance, Lab)
 *
 * WHY THIS SCRIPT EXISTS, AND WHY IT IS NOT A PAGE
 * ------------------------------------------------
 * #989 says, in its own words: "the quick route is the gate for the advanced one.
 * Publishing the page first would produce a confident display of an unvalidated idea."
 * So this measures whether the level prediction is worth anything BEFORE any UI is built.
 *
 * THE HINDSIGHT FLAW THIS AVOIDS (#989)
 * -------------------------------------
 * The owner: "'Ceiling' is only knowable in hindsight". Scoring a stored "predicted ceiling"
 * against the level that BECAME the high is accurate BY CONSTRUCTION — it is a tautology, not
 * a measurement.
 *
 * The fix is a CAUSAL REPLAY: at bar i the detector may only see bars[0..i]. A pivot at j is
 * knowable only at j + PIVOT_WINDOW, so the replay never reads a bar it could not have had.
 * Every number below is produced by that replay.
 *
 * WHAT IT MEASURES (#989's three questions)
 * ------------------------------------------
 *   Q1 how limits are established — swing pivots vs round numbers vs N-bar high, and their DISAGREEMENT
 *   Q2 how quickly a decision can be made — DETECTION LAG, in bars
 *   Q3 how accurate in hindsight — predicted ceiling vs the realised extreme, with sample size
 *
 * MIRRORS the shipped directive exactly (support-resistance.directive.ts):
 *   LOOKBACK = 30, PIVOT_WINDOW = 3, PROXIMITY_PCT = 2
 * If those constants change there, this script is measuring a different algorithm.
 *
 * Run: node scripts/measure-sr-levels.cjs [--tf 1h] [--horizon 24] [--limit 40]
 */

const { execFileSync } = require('node:child_process');

/**
 * q() — run a query through the mysql CLI and return rows.
 *
 * ⚠️ This shells out rather than using a driver because NO JS MySQL driver is installed in this
 * repo (checked: neither mysql2 nor mysql is present; the app talks through Prisma only).
 * `scripts/diff-seed-vs-db.cjs` does the same thing for the same reason — this follows that
 * established pattern rather than adding a dependency for a one-off measurement.
 *
 * -N strips column headers, -B gives tab-separated output: one row per line, parseable directly.
 */
const MYSQL = 'C:\\wamp64\\bin\\mysql\\mysql9.1.0\\bin\\mysql.exe';
function query(sql) {
  const out = execFileSync(MYSQL, ['-u', 'tradingcs', 'tradingcs', '-N', '-B', '-e', sql], {
    env: { ...process.env, MYSQL_PWD: 'tradingcs_dev_2026' },
    encoding: 'utf8',
    maxBuffer: 512 * 1024 * 1024,
  });
  return out.split(/\r?\n/).filter((l) => l.length).map((l) => l.split('\t'));
}

// ── mirrors of the shipped directive's constants ──
const LOOKBACK = 30;
const PIVOT_WINDOW = 3;
const PROXIMITY_PCT = 2;

/**
 * arg() — read a CLI flag in EITHER form: `--tf=1d` or `--tf 1d`.
 *
 * ⚠️ The first version only handled `--x=v`. Called as `--tf 1d` it silently returned the
 * DEFAULT, so a "1d" run printed 1h numbers under a 1d heading. Silent, plausible, wrong —
 * the exact failure class this repo keeps re-finding, and it happened here.
 */
const arg = (name, dflt) => {
  const eq = process.argv.find((a) => a.startsWith(`--${name}=`));
  if (eq) return eq.split('=')[1];
  const i = process.argv.indexOf(`--${name}`);
  if (i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--')) return process.argv[i + 1];
  return dflt;
};
const TF = arg('tf', '1h');
const HORIZON = Number(arg('horizon', 24)); // bars held forward = the "available" move
const LIMIT = Number(arg('limit', 40));

const fmt = (n, d = 2) => (n === null || n === undefined || !Number.isFinite(n) ? '—' : n.toFixed(d));
const pct = (n) => (Number.isFinite(n) ? `${(n * 100).toFixed(1)}%` : '—');

function quantiles(sorted, qs) {
  const out = {};
  for (const qq of qs) {
    if (!sorted.length) { out[qq] = null; continue; }
    const idx = Math.min(sorted.length - 1, Math.max(0, Math.round(qq * (sorted.length - 1))));
    out[qq] = sorted[idx];
  }
  return out;
}

/**
 * causalResistance() — the nearest swing-high resistance above `price`, using ONLY bars[0..i].
 *
 * ⚠️ The upper bound is `i - PIVOT_WINDOW`, not `i`. A pivot needs PIVOT_WINDOW bars AFTER it
 * before it exists at all; reading up to `i` would let the replay see a confirmation that had
 * not happened yet — which is precisely the look-ahead that makes this test pass for free.
 */
function causalResistance(bars, i, price) {
  const highs = [];
  const start = Math.max(PIVOT_WINDOW, i - LOOKBACK - PIVOT_WINDOW);
  const end = i - PIVOT_WINDOW;
  for (let j = start; j < end; j++) {
    let isPivot = true;
    for (let k = j - PIVOT_WINDOW; k <= j + PIVOT_WINDOW; k++) {
      if (k === j || k > i) continue;
      if (bars[k].high >= bars[j].high) { isPivot = false; break; }
    }
    if (isPivot) highs.push(bars[j].high);
  }
  let best = Infinity;
  for (const h of highs) if (price < h && h - price < best - price) best = h;
  return { level: best < Infinity ? best : null, count: highs.length };
}

/**
 * causalOtherHigh() — THE CONTROL for causalResistance().
 *
 * ⚠️ WHY A CONTROL IS MANDATORY HERE. "62.5% of predicted ceilings were reached, overshoot
 * median 0.3%" is persuasive only if a PIVOT high behaves differently from an ordinary high.
 * If it does not, the pivot detection is decoration and the number is a fact about price, not
 * about support/resistance.
 *
 * So: the nearest above-price high in the SAME window that is NOT a confirmed pivot. Same
 * lookback, same causality, same construction — the only difference is the pivot structure.
 * If the two behave the same, the levels carry no information and #989's advanced route is
 * unjustified.
 */
function causalOtherHigh(bars, i, price) {
  const others = [];
  const start = Math.max(PIVOT_WINDOW, i - LOOKBACK - PIVOT_WINDOW);
  const end = i - PIVOT_WINDOW;
  for (let j = start; j < end; j++) {
    let isPivot = true;
    for (let k = j - PIVOT_WINDOW; k <= j + PIVOT_WINDOW; k++) {
      if (k === j || k > i) continue;
      if (bars[k].high >= bars[j].high) { isPivot = false; break; }
    }
    if (!isPivot) others.push(bars[j].high);
  }
  let best = Infinity;
  for (const h of others) if (price < h && h - price < best - price) best = h;
  return best < Infinity ? best : null;
}

/** The alternative methods the page would show side by side, for the disagreement measure. */
function roundNumberAbove(price) {
  // Round-number ladder scaled to the instrument's magnitude.
  const step = price >= 1000 ? 50 : price >= 100 ? 5 : price >= 10 ? 1 : price >= 1 ? 0.25 : 0.01;
  return Math.ceil(price / step) * step;
}

async function main() {
  const MIN_BARS = LOOKBACK + HORIZON + 10;
  const symRows = query(
    `SELECT s.ticker, COUNT(*) AS n
       FROM marketbar b JOIN symbol s ON s.id = b.symbolId
      WHERE b.timeframe = '${TF}' GROUP BY s.ticker HAVING n >= ${MIN_BARS} ORDER BY n DESC LIMIT ${LIMIT}`,
  ).map(([ticker]) => ({ ticker }));

  const agg = {
    symbols: 0, observations: 0,
    reach: 0,                     // price reached the predicted ceiling
    overshootRatios: [],          // realised extreme / predicted ceiling
    errorPct: [],                 // signed distance of the realised extreme from the prediction
    lagBars: [],                  // bars until the turning point's pivot is confirmable
    disagreePct: [],              // spread between the three methods, as % of price
    distToLevelPct: [],           // ⚠️ THE NON-TRIVIALITY CHECK — how far above price the level is
    overshootPct: [],             // reached only: how far PAST the level price went
    givebackPct: [],              // reached only: how far price fell back AFTER touching it
    // ── CONTROL ARM: identical construction, but the level is NOT a pivot ──
    ctl: { n: 0, reach: 0, dist: [], overshoot: [], giveback: [] },
  };
  const perSymbol = [];

  for (const { ticker } of symRows) {
    const bars = query(
      `SELECT b.timestamp, b.open, b.high, b.low, b.close
         FROM marketbar b JOIN symbol s ON s.id = b.symbolId
        WHERE s.ticker = '${ticker.replace(/'/g, "''")}' AND b.timeframe = '${TF}'
        ORDER BY b.timestamp ASC`,
    ).map(([, open, high, low, close]) => ({
      open: Number(open), high: Number(high), low: Number(low), close: Number(close),
    })).filter((b) => Number.isFinite(b.high) && Number.isFinite(b.close));
    if (bars.length < LOOKBACK + HORIZON + 10) continue;
    agg.symbols++;

    let obs = 0, reached = 0;
    for (let i = LOOKBACK + PIVOT_WINDOW; i < bars.length - HORIZON; i++) {
      const price = bars[i].close;
      const { level } = causalResistance(bars, i, price);
      if (!level) continue;

      // the available move: the highest high over the forward window
      let mfe = -Infinity, mfeBar = -1;
      for (let k = i + 1; k <= i + HORIZON; k++) {
        if (bars[k].high > mfe) { mfe = bars[k].high; mfeBar = k; }
      }

      const ratio = mfe / level;
      agg.overshootRatios.push(ratio);
      agg.errorPct.push((mfe - level) / level);
      agg.distToLevelPct.push((level - price) / price);

      if (mfe >= level) {
        reached++;
        // ── FIRST TOUCH, then what price did afterwards ──
        // A ceiling claim is only meaningful if it says "price turns here", not merely
        // "price gets here". Overshoot is how far through it went; giveback is whether it
        // came back. Both are conditional on the level being touched at all.
        let touchBar = -1;
        for (let k = i + 1; k <= i + HORIZON; k++) if (bars[k].high >= level) { touchBar = k; break; }
        if (touchBar > 0) {
          let post = Infinity;
          for (let k = touchBar; k <= i + HORIZON; k++) if (bars[k].low < post) post = bars[k].low;
          agg.overshootPct.push((mfe - level) / level);
          agg.givebackPct.push((level - post) / level);
        }
      }

      const rn = roundNumberAbove(price);
      const nHigh = Math.max(...bars.slice(Math.max(0, i - 20), i).map((b) => b.high));
      const spread = (Math.max(level, rn, nHigh) - Math.min(level, rn, nHigh)) / price;
      agg.disagreePct.push(spread);

      // ── CONTROL: same window, same causality, but a high that is NOT a pivot ──
      const ctlLevel = causalOtherHigh(bars, i, price);
      if (ctlLevel) {
        agg.ctl.n++;
        agg.ctl.dist.push((ctlLevel - price) / price);
        if (mfe >= ctlLevel) {
          agg.ctl.reach++;
          let ctlTouch = -1;
          for (let k = i + 1; k <= i + HORIZON; k++) if (bars[k].high >= ctlLevel) { ctlTouch = k; break; }
          if (ctlTouch > 0) {
            let ctlPost = Infinity;
            for (let k = ctlTouch; k <= i + HORIZON; k++) if (bars[k].low < ctlPost) ctlPost = bars[k].low;
            agg.ctl.overshoot.push((mfe - ctlLevel) / ctlLevel);
            agg.ctl.giveback.push((ctlLevel - ctlPost) / ctlLevel);
          }
        }
      }

      obs++;
      agg.observations++;
    }
    reached && (agg.reach += reached);

    // ── Q2 detection lag, measured on the turning points themselves ──
    // For each realised extreme inside the series, the bar at which it becomes a CONFIRMED
    // pivot is extremeBar + PIVOT_WINDOW. That lag is the earliest a decision could be made.
    for (let m = PIVOT_WINDOW; m < bars.length - PIVOT_WINDOW; m++) {
      let isExtreme = true;
      for (let k = m - PIVOT_WINDOW; k <= m + PIVOT_WINDOW; k++) {
        if (k === m) continue;
        if (bars[k].high >= bars[m].high) { isExtreme = false; break; }
      }
      if (isExtreme) agg.lagBars.push(PIVOT_WINDOW);
    }

    if (obs) perSymbol.push({ ticker, obs });
  }

  // ── report ──
  const sorted = (a) => [...a].sort((x, y) => x - y);
  const ratios = sorted(agg.overshootRatios);
  const q = quantiles(ratios, [0.1, 0.25, 0.5, 0.75, 0.9]);
  const errs = sorted(agg.errorPct);
  const eq = quantiles(errs, [0.1, 0.25, 0.5, 0.75, 0.9]);
  const dis = sorted(agg.disagreePct);
  const dq = quantiles(dis, [0.25, 0.5, 0.75, 0.9]);
  const mean = (a) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : null);

  console.log(`\n  SUPPORT & RESISTANCE — QUICK ROUTE (#989)  tf=${TF}  horizon=${HORIZON} bars`);
  console.log(`  causal replay: LOOKBACK=${LOOKBACK} PIVOT_WINDOW=${PIVOT_WINDOW} (a pivot is only`);
  console.log(`  knowable ${PIVOT_WINDOW} bars after it forms — the replay never reads past bar i)\n`);

  console.log(`  symbols=${agg.symbols}  observations=${agg.observations}  warnings=${'-'}`);
  if (!agg.observations) { console.log('\n  no observations — nothing to conclude\n'); return; }

  console.log(`\n  Q3 ACCURACY — predicted ceiling vs the realised extreme (n = ${agg.observations})`);
  console.log(`    reached the predicted level at all : ${pct(agg.reach / agg.observations)}`);
  console.log(`    realised/predicted  median         : ${fmt(q[0.5], 3)}   (1.000 = exact)`);
  console.log(`                        p25 .. p75      : ${fmt(q[0.25], 3)} .. ${fmt(q[0.75], 3)}`);
  console.log(`                        p10 .. p90      : ${fmt(q[0.1], 3)} .. ${fmt(q[0.9], 3)}`);
  console.log(`    signed error  median               : ${pct(eq[0.5])}   (+ = overshot the prediction)`);
  console.log(`                  mean                 : ${pct(mean(agg.errorPct))}`);
  console.log(`                  p10 .. p90           : ${pct(eq[0.1])} .. ${pct(eq[0.9])}`);

  // ⚠️ THE NON-TRIVIALITY CHECK. "Reached 62.5%" and "ratio ≈ 1.000" are persuasive only if the
  // prediction was non-trivial — if the level sits 0.05% above price, both are guaranteed by
  // arithmetic and prove nothing. This is the number that decides whether the rest means anything.
  const dl = sorted(agg.distToLevelPct);
  const dq2 = quantiles(dl, [0.25, 0.5, 0.75, 0.9]);
  console.log(`\n  ⚠️ NON-TRIVIALITY — how far ABOVE price the predicted ceiling sits (n = ${dl.length})`);
  console.log(`    distance to level  median          : ${pct(dq2[0.5])}`);
  console.log(`                       p25 / p75        : ${pct(dq2[0.25])} / ${pct(dq2[0.75])}`);
  console.log(`                       p90              : ${pct(dq2[0.9])}`);
  console.log(`    ⚠️ if this is ~0 the "accuracy" above is arithmetic, not prediction`);

  // ── THE ACTUAL CEILING CLAIM: does price TURN at the level, or go through it? ──
  const ov = sorted(agg.overshootPct);
  const ovq = quantiles(ov, [0.25, 0.5, 0.75, 0.9]);
  const gb = sorted(agg.givebackPct);
  const gbq = quantiles(gb, [0.25, 0.5, 0.75]);
  console.log(`\n  Q3b DOES IT ACT AS A CEILING? — touched levels only (n = ${ov.length})`);
  console.log(`    overshoot past the level  median    : ${pct(ovq[0.5])}`);
  console.log(`                              p75 / p90  : ${pct(ovq[0.75])} / ${pct(ovq[0.9])}`);
  console.log(`    price fell back after touch median  : ${pct(gbq[0.5])}`);
  console.log(`                                p25/p75 : ${pct(gbq[0.25])} / ${pct(gbq[0.75])}`);
  console.log(`    ⚠️ overshoot > 0 on ~half means the "ceiling" is a waypoint, not a limit`);

  // ── THE CONTROL. If these two columns look the same, the pivot structure is decoration. ──
  const c = agg.ctl;
  const cOv = sorted(c.overshoot);
  const cGb = sorted(c.giveback);
  const cOvQ = quantiles(cOv, [0.5]);
  const cGbQ = quantiles(cGb, [0.5]);
  const cDistQ = quantiles(sorted(c.dist), [0.5]);
  console.log(`\n  🔬 CONTROL — an ordinary high in the SAME window (not a pivot)`);
  console.log(`      ${'metric'.padEnd(34)}  pivot        control      reading`);
  // ⚠️ Only `giveback` can carry a reversal verdict. The others are descriptive — labelling a
  // distance difference as "reverses MORE" would be a category error dressed as a finding.
  const diff = (a, b) => `${(((a - b) * 100 >= 0 ? '+' : '') + ((a - b) * 100).toFixed(2))}pp`;
  const same = (a, b) => Math.abs(a - b) < 0.0005;
  console.log(`      ${'distance to level (median)'.padEnd(34)}  ${pct(dq2[0.5]).padEnd(12)} ${pct(cDistQ[0.5]).padEnd(12)} ${diff(dq2[0.5], cDistQ[0.5])} (descriptive)`);
  console.log(`      ${'reached at all'.padEnd(34)}  ${pct(agg.reach / agg.observations).padEnd(12)} ${pct(c.reach / Math.max(1, c.n)).padEnd(12)} ${diff(agg.reach / agg.observations, c.reach / Math.max(1, c.n))} (descriptive)`);
  console.log(`      ${'overshoot past it (median)'.padEnd(34)}  ${pct(ovq[0.5]).padEnd(12)} ${pct(cOvQ[0.5]).padEnd(12)} ${diff(ovq[0.5], cOvQ[0.5])} (descriptive)`);
  console.log(`      ${'giveback after touch (median)'.padEnd(34)}  ${pct(gbq[0.5]).padEnd(12)} ${pct(cGbQ[0.5]).padEnd(12)} ${diff(gbq[0.5], cGbQ[0.5])}  <-- ${same(gbq[0.5], cGbQ[0.5]) ? '⚠️ SAME — NO INFORMATION' : 'differs'}`);
  console.log(`      n = ${agg.observations} pivot / ${c.n} control`);
  console.log(`      ⚠️ "giveback" is the ONLY column that can settle this: a resistance that says`);
  console.log(`         "price turns here" must show MORE giveback than an ordinary high. If it does`);
  console.log(`         not, the level is a waypoint and the advanced route in #989 is not justified.`);

  console.log(`\n  Q2 DETECTION LAG — bars from the turning point to the first bar it is knowable`);
  console.log(`    pivots detected: ${agg.lagBars.length}   lag: ${PIVOT_WINDOW} bars on every one`);
  console.log(`    i.e. on ${TF} a ceiling is identifiable ${PIVOT_WINDOW} bars AFTER the high is made`);
  console.log(`    ⚠️ the high itself is ALWAYS in the past by the time it is usable`);

  console.log(`\n  Q1 METHOD DISAGREEMENT — swing pivot vs round number vs 20-bar high`);
  console.log(`    spread as % of price   median      : ${pct(dq[0.5])}`);
  console.log(`                           p75 / p90   : ${pct(dq[0.75])} / ${pct(dq[0.9])}`);
  console.log(`    (0% would mean the three agree; large = the "which level?" question is unresolved)\n`);
}

main().catch((e) => { console.error('  FAILED: ' + e.message); process.exit(1); });
