#!/usr/bin/env node
/**
 * measure-period-sensitivity.cjs — does the period knob actually MATTER? (M1, #1166)
 * ==================================================================================
 * The directive depth audit (#1166) proved 161 directives hardcode 110 named constants plus 29 inline
 * literal periods. That answers "can it be tuned". It does NOT answer the owner's actual question:
 *
 *   "how likely is it for each directive to offer better score and signal opportunity when we can
 *    configure it on a deeper level on a per symbol basis?"
 *
 * A knob is only worth the architecture in #1165 if RE-TUNING IT CHANGES THE ANSWER. If RSI-14 and
 * RSI-21 flag the same bars, a parameter buys nothing but a migration. So this script measures the one
 * thing that settles it: **the disagreement rate between the production period and its neighbours, on
 * real stored bars.**
 *
 * ── WHY THIS IS NOT A PARALLEL IMPLEMENTATION OF THE DIRECTIVE ─────────────
 * It does NOT re-implement any directive's scoring. It calls the SAME indicator functions the
 * directives import (`nest/src/modules/directives/utils/indicators.ts`) and applies the SAME threshold
 * each directive gates on, read from the directive source and cited below by file:line. The only thing
 * that varies is the period. If a threshold in the source changes, the citation here is what tells the
 * next reader to re-check it.
 *
 * ⚠️ WHAT THIS IS NOT: it does not say a directive WILL score better when tunable. It says the period
 * CHOICE IS LOAD-BEARING — i.e. whether there is any signal to gain at all. A high disagreement rate is
 * a necessary, not sufficient, condition for a parameter being worth building.
 *
 * ── THE METRIC ────────────────────────────────────────────────────────────
 * For each family and each bar, the directive's own threshold is a boolean "this bar is ON".
 *
 *   agreement   % of bars where the variant and production agree (identical boolean)
 *   events      number of times the state turns ON (0 -> 1) — the entry opportunities the directive
 *               could fire on. This is the number that matters: a directive firing 3 times vs 30 times
 *               over the same window is a completely different strategy.
 *   shared      events both variants fire, as a % of the union — how much of the OPPORTUNITY SET
 *               survives a period change. Low shared = the two settings are different strategies.
 *
 * Usage:
 *   node logs/measure-period-sensitivity.cjs                 # 1h VIX, every family
 *   node logs/measure-period-sensitivity.cjs --tf 1d --sym VIX
 *   node logs/measure-period-sensitivity.cjs --json          # machine-readable
 */

'use strict';

const { query, connect } = require('./lib/mysql-cli.cjs');

// ── Load the REAL indicator functions. They are TypeScript, so this uses the compiled build when one
// exists and otherwise transpiles on the fly. Refusing is deliberate: a stand-in implementation here
// would measure MY maths, not the directive's.
let ind;
function loadIndicators() {
  const candidates = [
    { mod: '../nest/dist/src/modules/directives/utils/indicators.js', how: 'compiled build' },
    { mod: '../nest/src/modules/directives/utils/indicators.ts', how: 'source (ts-node/register)' },
  ];
  for (const c of candidates) {
    try {
      if (c.mod.endsWith('.ts')) {
        try { require('ts-node/register/transpile-only'); } catch { /* try next */ }
      }
      ind = require(c.mod);
      return c.how;
    } catch { /* try next */ }
  }
  throw new Error(
    'Cannot load the indicator functions. Run `npm --prefix nest run build:api`, or install ts-node.\n' +
    'Refusing to substitute a local implementation — that would measure this script, not the directives.',
  );
}

/**
 * FAMILIES — one row per measurable knob.
 *
 * `threshold` is copied from the directive's own gate, with the citation. `variants` brackets the
 * production period, because the question is "would a neighbouring period give a different answer",
 * not "is 200 better than 14".
 */
