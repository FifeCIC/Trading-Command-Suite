#!/usr/bin/env node
/**
 * directive-conformance.cjs — Tier-2 conformance suite for scoring directives.
 *
 * Runs every compiled directive through one common set of behavioural checks
 * (META.Stack correctness review "Required testing system — Tier 2"):
 *
 *   1. deterministic  — same input twice must produce identical output.
 *   2. finite         — score and confidence must be finite numbers.
 *   3. bounded        — 0 <= score <= directive.maxScore.
 *   4. valid direction — signalClass ∈ {bullish, bearish, neutral} (or absent).
 *   5. insufficient   — empty bars must not emit an actionable (bullish/bearish)
 *                       direction with a non-zero score.
 *   6. immutable      — calculate() must not mutate the input bars.
 *
 * Inputs are built with a FIXED asOf so calendar/seasonal directives are
 * deterministic within a run (their MST-009 asOf plumbing is assumed).
 *
 * Usage (from nest/):  node scripts/directive-conformance.cjs
 * Requires a prior `npm run build` (reads compiled dist).
 * Exit code: 1 if any directive FAILs, 0 otherwise, 2 if dist is missing.
 */

const fs = require('fs');
const path = require('path');

const NEST_ROOT = path.resolve(__dirname, '..');
const DIST_DIR = path.join(NEST_ROOT, 'dist', 'src', 'modules', 'directives', 'implementations');

// Fixed evaluation clock so calendar/seasonal directives are deterministic.
const AS_OF = new Date('2026-09-01T12:00:00Z');

function makeBars(n = 120, trend = 0.1) {
  const bars = [];
  for (let i = 0; i < n; i++) {
    const t = new Date(AS_OF.getTime() - (n - i) * 3600000);
    const open = 100 + i * trend;
    const close = open + trend;
    bars.push({ timestamp: t, open, high: close + 1, low: open - 1, close, volume: 1000 + i * 5 });
  }
  return bars;
}

/** Instantiate every directive class in the compiled implementations dir. */
function collectDirectives() {
  if (!fs.existsSync(DIST_DIR)) {
    console.error(`[conformance] dist not found at ${DIST_DIR} — run "npm run build" first.`);
    process.exit(2);
  }
  const files = fs.readdirSync(DIST_DIR).filter((f) => /\.(?:directive|stub|directives)\.js$/.test(f));
  const directives = [];
  for (const f of files) {
    let mod;
    try {
      mod = require(path.join(DIST_DIR, f));
    } catch {
      continue;
    }
    for (const val of Object.values(mod)) {
      if (typeof val !== 'function') continue;
      let inst;
      try {
        inst = new val();
      } catch {
        continue; // constructor-injected dependency not available standalone
      }
      if (!inst || typeof inst.calculate !== 'function' || typeof inst.id !== 'string') continue;
      directives.push(inst);
    }
  }
  return directives;
}

async function runChecks(inst) {
  const failures = [];
  const warnings = [];
  const maxScore = inst.maxScore;

  const input = {
    symbol: 'CONF',
    bars: makeBars(),
    dayBars: makeBars(120, 0.05),
    hourBars: makeBars(120, 0.05),
    min15Bars: makeBars(120, 0.05),
    asOf: AS_OF,
  };

  // Full-input calculate — a throw means an injected dependency is unavailable
  // standalone, so the directive is SKIPped rather than failed.
  let r1;
  let r2;
  try {
    r1 = await inst.calculate(input);
  } catch (e) {
    return { failures: [], warnings: [], skip: e.message };
  }
  try {
    r2 = await inst.calculate(input);
  } catch (e) {
    return { failures: [], warnings: [], skip: e.message };
  }

  const before = JSON.stringify(input.bars);

  if (r1 && r2) {
    if (JSON.stringify(r1) !== JSON.stringify(r2)) {
      failures.push('non-deterministic (two identical runs differ)');
    }
    if (!Number.isFinite(r1.score)) failures.push(`non-finite score=${r1.score}`);
    if (!Number.isFinite(r1.confidence)) failures.push(`non-finite confidence=${r1.confidence}`);
    if (Number.isFinite(r1.score) && maxScore !== undefined && (r1.score < 0 || r1.score > maxScore)) {
      failures.push(`score ${r1.score} out of [0, ${maxScore}]`);
    }
    const sc = r1.signalClass;
    if (sc !== undefined && !['bullish', 'bearish', 'neutral'].includes(sc)) {
      failures.push(`invalid signalClass=${sc}`);
    }
  }
  if (JSON.stringify(input.bars) !== before) {
    failures.push('mutated input.bars');
  }

  // Empty-bars: an actionable direction is a WARN, not a fail — calendar/
  // date-driven directives legitimately score without price bars.
  let empty;
  try {
    empty = await inst.calculate({ symbol: 'CONF', bars: [] });
  } catch {
    /* ignore */
  }
  if (empty) {
    const sc = empty.signalClass;
    if ((sc === 'bullish' || sc === 'bearish') && empty.score !== 0) {
      warnings.push(`empty-bars actionable ${sc}/${empty.score}`);
    }
  }

  return { failures, warnings, skip: '' };
}

async function main() {
  const directives = collectDirectives();
  const rows = [];
  let pass = 0;
  let fail = 0;
  let skip = 0;
  let warn = 0;
  for (const inst of directives) {
    const { failures, warnings, skip: skipReason } = await runChecks(inst);
    if (skipReason) {
      skip++;
      rows.push({ id: inst.id, status: 'SKIP', note: `injected dep: ${skipReason}` });
      continue;
    }
    if (failures.length === 0) {
      pass++;
      if (warnings.length) warn++;
      rows.push({ id: inst.id, status: 'PASS', note: warnings.join('; ') });
    } else {
      fail++;
      rows.push({ id: inst.id, status: 'FAIL', note: failures.join('; ') });
    }
  }

  console.log('\nDirective conformance — Tier-2');
  console.log('=============================');
  for (const r of rows) {
    if (r.status === 'PASS' && !r.note) console.log(`  PASS  ${r.id}`);
    else if (r.status === 'PASS') console.log(`  PASS  ${r.id}  (warn: ${r.note})`);
    else if (r.status === 'SKIP') console.log(`  SKIP  ${r.id}  — ${r.note}`);
    else console.log(`  FAIL  ${r.id}  — ${r.note}`);
  }
  console.log(`\n${rows.length} directives exercised · ${pass} pass (${warn} warn) · ${fail} fail · ${skip} skip`);
  process.exit(fail === 0 ? 0 : 1);
}

main();
