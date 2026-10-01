#!/usr/bin/env node
/**
 * validate-fabricated-stats.cjs — a performance STAT must be computed, never typed.
 *
 * ⚠️ WHY THIS EXISTS (#918, 2026-09-21)
 *
 * `strategy-competition.service.ts` served FIVE invented strategies — `{ winRate: 0.65,
 * totalTrades: 42 }` and four siblings — through `POST /api/scoring/compete`, whose only caller
 * passed an EMPTY signal array, and through an override `Map` that was always empty because
 * `updateStrategyStats()` had zero callers. A prior mock-data purge had CLAIMED this area was
 * cleaned; the literals survived because **nothing FAILED when they were added**. This script is
 * that failure.
 *
 * ⚠️ THE DEFECT IS NOT "A NUMBER IN A FILE". A non-zero `winRate` / `totalTrades` literal in
 * production source names a MEASUREMENT that traces to no query, no table and no trade — and it
 * renders in an API response exactly like a computed figure. Zero literals are allowed and exist
 * on purpose: `{ totalTrades: 0, winRate: 0 }` is an honest empty summary
 * (trading212-history.controller.ts, trading212-import.service.ts). The rule flags NON-ZERO typed
 * stats only, so it cannot fire on an honest empty state.
 *
 * ⚠️ EXTENDED 2026-10-01 (#940) — a TYPED PROVIDER LIST is the same defect. `providers.controller`
 * shipped `availableProviders: ['alpaca', 'alphavantage', 'trading212']`; two of those three were
 * NOT registered and eight registered ones were omitted. A literal list of capabilities is a
 * fabricated answer in exactly the #918 sense: it renders identically to a derived one. The rule
 * is NARROW on purpose — it guards the `availableProviders` key, the one that carries this claim.
 * Widening it to every provider string would fire on `'mt5'` throughout the codebase, the guard
 * would be allowlisted, and an allowlisted guard is worse than none.
 *
 * SCOPE: `nest/src/**\/*.ts`, excluding `*.spec.ts` (a test fixture may carry plausible numbers by
 * design — that is what fixtures are for). Frontend data files are out of scope: this is about a
 * BACKEND response claiming a measurement.
 *
 * Usage:  node nest/scripts/validate-fabricated-stats.cjs             # report + exit code
 *         node nest/scripts/validate-fabricated-stats.cjs --list      # full inventory, exit 0
 *         node nest/scripts/validate-fabricated-stats.cjs --self-test # prove BOTH rules can fire
 * Exit 0 = no fabricated literal. Exit 1 = at least one found.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const SCAN = path.join(ROOT, 'nest', 'src');
const LIST_ONLY = process.argv.includes('--list');

/** Stat fields whose typed non-zero value is the fabrication shape. */
const FIELDS = '(?:winRate|totalTrades|profitFactor|expectancy|avgWin|avgLoss|winningTrades|losingTrades)';
const PATTERN = new RegExp(`\\b${FIELDS}\\s*:\\s*(-?\\d+(?:\\.\\d+)?)\\b`, 'g');

/**
 * A provider list typed as an array literal of TWO OR MORE strings (#940). One element is not the
 * shape (`['mt5']` can be a legitimate single-provider hint); a derived list (`listAdapters()
 * .map(...)`) contains no `'` and never matches. Guards the `availableProviders` key only.
 */