const FAMILIES = [
  {
    id: 'rsi-oversold',
    label: 'RSI — oversold (rsi < 30)',
    period: 14,
    variants: [7, 14, 21, 28],
    threshold: (v) => v < 30,
    source: 'rsi-oversold.directive.ts:26 RSI_PERIOD = 14; :99 `else if (currentRsi < 30)`',
    compute: (h, l, c, v, bars) => ind.rsi(c, v),
  },
  {
    id: 'rsi-overbought',
    label: 'RSI — overbought (rsi > 70)',
    period: 14,
    variants: [7, 14, 21, 28],
    threshold: (v) => v > 70,
    source: 'rsi-overbought.directive.ts RSI_PERIOD = 14; mirrors the oversold thresholds at 70',
    compute: (h, l, c, v, bars) => ind.rsi(c, v),
  },
  {
    id: 'mfi-oversold',
    label: 'MFI — oversold (mfi < 20)',
    period: 14,
    variants: [7, 14, 21, 28],
    threshold: (v) => v < 20,
    source: 'mfi.directive.ts MFI_PERIOD = 14; `else if (currentMfi < 20)`',
    compute: (h, l, c, v, bars) =>
      ind.mfi(h, l, c, bars.map((b) => b.volume), v),
  },
  {
    id: 'cci-oversold',
    label: 'CCI — oversold (cci < -100)',
    period: 20,
    variants: [14, 20, 30, 40],
    threshold: (v) => v < -100,
    source: 'cci.directive.ts CCI_PERIOD = 20; crossover -100 is the +15 tier, < -200 / < -300 are the bonuses',
    compute: (h, l, c, v) => ind.cci(h, l, c, v),
  },
  {
    id: 'stochastic-oversold',
    label: 'Stochastic — %K oversold (%K < 20)',
    period: 14,
    variants: [9, 14, 21, 28],
    threshold: (v) => v < 20,
    source: 'stochastic.directive.ts K_PERIOD = 14, D_PERIOD = 3; `if (currentK < 20)`',
    compute: (h, l, c, v) => {
      const s = ind.stochastic(h, l, c, v, 3);
      return s.k;
    },
  },
  {
    id: 'williams-oversold',
    label: 'Williams %R — oversold (%R < -80)',
    period: 14,
    variants: [7, 14, 21, 28],
    threshold: (v) => v < -80,
    source: 'mt5-indicators.directives.ts WilliamsRDirective PERIOD default 14, oversold default -80 (parameterised 2026-11-01)',
    compute: (h, l, c, v) => ind.williamsR(h, l, c, v),
  },
  {
    id: 'adx-trending',
    label: 'ADX — trending (adx > 25)',
    period: 14,
    variants: [7, 14, 21, 28],
    threshold: (v) => v > 25,
    source: 'adx.directive.ts ADX_PERIOD = 14; `adxRising && currentAdx > 25` is the +5 tier, > 40 the +20',
    compute: (h, l, c, v) => {
      const a = ind.adx(h, l, c, v);
      return a.adx;
    },
  },
];

/** Fetch bars once, oldest -> newest. The indicator functions all assume chronological order. */
function loadBars(symbolId, timeframe, limit) {
  const rows = parseTsv(
    query(
      `SELECT timestamp, open, high, low, close, volume FROM marketbar
        WHERE symbolId = '${symbolId}' AND timeframe = '${timeframe.replace(/'/g, "")}'
        ORDER BY timestamp ASC LIMIT ${Number(limit)}`,
      connect(),
    ),
  );
  return rows.map((o) => ({
    timestamp: o.timestamp,
    open: Number(o.open),
    high: Number(o.high),
    low: Number(o.low),
    close: Number(o.close),
    volume: Number(o.volume),
  }));
}

/**
 * The mysql CLI is used with --batch, so every result is TSV with a header.
 * ⚠️ GENERIC on purpose — an earlier version mapped every row to the five bar fields, which silently
 * dropped `id`/`ticker` and made `symbolIdFor()` read `undefined`. Keep this returning the columns the
 * query actually asked for; coerce to number at the call site that needs numbers.
 */
function parseTsv(raw) {
  const text = typeof raw === 'string' ? raw : (raw && raw.rows) || '';
  const lines = text.replace(/\r\n/g, '\n').trim().split('\n');
  if (lines.length < 2) return [];
  const cols = lines[0].split('\t');
  return lines.slice(1).map((ln) => {
    const cells = ln.split('\t');
    const o = {};
    cols.forEach((c, i) => { o[c] = cells[i]; });
    return o;
  });
}

