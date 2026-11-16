#!/usr/bin/env node
/**
 * validate-chart-api.cjs — a v4 chart call is a page that fails to render
 * =========================================================================
 * THE DEFECT THIS CLOSES (#1135 item 4, measured 2026-10-22 and re-measured 2026-11-16).
 * `lightweight-charts` is **5.2.0**. v5 removed the per-type `add*Series()` helpers, replacing them
 * with `addSeries(Type, opts)`. `BacktestChart` was calling `chart.addLineSeries(...)`, which threw
 * `addLineSeries is not a function` and took the whole Backtest Lab down — a page-killing defect that
 * no test caught, because the call is only reachable from a browser effect.
 *
 * Three more sites carried the same class (`SymbolDetailPage`, `CandlePatternChart`,
 * `PatternScannerPage`, plus a fourth found in `RsiDivergenceChart`), and all are now migrated. This
 * check exists so the next one cannot land: the failure mode is a *blank page*, not a build error, so
 * nothing else in `prebuild` would ever see it.
 *
 * ── WHAT IS CHECKED, AND WHAT IS DELIBERATELY NOT ────────────────────────────────────────────────
 *
 *   CHECKED — `chart.addCandlestickSeries(...)`, `addLineSeries`, `addHistogramSeries`,
 *   `addAreaSeries`, `addBarSeries`. These are unambiguous: v5 has no such method on any object, so a
 *   match is always a defect. Comments and strings are stripped first, because this repo's migration
 *   notes QUOTE the old calls and must not be reported as live code (they are the reason the pattern
 *   is documented at each site).
 *
 *   ⚠️ NOT CHECKED — `.setMarkers(`. It was on the original list and it is NOT a reliable signal:
 *   v5 replaced `series.setMarkers(markers)` with `createSeriesMarkers(series, markers)`, and the object
 *   THAT returns still has a `setMarkers` method. `CandlePatternChart.jsx` legitimately calls
 *   `markersRef.current.setMarkers(markers)`. A guard on `.setMarkers(` would fire on correct code,
 *   get allowlisted within a week, and then cover nothing — "narrow beats broad". Telling the two apart
 *   needs the receiver's type, which a text scan does not have.
 *
 *   node scripts/validate-chart-api.cjs              # the prebuild form
 *   node scripts/validate-chart-api.cjs --self-test  # prove both directions
 */
const fs = require('node:fs');
const path = require('node:path');
// ⚠️ SHARED, NOT LOCAL. `validate-chart-api.cjs` hand-rolled the same comment/string blanker and
// `validate-duplication.cjs` failed the build on the pair — extract, never bank.
const { blankComments, walkFiles } = require('./lib/validator-helpers.cjs');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'src');

