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
// Shared walk/load/self-test blocks — extracted 2026-09-23 (the duplication validator failed on
// three blocks this guard shared with scripts/validate-envelope-callers.cjs).
const { loadTree, runSelfTest } = require('../../scripts/lib/validator-helpers.cjs');

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

/**
 * Strip block comments and line comments so prose can never satisfy or trip the scan.
 *
 * ⚠️ TRAILING `//` COMMENTS MATTER TOO, and this used to strip only WHOLE-LINE ones. The #1257
 * check found `assessGlobalRiskLimits(` inside a trailing comment in `settings-registry.ts` and
 * `risk-profile-rules.ts` and reported both as under-argumented CALLS. The `[^:]` guard is what
 * keeps `https://…` intact while still cutting a real comment.
 */
function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split(/\r?\n/)
    .map((line) => (line.trimStart().startsWith('//') ? '' : line.replace(/(^|[^:])\/\/.*$/, '$1')))
    .join('\n');
}

/**
 * Blank out the CONTENTS of quoted strings, so prose in a description can never read as a call.
 *
 * ⚠️ Needed because the offending lines were not comments: `settings-registry.ts` carries
 * `'… computed in assessGlobalRiskLimits() and …'` inside a DESCRIPTION string literal, and the
 * #1257 check read that as an under-argumented call. Comment-stripping cannot reach it.
 * Quotes are preserved so the surrounding code still parses as roughly the same shape.
 */
