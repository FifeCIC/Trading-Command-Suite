/**
 * trade-readiness.test.js — guards the verdict that decides whether a symbol card says
 * "✓ Trade Ready".
 *
 * WHY THIS EXISTS (#935, 2026-09-27)
 * ----------------------------------
 * SymbolPage drew "✓ Trade Ready" from `preTradeReady` ALONE. That field covers the pre-trade
 * gate only, while the ORDER path additionally requires zero execution blockers and a derivable
 * direction. Measured on BTC: the badge said ready while the order path held an execution
 * blocker and refused.
 *
 * The first test below IS that defect. If it ever starts passing by returning 'ready', the bug
 * is back — which is the whole point of writing it as the canary rather than as an example.
 *
 * Runs via `node --test`, and is wired into the backend `prebuild` next to notices.test.js so
 * that a regression fails the build rather than sitting in a suite nobody runs.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tradeReadiness } from './signal-utils.js';

/** An envelope that the API reports as gate-ready, with an empty execution assessment. */
const gateReady = (over = {}) => ({
  preTradeReady: true,
  preTradeBlockers: [],
  executionBlockers: [],
  ...over,
});

test('#935 — gate-ready but execution-blocked is NOT ready (the BTC case)', () => {
  const r = tradeReadiness(
    gateReady({
      executionBlockers: [{ code: 'size-below-minimum', message: 'Size 0.01 is below the 1 minimum' }],
    }),
  );
  assert.equal(r.state, 'blocked', 'a non-empty execution assessment must block despite preTradeReady');
  assert.deepEqual(r.reasons, ['Size 0.01 is below the 1 minimum']);
});

test('gate-ready AND execution-clear is ready', () => {
  assert.equal(tradeReadiness(gateReady()).state, 'ready');
});

test('the pre-trade gate alone can block', () => {
  const r = tradeReadiness(gateReady({ preTradeReady: false, preTradeBlockers: ['Composite 40 below gate 65'] }));
  assert.equal(r.state, 'blocked');
  assert.deepEqual(r.reasons, ['Composite 40 below gate 65']);
});

test('both sources are reported, gate reasons first', () => {
  const r = tradeReadiness(
    gateReady({
      preTradeReady: false,
      preTradeBlockers: ['Duplicate position open'],
      executionBlockers: [{ code: 'symbol-not-tradeable', message: 'Not tradeable on this broker' }],
    }),
  );
  assert.equal(r.state, 'blocked');
  assert.deepEqual(r.reasons, ['Duplicate position open', 'Not tradeable on this broker']);
});

test('an ABSENT assessment is "unknown", never "ready"', () => {
  // `undefined` means the server never ran the assessment — an older build, or it threw.
  // That is the ABSENCE of an answer. An empty list and a failed query must not look the same.
  const r = tradeReadiness({ preTradeReady: true, preTradeBlockers: [] });
  assert.equal(r.state, 'unknown');
  assert.notEqual(r.state, 'ready', 'an unassessed envelope must never render as Trade Ready');
});

test('a missing envelope is "unknown" and does not throw', () => {
  assert.equal(tradeReadiness(null).state, 'unknown');
  assert.equal(tradeReadiness(undefined).state, 'unknown');
});

test('`preTradeReady` is compared strictly, so a truthy non-true is not ready', () => {
  // Guards the `!== true` comparison. A payload with `1` or `"true"` must not read as ready.
  assert.equal(tradeReadiness(gateReady({ preTradeReady: 1 })).state, 'blocked');
  assert.equal(tradeReadiness(gateReady({ preTradeReady: 'true' })).state, 'blocked');
});

test('a blocker with only a fallback field still produces a reason', () => {
  // Blocker shapes have drifted between code/ reason/ message/ hint — the verdict must degrade to
  // SOMETHING readable rather than reporting "blocked" with no reason at all.
  assert.deepEqual(tradeReadiness(gateReady({ executionBlockers: [{ code: 'route-unverified' }] })).reasons, [
    'route-unverified',
  ]);
  assert.deepEqual(tradeReadiness(gateReady({ executionBlockers: [{ hint: 'Check the route' }] })).reasons, [
    'Check the route',
  ]);
});

test('a null executionBlockers is honoured as "no blockers", not as unknown', () => {
  // `null` is an explicit "assessed, cleared" from the API; only `undefined` means "not run".
  assert.equal(tradeReadiness(gateReady({ executionBlockers: null })).state, 'ready');
});
