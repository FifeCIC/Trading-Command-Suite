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
 * SCOPE: `nest/src/**\/*.ts`, excluding `*.spec.ts` (a test fixture may carry plausible numbers by
 * design — that is what fixtures are for). Frontend data files are out of scope: this is about a
 * BACKEND response claiming a measurement.
 *
 * Usage:  node nest/scripts/validate-fabricated-stats.cjs            # report + exit code
 *         node nest/scripts/validate-fabricated-stats.cjs --list     # full inventory, exit 0
 * Exit 0 = no fabricated stat literal. Exit 1 = at least one found.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const SCAN = path.join(ROOT, 'nest', 'src');
const LIST_ONLY = process.argv.includes('--list');

/** Stat fields whose typed non-zero value is the fabrication shape. */
const FIELDS = '(?:winRate|totalTrades|profitFactor|expectancy|avgWin|avgLoss|winningTrades|losingTrades)';
const PATTERN = new RegExp(`\\b${FIELDS}\\s*:\\s*(-?\\d+(?:\\.\\d+)?)\\b`, 'g');

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

const findings = [];
for (const file of walk(SCAN)) {
  const rel = path.relative(ROOT, file).split(path.sep).join('/');
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
  lines.forEach((lineText, i) => {
    // A comment is documentation, not configuration — the #918 close comment itself quotes the
    // removed literal shape and must not fail the build.
    if (/^\s*(\/\/|\*|\/\*)/.test(lineText)) return;
    PATTERN.lastIndex = 0;
    let m;
    while ((m = PATTERN.exec(lineText)) !== null) {
      const value = Number(m[1]);
      if (value === 0) continue; // an honest empty summary, not a fabrication
      findings.push({ rel, lineNo: i + 1, stat: m[0].trim(), lineText: lineText.trim() });
    }
  });
}

if (findings.length === 0) {
  console.log('\n[fabricated-stats] ✅ OK — no non-zero typed winRate/totalTrades literal in backend source.\n');
  process.exit(0);
}

console.log(`\n[fabricated-stats] ✖ ${findings.length} FABRICATED STAT LITERAL(S):\n`);
for (const f of findings) {
  console.log(`  ${f.rel}:${f.lineNo}   (${f.stat})`);
  console.log(`      ${f.lineText.slice(0, 140)}`);
  console.log('      → a typed win rate/trade count renders exactly like a computed figure, and traces to nothing. Compute it from real rows, or delete the surface (#918, #894).\n');
}
if (LIST_ONLY) {
  console.log('(--list: reporting only, exiting 0)\n');
  process.exit(0);
}
process.exit(1);
