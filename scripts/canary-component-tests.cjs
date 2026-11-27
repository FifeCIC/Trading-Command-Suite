/**
 * canary-component-tests.cjs — proves each component spec FAILS when its component breaks.
 *
 * ── WHY THIS IS A SCRIPT AND NOT A PARAGRAPH ─────────────────────────────────────────────────────
 * A spec that has never failed is a decoration, exactly like a validator. The initial three specs cover
 * `LoadingSkeleton` (74 consumers), `NoticeBlock` (61) and `ApiOfflineBanner` (27) — 162 call sites — and
 * the only way to know they are guards is to break the components and watch them report.
 *
 * ⚠️ Every mutation asserts its own edit LANDED before the test is interpreted. A substitution that
 * matched nothing runs the suite against unmodified code, reports green, and reads as "the spec is
 * decoration" — sending the next reader to rewrite a spec that was fine. Each anchor must appear exactly
 * once, the file is snapshotted, and the restore is verified byte-for-byte.
 *
 * Usage: node scripts/canary-component-tests.cjs   (also `npm run test:components:self-test`)
 * Exit:  0 = every mutation was caught and the tree is restored · 1 = a case did not behave · 2 = invalid
 */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const results = [];

function runSpec(specFile) {
  try {
    execFileSync(process.execPath, [path.join(ROOT, 'node_modules/vitest/vitest.mjs'), 'run', specFile], {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return 0;
  } catch (e) {
    return e.status ?? 2;
  }
}

function canary(label, file, from, to, spec) {
  const abs = path.join(ROOT, file);
  const original = fs.readFileSync(abs, 'utf8');
  const hits = original.split(from).length - 1;
  if (hits !== 1) {
    console.log(`  ✖ CANARY INVALID — ${label}: the anchor matched ${hits} times in ${file}, expected exactly 1`);
    results.push(false);
    return;
  }
  const broken = original.replace(from, to);
  fs.writeFileSync(abs, broken, 'utf8');
  try {
    if (fs.readFileSync(abs, 'utf8') === original) throw new Error('the write did not land');
    const code = runSpec(spec);
    const ok = code === 1;
    results.push(ok);
    console.log(`  ${ok ? '✅' : '✖'} ${label} — spec exit ${code}, expected 1`);
  } finally {
    fs.writeFileSync(abs, original, 'utf8');
    if (fs.readFileSync(abs, 'utf8') !== original) throw new Error(`CANARY INVALID — ${file} was not restored`);
  }
}

console.log('canary: component specs');

canary(
  'a failure notice rendered as a status is caught',
  'src/components/NoticeBlock.jsx',
  "role={isFailure ? 'alert' : 'status'}",
  "role={'status'}",
  'src/components/NoticeBlock.test.jsx',
);

canary(
  'a dropped `Why` label is caught',
  'src/components/NoticeBlock.jsx',
  '<span className="notice-label">Why</span>',
  '<span className="notice-label">Because</span>',
  'src/components/NoticeBlock.test.jsx',
);

canary(
  'a lost className pass-through is caught',
  'src/components/LoadingSkeleton.jsx',
  "className={`ls-card-grid ${className}`}",
  'className="ls-card-grid"',
  'src/components/LoadingSkeleton.test.jsx',
);

canary(
  'an ignored rows/cols prop is caught',
  'src/components/LoadingSkeleton.jsx',
  '{Array.from({ length: rows }).map((_, r) => (',
  '{Array.from({ length: 5 }).map((_, r) => (',
  'src/components/LoadingSkeleton.test.jsx',
);

canary(
  'a pill that loses the port is caught',
  'src/components/ApiOfflineBanner.jsx',
  'title={`${serviceName} on port ${port} is offline`}',
  'title={`${serviceName} is offline`}',
  'src/components/ApiOfflineBanner.test.jsx',
);

// restore-then-clean
const clean = runSpec('src/components/LoadingSkeleton.test.jsx');
const allGreen = clean === 0;
results.push(allGreen);
console.log(`  ${allGreen ? '✅' : '✖'} restored, the suite is green again — exit ${clean}`);

const failures = results.filter((r) => !r).length;
console.log('');
console.log(failures === 0 ? '✅ canary: every spec fails on its own component breaking, and the tree is restored' : `✖ canary: ${failures} case(s) wrong`);
process.exit(failures === 0 ? 0 : 1);