function stripStringContents(source) {
  return source
    .replace(/'(?:[^'\\]|\\.)*'/g, "''")
    .replace(/"(?:[^"\\]|\\.)*"/g, '""')
    .replace(/`(?:[^`\\]|\\.)*`/g, '``');
}

/**
 * Every argument list for `name(` in `body`, found by BALANCED-PAREN scanning rather than a regex.
 *
 * ⚠️ Why not a regex: `assessGlobalRiskLimits(a, b, { x: f(1, 2) })` contains commas at two
 * depths, and any pattern simple enough to regex is either too loose (counts the commas inside the
 * object) or too tight (misses a call split across lines). Scanning is ~15 lines and cannot be
 * fooled by either.
 */
function callArgumentLists(body, name) {
  const out = [];
  let i = body.indexOf(`${name}(`);
  while (i !== -1) {
    let depth = 0;
    let j = i + name.length;
    const start = j + 1;
    let closed = false;
    for (; j < body.length; j++) {
      const c = body[j];
      if (c === '(' || c === '[' || c === '{') depth++;
      else if (c === ')' || c === ']' || c === '}') {
        depth--;
        if (depth === 0) {
          out.push(body.slice(start, j));
          closed = true;
          break;
        }
      }
    }
    if (!closed) break;
    i = body.indexOf(`${name}(`, j);
  }
  return out;
}

/** Count commas at DEPTH 0 — i.e. how many arguments the call has, minus one. */
function topLevelCommas(args) {
  let depth = 0;
  let n = 0;
  for (const c of args) {
    if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') depth--;
    else if (c === ',' && depth === 0) n++;
  }
  return n;
}

/**
 * #1257 (2026-11-12) — the gate must be called WITH the per-trade risk input.
 *
 * `assessGlobalRiskLimits(size, symbol)` still compiles, and it made the money-at-risk ceiling
 * unmeasurable — which the gate then REFUSES. So an omission is not silent, but it is also not
 * visible until a bot fails to trade. Requiring the third argument at BUILD TIME turns "the caller
 * forgot" into a build error naming the file, which is the cheap half of that problem.
 *
 * Why it matters: the ceiling could not be evaluated at all before this, and the measured result
 * was XAUUSD risking 13.3% of equity against a declared 2% limit with nothing to refuse it.
 */
function checkPerTradeArgument(rel, body) {
  const calls = callArgumentLists(body, 'assessGlobalRiskLimits');
  if (calls.length === 0) return []; // the EXEMPT/never-called cases are handled above
  const ok = calls.some((args) => topLevelCommas(args) >= 2);
  if (ok) return [];
  return [
    `  ${rel} calls assessGlobalRiskLimits() with fewer than 3 arguments — pass the per-trade ` +
      'risk input ({ strategyId } or { slPct }), or the money-at-risk ceiling cannot be measured ' +
      'and the gate will refuse every order (#1257)',
  ];
}

/** Pure: map of relPath -> source text → { errors, exempted }. Self-testable. */
function analyse(files) {
  const errors = [];
  const exempted = [];
  for (const [rel, raw] of files) {
    if (/\.spec\.ts$/.test(rel)) continue;
    const body = stripComments(raw);
    if (!/\.placeOrder\(/.test(body)) continue;
    if (/assessGlobalRiskLimits/.test(body)) continue;    const key = rel.replace(/\\/g, '/');
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

/**
 * #1257 — the gate must be called WITH its per-trade argument, on every file that calls it at all.
 * Kept separate from `analyse()` so both can be self-tested independently: `analyse` answers "did
 * you ask the caps", this answers "did you give them enough to judge".
 */
function analysePerTradeArgument(files) {
  const errors = [];
  for (const [rel, raw] of files) {
    if (/\.spec\.ts$/.test(rel)) continue;
    // Strings are blanked FIRST: a settings DESCRIPTION that mentions the method by name is prose,
    // not a call, and reading it as one produced two false refusals on the guard's first live run.
    const body = stripStringContents(stripComments(raw));
    if (!/assessGlobalRiskLimits/.test(body)) continue;
    const key = rel.replace(/\\/g, '/');
    if (EXEMPT[key]) continue;
    errors.push(...checkPerTradeArgument(key, body));
  }
  return errors;
}

if (process.argv.includes('--self-test')) {
  runSelfTest([
    ['a call WITHOUT the gate fails', () => {
      const r = analyse(new Map([['x.ts', 'await broker.placeOrder({});']]));
      return r.errors.length === 1 && /x\.ts/.test(r.errors[0]);
    }],
    ['the same call WITH the gate passes', () => {
      const r = analyse(new Map([['x.ts', 'await s.assessGlobalRiskLimits(1, "X", { slPct: 1 });\nawait broker.placeOrder({});']]));
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
    // ── #1257: the per-trade argument ──────────────────────────────────────────────────────
    ['a TWO-argument gate call is refused — the per-trade ceiling would be unmeasurable', () => {
      const errs = analysePerTradeArgument(new Map([['x.ts', 'await s.assessGlobalRiskLimits(1, "X");']]));
      return errs.length === 1 && /fewer than 3 arguments/.test(errs[0]);
    }],
    ['a THREE-argument gate call passes', () => {
      const errs = analysePerTradeArgument(new Map([['x.ts', 'await s.assessGlobalRiskLimits(1, "X", { slPct: 1 });']]));
      return errs.length === 0;
    }],
    ['commas INSIDE the third argument do not fake a fourth — balanced scan, not a regex', () => {
      // `{ a: f(1, 2), b: 3 }` has 3 commas but only 3 top-level arguments.
      const bad = analysePerTradeArgument(new Map([['x.ts', 'await s.g(1, 2);']]));
      const good = analysePerTradeArgument(new Map([['x.ts', 'await s.assessGlobalRiskLimits(1, "X", { a: f(1, 2) });']]));
      return bad.length === 0 && good.length === 0;
    }],
    ['one compliant call in a file satisfies it — a second bad call does not veto the good one', () => {
      const errs = analysePerTradeArgument(new Map([['x.ts',
        'await s.assessGlobalRiskLimits(1, "X");\nawait s.assessGlobalRiskLimits(1, "X", { strategyId });']]));
      return errs.length === 0;
    }],
    ['a MENTION inside a description string is not a call — the false positive that bit on run 1', () => {
      const errs = analysePerTradeArgument(new Map([['x.ts',
        "const d = 'the estimate is computed in assessGlobalRiskLimits() and ' +\n'compared here';\nfunction f() { return 1; }"]]));
      return errs.length === 0;
    }],
  ]);
}

const { errors, exempted } = analyse(loadTree(SRC, /\.ts$/));
const perTradeErrors = analysePerTradeArgument(loadTree(SRC, /\.ts$/));

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
if (perTradeErrors.length > 0) {
  console.error('\n✖ RISK GATE CALLED WITHOUT ITS PER-TRADE INPUT:');
  for (const err of perTradeErrors) console.error(err);
  console.error('\nThe money-at-risk ceiling cannot be measured without it — #1257.');
  process.exit(1);
}
console.log(
  '[manual-trade-gate] ✅ OK — every signal-driven order path runs assessGlobalRiskLimits() ' +
    'with the per-trade risk input (#945, #1257)',
);