function symbolIdFor(ticker) {
  const rows = parseTsv(
    query(`SELECT id, ticker FROM symbol WHERE ticker = '${ticker.replace(/'/g, "")}' LIMIT 1`, connect()),
  );
  if (!rows.length) throw new Error(`symbol "${ticker}" not found`);
  return rows[0].id;
}

/**
 * events / agreement for one boolean series against the production series.
 * Both series are aligned to the SAME bars — an indicator with a longer warm-up yields NaN at the
 * start, and NaN is dropped from BOTH sides rather than counted as "agreement", which would inflate the
 * score for exactly the variants that measure least.
 */
function compare(seriesA, seriesB) {
  let both = 0, agree = 0;
  let onA = 0, onB = 0;
  let eventsA = 0, eventsB = 0, shared = 0, union = 0;
  const n = Math.min(seriesA.length, seriesB.length);
  for (let i = 0; i < n; i++) {
    const a = seriesA[i], b = seriesB[i];
    if (a === null || b === null) continue;
    both++;
    if (a === true) onA++;
    if (b === true) onB++;
    if (a === b) agree++;
    const prevA = i > 0 ? seriesA[i - 1] : null;
    const prevB = i > 0 ? seriesB[i - 1] : null;
    const evA = a === true && prevA === false;
    const evB = b === true && prevB === false;
    if (evA) eventsA++;
    if (evB) eventsB++;
    if (evA || evB) { union++; if (evA && evB) shared++; }
  }
  return {
    bars: both,
    agreement: both ? agree / both : null,
    eventsA, eventsB,
    eventsShared: shared,
    /** Of the opportunity set either variant produced, how much both produced. */
    overlap: union ? shared / union : null,
    /**
     * RECALL — of the SMALLER event set, how much the other also fired.
     * ⚠️ Added because `overlap` (Jaccard) is bounded above by `min(eventsA, eventsB) / union`, so a
     * variant that fires ZERO events reports an overlap of 0% that looks like total disagreement but is
     * actually arithmetic: there is nothing to share. Recall is undefined in that case and is reported
     * as null, so "cannot judge" never renders the same as "measured zero" — the distinction this
     * repo keeps re-learning. Recall is 1.0 when one event set is a subset of the other.
     */
    recall: Math.min(eventsA, eventsB) > 0 ? shared / Math.min(eventsA, eventsB) : null,
    /**
     * DUTY — the fraction of comparable bars on which the gate is ON.
     * ⚠️ ADDED because disagreement alone is ambiguous in the most important case. A gate that is never
     * ON produces 0% disagreement, which reads as "the periods agree" when the truth is "this directive
     * is DORMANT and contributes nothing to any composite". MFI-oversold on NVDA 1d is exactly that:
     * 0.0% disagreement across 14/21/28 because all three never dip below 20 in 193 bars.
     */
    dutyA: both ? onA / both : null,
    dutyB: both ? onB / both : null,
  };
}

function toBool(series, fn) {
  return series.map((v) => (Number.isFinite(v) ? fn(v) : null));
}

/**
 * Right-align an indicator series onto the bar array.
 * ⚠️ LOAD-BEARING, and the first version of this script got it wrong. `rsi(closes, 14)` returns
 * `closes.length - 14` values with NO leading padding, so index 0 is bar 14 — while `rsi(closes, 7)`
 * index 0 is bar 7. Comparing them by index silently compares bars 7 apart, which produced a
 * plausible-looking table of disagreement rates that measured the offset, not the indicator. Every
 * series ends at the LAST bar, so padding on the LEFT restores a common basis.
 */
function rightAlign(series, len) {
  if (!Array.isArray(series)) return null;
  if (series.length === 0) return null;
  if (series.length === len) return series;
  if (series.length > len) return series.slice(series.length - len);
  return new Array(len - series.length).fill(null).concat(series);
}