/** v4-only per-type helpers. `addSeries(` is the v5 form and must never match. */
const V4_CALL = /\.\s*add(Candlestick|Line|Histogram|Area|Bar)Series\s*\(/g;

/**
 * Remove line and block comments and string literals so a migration note that QUOTES a removed call
 * cannot be reported as live code. Newlines are preserved so line numbers stay true.
 */
/** @returns {Array<{line: number, text: string}>} */
function findV4Calls(code) {
  const clean = blankComments(code, { blankStrings: true });
  const hits = [];
  const lines = clean.split('\n');
  for (let n = 0; n < lines.length; n++) {
    V4_CALL.lastIndex = 0;
    if (V4_CALL.test(lines[n])) {
      hits.push({ line: n + 1, text: lines[n].trim().slice(0, 90) });
    }
  }
  return hits;
}

function check() {
  const files = walkFiles(SRC, /\.(js|jsx|ts|tsx)$/);
  if (files.length === 0) {
    console.error('✖ No source files found under src/ — CANNOT JUDGE.');
    process.exit(2);
  }
  let bad = 0;
  for (const f of files) {
    const hits = findV4Calls(fs.readFileSync(f, 'utf8'));
    if (!hits.length) continue;
    bad += hits.length;
    console.error(`\n✖ ${path.relative(ROOT, f)}`);
    for (const h of hits) console.error(`    L${h.line}: ${h.text}`);
  }
  if (bad === 0) {
    console.log(`✅ ${files.length} source files contain no v4 per-type series call.`);
    return 0;
  }
  console.error(
    `\n✖ ${bad} v4 chart call(s). \`lightweight-charts\` is v5 — these THROW at runtime and take the\n` +
      '  whole page down, with no build error. Migrate to:\n' +
      '\n    chart.addCandlestickSeries(opts)  ->  chart.addSeries(CandlestickSeries, opts)\n' +
      '    chart.addLineSeries(opts)         ->  chart.addSeries(LineSeries, opts)\n' +
      '    chart.addHistogramSeries(opts)    ->  chart.addSeries(HistogramSeries, opts)\n'
  );
  return 1;
}

function selfTest() {
  const cases = [
    // ── must PASS ────────────────────────────────────────────────────────────────────────────
    { name: 'v5 addSeries form', code: 'chart.addSeries(CandlestickSeries, {});', expect: 0 },
    { name: 'a v4 call inside a LINE comment (migration notes quote them)', code: '// was chart.addLineSeries(opts)\nchart.addSeries(LineSeries, {});', expect: 0 },
    { name: 'a v4 call inside a BLOCK comment', code: '/* chart.addCandlestickSeries({}) */\nchart.addSeries(CandlestickSeries, {});', expect: 0 },
    { name: 'a v4 call inside a STRING literal', code: "const note = 'chart.addLineSeries(opts)';\n", expect: 0 },
    { name: 'valid v5 marker plugin handle (NOT checked — receiver ambiguity)', code: 'markersRef.current.setMarkers(markers);', expect: 0 },
    { name: 'createSeriesMarkers is not confused with setMarkers', code: 'markersRef.current = createSeriesMarkers(series, markers);', expect: 0 },

    // ── must FAIL ────────────────────────────────────────────────────────────────────────────
    { name: 'addCandlestickSeries', code: 'chart.addCandlestickSeries({ upColor: "x" });', expect: 1 },
    { name: 'addLineSeries', code: 'const s = chart.addLineSeries({ color: "x" });', expect: 1 },
    { name: 'addHistogramSeries', code: 'chart.addHistogramSeries({});', expect: 1 },
    { name: 'addAreaSeries', code: 'chart.addAreaSeries({});', expect: 1 },
    { name: 'addBarSeries with whitespace', code: 'chart . addBarSeries ( { } );', expect: 1 },
    { name: 'a real v4 call AFTER a block comment on the same line', code: '/* ok */ chart.addLineSeries({});', expect: 1 },
  ];

  let failed = 0;
  for (const c of cases) {
    const got = findV4Calls(c.code).length;
    if (got === c.expect) {
      console.log(`  ✅ ${c.name} → ${got} match(es)`);
    } else {
      failed++;
      console.log(`  ✖ ${c.name}`);
      console.log(`      expected ${c.expect}, got ${got}`);
    }
  }
  // The real tree must be clean too — otherwise the guard is red before anyone touches anything.
  const live = walkFiles(SRC, /\.(js|jsx|ts|tsx)$/).reduce((n, f) => n + findV4Calls(fs.readFileSync(f, 'utf8')).length, 0);
  if (live !== 0) {
    failed++;
    console.log(`  ✖ live tree already has ${live} v4 call(s) — the guard would be red at baseline`);
  } else {
    console.log('  ✅ live tree is clean');
  }
  console.log(`\n${cases.length + 1 - failed}/${cases.length + 1} self-test cases behaved correctly`);
  return failed === 0 ? 0 : 1;
}

const arg = process.argv[2];
if (arg === '--self-test') {
  console.log('validate-chart-api — self-test\n');
  process.exit(selfTest());
} else if (arg === '--help' || arg === '-h') {
  console.log('usage: node scripts/validate-chart-api.cjs [--self-test] [--help]');
  process.exit(0);
} else if (arg && arg !== '--check') {
  console.error(`✖ Unknown argument: ${arg}`);
  console.error('usage: node scripts/validate-chart-api.cjs [--self-test] [--help]');
  process.exit(2);
} else {
  process.exit(check());
}
