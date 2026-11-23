/**
 * The guard for the three loading states (#1330).
 *
 * ⚠️ Two rules are load-bearing here, and both were paid for on this app:
 *   1. **Shape wins over length** — a reader about to see a table gets a skeleton, not a rail, or the
 *      layout changes on top of the wait.
 *   2. **No real total means no bar** — the owner's own words: *"loading bars that aren't actually based
 *      on something loading."* `stepProgress()` must return `null`, and a caller that rendered a 0%
 *      would be inventing a measurement.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveLoadingMode, stepProgress } from './loading-state.js';

test('a known shape gets a skeleton, whatever the length', () => {
  assert.equal(resolveLoadingMode({ shapeKnown: true }), 'skeleton');
  assert.equal(resolveLoadingMode({ shapeKnown: true, length: 5 }), 'skeleton');
});

test('an unknown shape with a real length gets the step rail', () => {
  assert.equal(resolveLoadingMode({ length: 5 }), 'steps');
  assert.equal(resolveLoadingMode({ length: 1 }), 'steps');
});

test('neither known gets the orbit — never a bar', () => {
  assert.equal(resolveLoadingMode(), 'orbit');
  assert.equal(resolveLoadingMode({}), 'orbit');
  assert.equal(resolveLoadingMode({ length: 0 }), 'orbit');
  assert.equal(resolveLoadingMode({ length: null }), 'orbit');
  assert.equal(resolveLoadingMode({ length: 'unknown' }), 'orbit');
});

test('a rail with no real total is refused, not zeroed', () => {
  assert.equal(stepProgress(0, 0), null);
  assert.equal(stepProgress(0, undefined), null);
  assert.equal(stepProgress(0, null), null);
  assert.equal(stepProgress(0, 'soon'), null);
});

test('the rail counts real steps and stops at the total', () => {
  assert.deepEqual(stepProgress(0, 5), { steps: 5, at: 0, complete: false, currentIndex: 0 });
  assert.deepEqual(stepProgress(2, 5), { steps: 5, at: 2, complete: false, currentIndex: 2 });
  assert.deepEqual(stepProgress(5, 5), { steps: 5, at: 5, complete: true, currentIndex: -1 });
});

test('a count past the total is clamped, and a negative one floors at zero', () => {
  assert.equal(stepProgress(9, 5).at, 5);
  assert.equal(stepProgress(9, 5).complete, true);
  assert.equal(stepProgress(-4, 5).at, 0);
});

test('CANARY — a fractional total rounds DOWN, so no half segment is drawn', () => {
  assert.equal(stepProgress(0, 4.9).steps, 4);
  assert.equal(stepProgress(1.9, 5).at, 1);
});