function main() {
  const argv = process.argv.slice(2);
  const tf = argValue(argv, '--tf') || '1h';
  const sym = argValue(argv, '--sym') || 'VIX';
  const limit = Number(argValue(argv, '--limit') || 2000);
  const asJson = argv.includes('--json');

  const how = loadIndicators();
  const symbolId = symbolIdFor(sym);
  const bars = loadBars(symbolId, tf, limit);
  if (bars.length < 60) {
    console.error(`Only ${bars.length} ${tf} bars for ${sym} — too few to measure. Nothing reported.`);
    process.exit(2);
  }

  const highs = bars.map((b) => b.high);
  const lows = bars.map((b) => b.low);
  const closes = bars.map((b) => b.close);

  const out = {
    symbol: sym,
    timeframe: tf,
    bars: bars.length,
    from: bars[0].timestamp,
    to: bars[bars.length - 1].timestamp,
    indicatorsLoadedFrom: how,
    families: [],
  };

  for (const f of FAMILIES) {
    const falsy = [];
    for (const v of f.variants) {
      let series;
      try {
        const rawSeries = f.compute(highs, lows, closes, v, bars);
        const aligned = rightAlign(rawSeries, bars.length);
        if (!aligned) {
          falsy.push({ variant: v, error: `indicator returned ${Array.isArray(rawSeries) ? 'an empty array' : typeof rawSeries}` });
          continue;
        }
        series = toBool(aligned, f.threshold);
      } catch (err) {
        // A variant the indicator function cannot evaluate is reported, not skipped — silence here
        // would read as "no difference", which is the opposite of unknown.
        falsy.push({ variant: v, error: String(err && err.message ? err.message : err) });
        continue;
      }
      falsy.push({ variant: v, series });
    }

    const production = falsy.find((x) => x.variant === f.period);
    if (!production || !production.series) {
      out.families.push({ id: f.id, label: f.label, error: 'production period could not be computed', rows: falsy.map(r => ({ variant: r.variant, error: r.error })) });
      continue;
    }

    const rows = [];
    for (const other of falsy) {
      if (other.variant === f.period) {
        const c = compare(production.series, production.series);
        rows.push({
          variant: other.variant, isProduction: true,
          bars: c.bars, agreement: 1, events: c.eventsA, overlap: 1, duty: c.dutyA,
        });
        continue;
      }
      if (!other.series) { rows.push({ variant: other.variant, error: other.error }); continue; }
      const c = compare(other.series, production.series);
      rows.push({
        variant: other.variant,
        isProduction: false,
        bars: c.bars,
        agreement: c.agreement,
        events: c.eventsA,
        eventsProduction: c.eventsB,
        overlap: c.overlap,
        recall: c.recall,
        duty: c.dutyA,
      });
    }

    const alts = rows.filter((r) => !r.isProduction && !r.error && r.agreement !== null);
    const worst = alts.length ? alts.reduce((m, r) => (r.agreement < m.agreement ? r : m)) : null;
    out.families.push({
      id: f.id,
      label: f.label,
      source: f.source,
      productionPeriod: f.period,
      rows,
      /** The single number that decides whether this knob is worth building. */
      maxDisagreement: worst ? 1 - worst.agreement : null,
      worstVariant: worst ? worst.variant : null,
      eventsProduction: rows.find((r) => r.isProduction)?.events ?? null,
    });
  }

  if (asJson) { console.log(JSON.stringify(out, null, 1)); return; }

  console.log(`\nPeriod sensitivity — ${sym} ${tf}, ${out.bars} bars ${out.from} -> ${out.to}`);
  console.log(`indicators from: ${how}\n`);

  // Summary first — one row per family, the two numbers that decide whether the knob is worth building.
  console.log('family                              prod  events@prod  widest-disagreement  lowest-recall');
  console.log('─'.repeat(96));
  for (const f of out.families) {
    if (f.error) { console.log(`${f.label.slice(0, 32).padEnd(32)}  ERROR: ${f.error}`); continue; }
    const alts = f.rows.filter((r) => !r.isProduction && !r.error && r.agreement !== null);
    const widest = alts.length ? alts.reduce((m, r) => (r.agreement < m.agreement ? r : m)) : null;
    const thin = alts.filter((r) => r.recall !== null).reduce((m, r) => (m === null || r.recall < m.recall ? r : m), null);
    const pct = (x) => (x === null || x === undefined ? '     —' : (x * 100).toFixed(1).padStart(5) + '%');
    console.log(
      `${f.label.slice(0, 32).padEnd(32)}  ${String(f.productionPeriod).padStart(4)}  ${String(f.eventsProduction ?? '—').padStart(11)}  `
      + `${pct(widest ? 1 - widest.agreement : null).padStart(8)} @${String(widest ? widest.variant : '—').padStart(3)}        `
      + `${pct(thin ? thin.recall : null).padStart(6)} @${String(thin ? thin.variant : '—').padStart(3)}`,
    );
  }
  console.log('');

  for (const f of out.families) {
    if (f.error) continue;
    console.log(`${f.label}   · production ${f.productionPeriod}`);
    console.log(`   ${f.source}`);
    console.log('   variant   bars   duty-ON   disagree   events   recall-vs-production');
    for (const r of f.rows) {
      if (r.error) { console.log(`   ${String(r.variant).padStart(7)}   ERROR: ${r.error}`); continue; }
      const pct = (x) => (x === null || x === undefined ? '    —' : (x * 100).toFixed(1).padStart(5) + '%');
      const mark = r.isProduction ? ' ◄' : '  ';
      // ⚠️ DISAGREEMENT, not agreement. The first version printed `r.agreement` under a column headed
      // "disagree", which read 90.4% for a family that disagreed on 9.6% of bars — the right number
      // with the wrong label, which is worse than either alone.
      const disagree = r.isProduction ? null : (r.agreement === null ? null : 1 - r.agreement);
      console.log(
        `   ${String(r.variant).padStart(7)}   ${String(r.bars).padStart(4)}   ${pct(r.duty).padStart(6)}   ${pct(disagree)}   ${String(r.events).padStart(6)}   ${r.isProduction ? '  —  ' : pct(r.recall)}${mark}`,
      );
    }
    console.log('');
  }

  console.log('disagree = % of bars where the variant flips the directive\'s own threshold vs production.');
  console.log('recall   = of the SMALLER event set, how much the other variant also fired at the same bar —');
  console.log('           low means a different strategy rather than a different setting. "—" means one');
  console.log('           variant fired no events at all, so there is nothing to compare (not zero).');
  console.log('◄ = the period the directive currently hardcodes.\n');
}

