#!/usr/bin/env node
/**
 * validate-single-scoring-path.cjs — #803: ONE scoring path, and `active = 0` is a kill switch.
 * ============================================================================================
 * WHY THIS EXISTS (measured 2026-10-09). `usdcad-oil-v1` and `oil-supply-v1` — both
 * `active = 0`, one with no bot and no symbol assignment — were writing score rows every few
 * minutes. Two code facts allowed it, and this validator pins both against re-introduction:
 *
 *   1. `speed-scan.service.ts` fell back to a hardcoded symbol→protocol map and returned
 *      `active: true` WITHOUT asking the database — a claim nobody verified. The fallback must
 *      verify with `withDbActive(...)`, and the scan must SKIP an inactive protocol BEFORE
 *      scoring it (the flag was previously only used to label the result for the frontend).
 *
 *   2. `storeSnapshot()` in `protocol-gating.service.ts` is the ONE write point for `score` +
 *      `score_snapshot`. It must refuse writes for an inactive protocol, so a future caller
 *      that forgets its own check still cannot persist for a retired protocol.
 *
 * The behavioural proof lives in `single-scoring-path.spec.ts` (both directions, canaried).
 * This script is the SOURCE guard: it fails the build if the checks are removed or the lie
 * returns — a rule that is deleted is otherwise indistinguishable from one that was never
 * enforced.
 *
 * Self-test: `node scripts/validate-single-scoring-path.cjs --self-test`
 */

const fs = require('fs');
const path = require('path');

const NEST = path.resolve(__dirname, '..');

/** Check 1 — the write point must gate on `isActiveProtocol`. */
function checkWriteGuard(src) {
  const problems = [];
  if (!/storeSnapshot\([\s\S]{0,4000}isActiveProtocol\(protocolId\)[\s\S]{0,2000}REFUSED/.test(src)) {
    problems.push(
      'protocol-gating.service.ts: storeSnapshot() no longer refuses writes for an inactive ' +
        'protocol (expected an `isActiveProtocol(protocolId)` guard + a REFUSED log)',
    );
  }
  return problems;
}

/** Check 2 — the hardcoded fallback must not lie, and the scan must skip before scoring. */
function checkFallbackHonesty(src) {
  const problems = [];
  if (/SYMBOL_PROTOCOL_MAP\[symbol\]\)\s*return\s*\{\s*slug:\s*SYMBOL_PROTOCOL_MAP\[symbol\],\s*active:\s*true\s*\}/.test(src)) {
    problems.push('speed-scan.service.ts: the hardcoded fallback stamps `active: true` again — it must verify against the database (#803)');
  }
  if (!/if\s*\(fallbackSlug\)\s*return\s*withDbActive\(fallbackSlug,\s*prisma\);/.test(src)) {
    problems.push('speed-scan.service.ts: the hardcoded fallback no longer verifies via withDbActive(...) (#803)');
  }
  if (!/if\s*\(!protocolActive\)/.test(src)) {
    problems.push('speed-scan.service.ts: the scan no longer skips an inactive protocol BEFORE scoring (#803)');
  }
  return problems;
}

function run({ gatingSrc, speedSrc }) {
  return [...checkWriteGuard(gatingSrc), ...checkFallbackHonesty(speedSrc)];
}

// ── self-test: both checks must FAIL on bad input and PASS on good input ──────────────────

function selfTest() {
  const goodGating =
    'private storeSnapshot(x) { (async () => { const canonical = await this.isCanonicalProtocolSymbol(protocolId, symbol);' +
    ' if (!canonical) return; if (!(await this.isActiveProtocol(protocolId))) {' +
    ' this.logger.warn("Score write REFUSED for inactive protocol"); return; } })(); }';
  const badGating = 'private storeSnapshot(x) { (async () => { /* guard removed */ })(); }';

  const goodSpeed =
    'const fallbackSlug = SYMBOL_PROTOCOL_MAP[symbol]; if (fallbackSlug) return withDbActive(fallbackSlug, prisma);' +
    ' function x() { if (!protocolActive) { return { skipped: true }; } }';
  const badSpeedLie =
    'if (SYMBOL_PROTOCOL_MAP[symbol]) return { slug: SYMBOL_PROTOCOL_MAP[symbol], active: true };';
  const badSpeedNoVerify = 'const fallbackSlug = SYMBOL_PROTOCOL_MAP[symbol]; if (!protocolActive) {}';
  const badSpeedNoSkip =
    'const fallbackSlug = SYMBOL_PROTOCOL_MAP[symbol]; if (fallbackSlug) return withDbActive(fallbackSlug, prisma);';

  const cases = [
    ['write guard: good passes', run({ gatingSrc: goodGating, speedSrc: goodSpeed }).length === 0, true],
    ['write guard: removal fails', run({ gatingSrc: badGating, speedSrc: goodSpeed }).length > 0, true],
    ['fallback: good passes', run({ gatingSrc: goodGating, speedSrc: goodSpeed }).length === 0, true],
    ['fallback: the `active: true` lie fails', run({ gatingSrc: goodGating, speedSrc: badSpeedLie }).length > 0, true],
    ['fallback: missing withDbActive fails', run({ gatingSrc: goodGating, speedSrc: badSpeedNoVerify }).length > 0, true],
    ['scan: missing active-skip fails', run({ gatingSrc: goodGating, speedSrc: badSpeedNoSkip }).length > 0, true],
  ];

  let ok = true;
  for (const [name, actual, expected] of cases) {
    const pass = actual === expected;
    ok = ok && pass;
    console.log(`  ${pass ? '✅' : '✖'} ${name}`);
  }
  if (!ok) { console.error('[single-scoring-path] self-test FAILED'); process.exit(1); }
  console.log('[single-scoring-path] self-test OK — both checks can fail in both fixtures');
}

// ── main ──────────────────────────────────────────────────────────────────────────────────

if (process.argv.includes('--self-test')) {
  selfTest();
  process.exit(0);
}

const gatingPath = path.join(NEST, 'src', 'modules', 'scoring', 'protocol-gating.service.ts');
const speedPath = path.join(NEST, 'src', 'modules', 'scoring', 'speed-scan.service.ts');

const problems = run({
  gatingSrc: fs.readFileSync(gatingPath, 'utf8'),
  speedSrc: fs.readFileSync(speedPath, 'utf8'),
});

if (problems.length) {
  console.error(`[single-scoring-path] ✖ ${problems.length} problem(s):`);
  for (const p of problems) console.error(`  ✖ ${p}`);
  process.exit(1);
}
console.log('[single-scoring-path] ✅ OK — one scoring path; active = 0 gates the write point and the fallback verifies');
