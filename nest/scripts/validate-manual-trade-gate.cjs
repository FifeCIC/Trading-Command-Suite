#!/usr/bin/env node
/**
 * validate-manual-trade-gate.cjs — every ORDER-ORIGINATING path must run the portfolio risk gate.
 * =================================================================================================
 * WHY THIS EXISTS (#945, 2026-09-23)
 * ----------------------------------
 * `SignalActionsService` claimed — in its own header — to run "the SAME safety chain the bot
 * uses … never bypassing the risk controls", while `assessGlobalRiskLimits()` had **no caller
 * there at all**. Measured 2026-09-21: 0.1 lots of gold (23.6× the account balance) reached
 * `broker.placeOrder()` with all six portfolio caps unasked. No error; the output looked normal.
 *
 * The fix closes THAT instance. This guard closes the CLASS: a new file that calls
 * `.placeOrder(` without routing through `assessGlobalRiskLimits()` fails `prebuild`.
 *
 * SCOPE AND HONESTY
 * -----------------
 * · Comments are stripped before matching — `Mt5Adapter.placeOrder()` in a doc comment is not a
 *   call, and counting it would make the guard fire on prose.
 * · A small EXEMPT list names the files where a direct `placeOrder` is deliberate or pending,
 *   each with a reason. Exemptions are PRINTED on every run — an exemption nobody can see is a
 *   hole, not a decision (it is also how this repo loses findings).
 * · `--self-test` proves both directions on fixtures: a call without the gate FAILS, the same
 *   call with the gate passes, an exemption passes, and comment-only references never count.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'src');

/**
 * Where a direct `.placeOrder(` is tolerated WITHOUT the gate. Every entry states WHY.
 * ⚠️ Finding, not a clearance: three of these are real ungated order paths, named in #945's
 * close comment. They are exempt so the guard can hold the line for signal-driven trading TODAY
 * without silently blessing them — the print-out keeps them visible on every build.
 */
const EXEMPT = {
  'modules/automation/ab-test.service.ts':
    'A/B side dispatch — gate wiring scheduled with #929 (file mid-work by another agent)',
  'modules/trading/paper-trading.controller.ts':
    'paper trading — records a simulated fill; no broker order is placed',
  'modules/paper-trading/paper-trading.controller.ts':
    'paper trading — records a simulated fill; no broker order is placed',
  'modules/portfolio/trading212-portfolio.controller.ts':
    'T212 portfolio buy/sell — portfolio operations, not signal-driven trading',
  'modules/trading/trading212-portfolio.controller.ts':
    'T212 portfolio buy/sell — portfolio operations, not signal-driven trading',
  'modules/providers/mt5.controller.ts':
    'FINDING: raw MT5 order endpoint — NOT gated (named in #945 close)',
  'modules/trading/mt5.controller.ts':
    'FINDING: raw MT5 order endpoint — NOT gated (named in #945 close)',
  'modules/scoring/speed-scan.controller.ts':
    'FINDING: speed-scan direct order path — NOT gated (named in #945 close)',
  'modules/trading/mt5-trading.controller.ts':
    'controller passthrough to Mt5TradingService — the broker layer, not a signal path',
};

/** Strip block comments and full-line `//` comments so prose can never satisfy or trip the scan. */
function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split(/\r?\n/)
    .filter((line) => !/^\s*\/\//.test(line))
    .join('\n');
}

/** Pure: map of relPath -> source text → { errors, exempted }. Self-testable. */
function analyse(files) {
  const errors = [];
  const exempted = [];
  for (const [rel, raw] of files) {
    if (/\.spec\.ts$/.test(rel)) continue;
    const body = stripComments(raw);
    if (!/\.placeOrder\(/.test(body)) continue;
    if (/assessGlobalRiskLimits/.test(body)) continue;
    const key = rel.replace(/\\/g, '/');
    const reason = EXEMPT[key];
    if (reason) {
      exempted.push({ rel: key, reason });
      continue;
    }
    errors.push(
      `  ${key} calls .placeOrder() but never calls assessGlobalRiskLimits() — ` +
        'route it through the portfolio risk gate, or add an EXEMPT entry with a reason (#945)',
    );
  }
  return { errors, exempted };
}

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.ts$/.test(entry.name)) out.push(full);
  }
  return out;
}

function loadTree() {
  const files = new Map();
  for (const full of walk(SRC)) {
    const rel = path.relative(SRC, full);
    files.set(rel.split(path.sep).join('/'), fs.readFileSync(full, 'utf8'));
  }
  return files;
}

function selfTest() {
  const cases = [
    ['a call WITHOUT the gate fails', () => {
      const r = analyse(new Map([['x.ts', 'await broker.placeOrder({});']]));
      return r.errors.length === 1 && /x\.ts/.test(r.errors[0]);
    }],
    ['the same call WITH the gate passes', () => {
      const r = analyse(new Map([['x.ts', 'await s.assessGlobalRiskLimits(1, "X");\nawait broker.placeOrder({});']]));
      return r.errors.length === 0;
    }],
    ['a comment-only reference never counts', () => {
      const r = analyse(new Map([['y.ts', '// see Mt5Adapter.placeOrder()\n/* .placeOrder( */']]));
      return r.errors.length === 0 && r.exempted.length === 0;
    }],
    ['an EXEMPT file passes and is reported', () => {
      const r = analyse(new Map([['modules/trading/paper-trading.controller.ts', 'await p.placeOrder({});']]));
      return r.errors.length === 0 && r.exempted.length === 1;
    }],
    ['a spec file is never scanned', () => {
      const r = analyse(new Map([['x.spec.ts', 'await broker.placeOrder({});']]));
      return r.errors.length === 0;
    }],
  ];
  let fail = 0;
  for (const [name, fn] of cases) {
    let ok = false;
    try { ok = fn(); } catch { ok = false; }
    console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}`);
    if (!ok) fail++;
  }
  if (fail) { console.log(`\nSELFTEST FAILED — ${fail} case(s)`); process.exit(1); }
  console.log('\nSELFTEST PASSED — both directions proven on fixtures');
  process.exit(0);
}

if (process.argv.includes('--self-test')) selfTest();

const { errors, exempted } = analyse(loadTree());

console.log(`[manual-trade-gate] ${exempted.length} exempt path(s):`);
for (const e of exempted.sort((a, b) => a.rel.localeCompare(b.rel))) {
  console.log(`  · ${e.rel} — ${e.reason}`);
}

if (errors.length > 0) {
  console.error('\n✖ ORDER PATH(S) WITHOUT THE PORTFOLIO RISK GATE:');
  for (const err of errors) console.error(err);
  console.error('\nA path that can reach broker.placeOrder() must ask the caps first — #945.');
  process.exit(1);
}
console.log('[manual-trade-gate] ✅ OK — every signal-driven order path runs assessGlobalRiskLimits()');