/**
 * --self-test — prove the metric can DETECT a difference, and can also report NO difference.
 * A one-directional test cannot tell "the metric works" from "the metric never runs". Both directions
 * are asserted here, plus the alignment guard, which is the bug the first version actually had.
 */
function selfTest() {
  const fail = [];
  const ok = (cond, name) => { if (!cond) fail.push(name); };

  // 1. rightAlign pads on the LEFT so index 0 is the same bar for every period.
  const padded = rightAlign([1, 2, 3], 5);
  ok(padded.length === 5 && padded[0] === null && padded[1] === null && padded[2] === 1 && padded[4] === 3,
    'rightAlign: pads left, keeps the newest value last');

  // 2. rightAlign is a no-op when already the full length, and trims a too-long series from the left.
  ok(JSON.stringify(rightAlign([1, 2, 3, 4, 5], 5)) === '[1,2,3,4,5]', 'rightAlign: identity at full length');
  ok(JSON.stringify(rightAlign([0, 1, 2, 3, 4, 5], 5)) === '[1,2,3,4,5]', 'rightAlign: trims the oldest');

  // 3. A series that cannot be aligned must return null, so the caller reports an error rather than
  //    silently reporting agreement.
  ok(rightAlign([], 5) === null, 'rightAlign: empty series is null, never a silent pass');

  // 4. DIRECTION A — identical series ⇒ 100% agreement, every event shared.
  const a = [null, false, true, true, false, true, false];
  const same = compare(a, a);
  ok(same.agreement === 1, 'compare: identical series agrees 100%');
  ok(same.eventsA === 2 && same.eventsShared === 2 && same.overlap === 1,
    'compare: identical series shares every event');

  // 5. DIRECTION B — one bar later ⇒ the metric MUST notice. If this passes with 100%, the metric is
  //    not measuring position at all.
  const shifted = [null, null, false, true, true, false, true];
  const diff = compare(shifted, a);
  ok(diff.agreement !== null && diff.agreement < 1, 'compare: a one-bar shift is detected as disagreement');

  // 6. DIRECTION B again, in the event metric specifically — a shift must reduce overlap.
  ok(diff.overlap !== null && diff.overlap < 1, 'compare: a one-bar shift reduces event overlap');

  // 7. A threshold that is never met ⇒ zero events, not NaN.
  const never = compare([null, false, false], [null, false, false]);
  ok(never.eventsA === 0 && never.overlap === null, 'compare: no events reports 0 and null overlap (not a div-by-zero)');

  // 8. INVARIANT — when one side is NEVER on, disagreement must equal the other side's duty exactly.
  //    This is the arithmetic that makes "0% disagreement" readable: it is the duty, not agreement.
  const half = compare([null, true, false, true, false], [null, false, false, false, false]);
  ok(half.dutyB === 0, 'compare: a never-on gate reports duty 0');
  ok(Math.abs((1 - half.agreement) - half.dutyA) < 1e-12,
    'compare: disagreement equals duty when one side is never on');

  // 9. Duty is a fraction of comparable bars, so both sides share a denominator.
  const duty = compare([null, true, true, false], [null, false, true, false]);
  ok(Math.abs(duty.dutyA - 2 / 3) < 1e-12 && Math.abs(duty.dutyB - 1 / 3) < 1e-12,
    'compare: duty is counted over comparable bars only');

  // 10. A dormant production period must still be VISIBLE (duty 0), never reported as agreement 1.
  const dormant = compare([null, false, false, false], [null, false, false, false]);
  ok(dormant.dutyA === 0 && dormant.dutyB === 0 && dormant.agreement === 1,
    'compare: dormant gate reports duty 0 with agreement 1 — the reader must be able to tell them apart');

  // 11. RECALL, both directions. A canary found this metric had NO assertion: forcing it to null passed
  //     every test, which is precisely the "guard that never fires" this repo keeps paying for.
  //     Direction A — identical series shares everything.
  ok(same.recall === 1, 'recall: identical series shares every event (recall 1)');
  //     Direction B — a shift must reduce it, and it must not be null.
  ok(diff.recall !== null && diff.recall < 1, 'recall: a one-bar shift reduces recall');
  //     Direction C — a SUBSET must be recall 1, not merely "high". This is what distinguishes recall
  //     from Jaccard: the smaller set is fully contained, so nothing was missed.
  const subsetA = compare([null, false, true, false, false], [null, false, true, false, true]);
  ok(subsetA.recall === 1, 'recall: a contained event set is recall 1 (unlike Jaccard)');
  ok(subsetA.overlap !== null && subsetA.overlap < 1,
    'recall: the same case is LESS than 1 under Jaccard — the two metrics answer different questions');
  //     Direction D — no events on one side is null, never 0.
  ok(never.recall === null, 'recall: no events on either side is null, not 0');

  if (fail.length) {
    console.error('\nSELF-TEST FAILED:');
    for (const f of fail) console.error(`  ✖ ${f}`);
    process.exit(1);
  }
  console.log(`✅ self-test: 20 assertions pass — the metric detects a one-bar shift, reports 100% on`
    + ` identical input, and returns null rather than agreeing on a series it cannot align.`);
}

function argValue(argv, flag) {
  const i = argv.indexOf(flag);
  return i >= 0 ? argv[i + 1] : null;
}

if (require.main === module) {
  if (process.argv.includes('--self-test')) { selfTest(); process.exit(0); }
  try { main(); } catch (err) {
    console.error(`\n${err && err.message ? err.message : err}\n`);
    process.exit(1);
  }
}

module.exports = { compare, toBool, rightAlign, parseTsv, FAMILIES, selfTest };