const PROVIDER_LIST_PATTERN = /\bavailableProviders\s*:\s*\[\s*'[^']*'\s*,\s*'[^']*'/;

/**
 * scanText() — pure detector over one file's text. Extracted so --self-test can exercise it
 * directly, and so the tree canary below proves the WALK reads files rather than only that the
 * regex is well-formed.
 */
function scanText(rel, text) {
  const out = [];
  text.split(/\r?\n/).forEach((lineText, i) => {
    // A comment is documentation, not configuration — the #918 close comment itself quotes the
    // removed literal shape and must not fail the build.
    if (/^\s*(\/\/|\*|\/\*)/.test(lineText)) return;
    PATTERN.lastIndex = 0;
    let m;
    while ((m = PATTERN.exec(lineText)) !== null) {
      const value = Number(m[1]);
      if (value === 0) continue; // an honest empty summary, not a fabrication
      out.push({ kind: 'stat', rel, lineNo: i + 1, what: m[0].trim(), lineText: lineText.trim() });
    }
    if (PROVIDER_LIST_PATTERN.test(lineText)) {
      out.push({ kind: 'provider-list', rel, lineNo: i + 1, what: 'availableProviders', lineText: lineText.trim() });
    }
  });
  return out;
}

/** Walk the real tree and collect findings. */
function collectFindings() {
  const findings = [];
  for (const file of walk(SCAN)) {
    const rel = path.relative(ROOT, file).split(path.sep).join('/');
    findings.push(...scanText(rel, fs.readFileSync(file, 'utf8')));
  }
  return findings;
}

function walk(dir, out = []) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === 'node_modules') continue;
      walk(full, out);
    } else if (e.name.endsWith('.ts') && !e.name.endsWith('.spec.ts')) {
      out.push(full);
    }
  }
  return out;
}

if (process.argv.includes('--self-test')) {
  let pass = 0;
  const failures = [];
  const t = (name, cond) => (cond ? pass++ : failures.push(name));

  // Detector, both rules, both directions.
  t('non-zero winRate IS a finding', scanText('x.ts', 'const a = { winRate: 0.65 };').length === 1);
  t('zero winRate is NOT a finding', scanText('x.ts', 'const a = { winRate: 0 }, b = { totalTrades: 0 };').length === 0);
  t('a commented literal is NOT a finding', scanText('x.ts', '// winRate: 0.65').length === 0);
  t('a typed 2-element provider list IS a finding', scanText('x.ts', "availableProviders: ['alpaca', 'alphavantage'],").length === 1);
  t('a single-element list is NOT a finding', scanText('x.ts', "availableProviders: ['alpaca'],").length === 0);
  t('a derived list is NOT a finding', scanText('x.ts', 'availableProviders: this.factory.listAdapters().map((c) => c.id),').length === 0);

  // Tree canary — prove the WALK reads the file it scans, not just that the regex is well-formed.
  const canary = path.join(SCAN, '__fabricated-stats-canary.ts');
  try {
    fs.writeFileSync(canary, "export const c = { winRate: 0.65 };\nexport const l = { availableProviders: ['a', 'b'] };\n");
    const found = collectFindings();
    const mine = found.filter((f) => f.rel.endsWith('__fabricated-stats-canary.ts'));
    t('tree walk finds the planted stat', mine.some((f) => f.kind === 'stat'));
    t('tree walk finds the planted provider list', mine.some((f) => f.kind === 'provider-list'));
  } finally {
    fs.rmSync(canary, { force: true });
  }
  t('canary file removed', !fs.existsSync(canary));

  console.log(`\n[fabricated-stats] --self-test ${pass}/${pass + failures.length} passed\n`);
  for (const f of failures) console.log(`   ✗ ${f}`);
  process.exit(failures.length === 0 ? 0 : 1);
}

const findings = collectFindings();

if (findings.length === 0) {
  console.log('\n[fabricated-stats] ✅ OK — no non-zero typed stat literal and no typed provider list in backend source.\n');
  process.exit(0);
}

console.log(`\n[fabricated-stats] ✖ ${findings.length} FABRICATED LITERAL(S):\n`);
for (const f of findings) {
  console.log(`  ${f.rel}:${f.lineNo}   [${f.kind}] (${f.what})`);
  console.log(`      ${f.lineText.slice(0, 140)}`);
  console.log(
    f.kind === 'provider-list'
      ? '      → a typed provider list names capabilities that were not registered and omits ones that were. Derive it from the registry (#940).\n'
      : '      → a typed win rate/trade count renders exactly like a computed figure, and traces to nothing. Compute it from real rows, or delete the surface (#918, #894).\n',
  );
}
if (LIST_ONLY) {
  console.log('(--list: reporting only, exiting 0)\n');
  process.exit(0);
}
process.exit(1);
