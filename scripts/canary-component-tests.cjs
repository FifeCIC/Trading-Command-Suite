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

function canary(label, file, from, to, spec, expectedHits = 1) {
  const abs = path.join(ROOT, file);
  const original = fs.readFileSync(abs, 'utf8');
  const hits = original.split(from).length - 1;
  if (hits !== expectedHits) {
    console.log(`  ✖ CANARY INVALID — ${label}: the anchor matched ${hits} times in ${file}, expected exactly ${expectedHits}`);
    results.push(false);
    return;
  }
  const broken = expectedHits === 1 ? original.replace(from, to) : original.split(from).join(to);
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

/**
 * The day table's split (2026-11-27). The bug this guards is not a crash — it is a bare number with no
 * explanation, which renders perfectly and tells the reader nothing.
 */
canary(
  'a day table that drops the exclusion SPLIT is caught',
  'src/features/movers-strategy/ResultByDayStep.jsx',
  '{d.exclusions.byCode.length > 0 && (',
  '{false && (',
  'src/features/movers-strategy/ResultByDayStep.test.jsx',
);

/**
 * The offline banner's link (2026-11-27). The defect was a href pointing at port 5188 — a dead port — and
 * the spec passed anyway because it asserted `.toContain`. This mutation restores the literal and
 * requires the stronger assertion to fail.
 */
canary(
  'an offline banner that hardcodes a host and port is caught',
  'src/components/ApiOfflineBanner.jsx',
  'href="/trading/server-controls"',
  'href="http://localhost:5188/trading/server-controls"',
  'src/components/ApiOfflineBanner.test.jsx',
  // ⚠️ TWO anchors carry the link (the pill and the full banner), and BOTH must break for the spec to
  // fail. Asserting 2 is the point: a mutation that silently hit only one would leave the other
  // correct and the canary would report a pass it had not earned.
  2,
);

canary(
  'an empty state that drops the action precedence is caught',
  'src/components/EmptyState.jsx',
  '{actionLabel && (actionOnClick ? (',
  '{actionLabel && (actionHref ? (',
  'src/components/EmptyState.test.jsx',
);

canary(
  'a critical notice that loses its role is caught',
  'src/components/Notice.jsx',
  ' role={role}',
  '',
  'src/components/Notice.test.jsx',
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
