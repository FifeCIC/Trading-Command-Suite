#!/usr/bin/env node
/**
 * validate-directive-reason-labels.cjs — a directive's REASON must not name a number it no longer uses.
 * =======================================================================================================
 * WHY THIS EXISTS — measured 2026-11-02, on live data, and it cost a wrong diagnosis.
 *
 * `rsi-oversold` was parameterised (#1165) so the period comes from `resolveParams()`, and its reason
 * was left reading `RSI(14)` as literal text. A per-entry `rsiPeriod: 30` was stored and HONOURED — the
 * RSI value changed from 39.1 to 41.6, the base from 39 to 36 — but every diagnostic screen still said
 * `RSI(14)`. Investigating "the parameter is not reaching scoring" therefore went to the params plumbing
 * first, which was already correct; the defect was in the sentence being read.
 *
 * A reason string is the ONLY thing an operator sees about a directive's internals. A diagnostic that
 * names the wrong number is worse than no diagnostic, because it is believed. This is the repo's
 * signature failure — plausible output, no error — applied to text instead of arithmetic.
 *
 * SCOPE — deliberately narrow, because a guard that fires on correct code gets allowlisted:
 *   · only files that declare `const PARAMS`
 *   · only RUNTIME strings (`reason:`, `reasons.push(`, `parts.push(`, `detail`)
 *   · only indicator names that carry a PERIOD (RSI, SMA, EMA, ATR, ADX, CCI, MFI, BB, WMA)
 *   · a LITERAL number — an interpolated `${period}` is correct and never matches
 * Doc comments, `name` and `description` are NOT checked: they describe the class and its default, and
 * they do not sit beside a number that claims to be this tick's.
 *
 * REGISTER: docs/SETTLED-DECISIONS.md row 125 · ISSUE: #1180
 *
 *   node nest/scripts/validate-directive-reason-labels.cjs             # report, exit 1 on findings
 *   node nest/scripts/validate-directive-reason-labels.cjs --self-test # prove the guard can fail
 */
const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '..', 'src', 'modules', 'directives', 'implementations');
const TAG = 'directive-reason-labels';

/** Indicator names whose parentheses contain a PERIOD. Anything else is a value, not a period. */
const INDICATORS = ['RSI', 'SMA', 'EMA', 'ATR', 'ADX', 'CCI', 'MFI', 'BB', 'WMA'];
const RUNTIME = /reason:|reasons\.push|parts\.push|detail/i;

/**
 * Find literal periods named inside a runtime string.
 * @param {string} src  file contents
 * @returns {Array<{line:number,label:string,value:string,text:string}>}
 */
function findLiteralLabels(src) {
  const out = [];
  const lines = src.split(/\r?\n/);
  const re = new RegExp(`\\b(${INDICATORS.join('|')})\\((\\d+(?:\\.\\d+)?)\\)`, 'g');
  lines.forEach((line, i) => {
    if (!RUNTIME.test(line)) return;
    for (const m of line.matchAll(re)) {
      out.push({ line: i + 1, label: m[1], value: m[2], text: line.trim().slice(0, 120) });
    }
  });
  return out;
}

function scan(dir) {
  const findings = [];
  let scanned = 0;
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.directive.ts'))) {
    const src = fs.readFileSync(path.join(dir, f), 'utf8');
    if (!/const PARAMS\s*:/.test(src)) continue; // not parameterised — a literal is a fact there
    scanned++;
    for (const hit of findLiteralLabels(src)) findings.push({ file: f, ...hit });
  }
  return { findings, scanned };
}

function selfTest() {
  const checks = [];
  const ok = (name, pass) => checks.push({ name, pass: !!pass });

  // Direction 1 — a parameterised directive whose reason hardcodes a period MUST be caught.
  const bad = [
    "const PARAMS: readonly NumericParamSpec[] = [];",
    'const rsiValues = rsi(closes, rsiPeriod);',
    'reason: `RSI(14)=${currentRsi.toFixed(1)}: base=39`,',
  ].join('\n');
  const badHits = findLiteralLabels(bad);
  ok('catches a hardcoded RSI(14) in a reason', badHits.length === 1 && badHits[0].label === 'RSI');

  // Direction 2 — the CORRECT form must be silent, or the guard would fire on every fixed directive.
  const good = [
    'const PARAMS: readonly NumericParamSpec[] = [];',
    'reason: `RSI(${rsiPeriod})=${currentRsi.toFixed(1)}`,',
  ].join('\n');
  ok('silent when the period is interpolated', findLiteralLabels(good).length === 0);

  // Direction 3 — a DOC COMMENT naming the default is not a claim about this tick. Flagging it would
  // make the guard fire on correct code, which is how a guard gets allowlisted.
  const docOnly = ['const PARAMS: readonly NumericParamSpec[] = [];', ' * Bullish when RSI(14) is low.'].join('\n');
  ok('silent on a doc comment', findLiteralLabels(docOnly).length === 0);

  // Direction 4 — several indicators, several literals: all reported, not just the first.
  const many = 'reason: `SMA(50) vs EMA(9) and ATR(14)`;';
  ok('reports every literal on the line', findLiteralLabels(many).length === 3);

  // Direction 5 — `.toFixed(2)` must NOT be read as an indicator call (the first version of this scan
  // counted 164 false positives this way, which is exactly an allowlisted-guard in the making).
  const fn = 'reason: `bandwidth ${currentBW.toFixed(2)}%`,';
  ok('a function call is not a period', findLiteralLabels(fn).length === 0);

  // Direction 6 — the real tree must contain parameterised directives, else the scan proves nothing.
  const live = scan(DIR);
  ok('scans a non-zero number of parameterised directives', live.scanned > 50);

  const failed = checks.filter((c) => !c.pass);
  for (const c of checks) console.log(`  ${c.pass ? '✓' : '✖'} ${c.name}`);
  if (failed.length) {
    console.error(`\n[${TAG}] ✖ self-test FAILED — ${failed.length} of ${checks.length}\n`);
    process.exit(1);
  }
  console.log(`\n[${TAG}] ✅ self-test PASSED — ${checks.length}/${checks.length} expectations\n`);
}

if (process.argv.includes('--self-test')) {
  selfTest();
} else {
  const { findings, scanned } = scan(DIR);
  if (!fs.existsSync(DIR)) {
    console.error(`[${TAG}] ✖ ${DIR} does not exist — nothing was scanned`);
    process.exit(1);
  }
  if (scanned === 0) {
    // A scan that inspects nothing must ERROR, never pass.
    console.error(`[${TAG}] ✖ found 0 parameterised directives in ${DIR}`);
    console.error('    → that is implausible; the detector is broken, not the code');
    process.exit(1);
  }
  if (findings.length === 0) {
    console.log(`[${TAG}] ✅ OK — ${scanned} parameterised directive(s), no hardcoded period in a reason`);
    process.exit(0);
  }
  console.error(`[${TAG}] ✖ ${findings.length} hardcoded period(s) named in a reason string:\n`);
  for (const f of findings) {
    console.error(`  ${f.file}:${f.line}  ${f.label}(${f.value})`);
    console.error(`      ${f.text}`);
  }
  console.error('\n  Interpolate the RESOLVED value instead, e.g. `RSI(${rsiPeriod})`.');
  console.error('  The number a directive reports must be the number it computed.\n');
  process.exit(1);
}
