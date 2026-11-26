import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAttemptSeries } from './attempt-series.js';

/**
 * The three rules that make an attempt trend honest (2026-11-26). Each one has produced a wrong
 * conclusion in this repo before, which is why they live in a pure module rather than a `map()`.
 */

const row = (id, netPnl, at = '2026-11-26T10:00:00.000Z', semanticsVersion = 3) => ({
  id,
  createdAt: at,
  semanticsVersion,
  totals: netPnl === undefined ? {} : { netPnl },
});

test('▶ CANARY — the endpoint is newest-first, so the series is REVERSED before plotting', () => {
  // Oldest value is 100 and newest is 300: drawn left-to-right that must rise, not fall.
  const out = buildAttemptSeries([row('c', 300), row('b', 200), row('a', 100)], 3);
  assert.deepEqual(out.values, [100, 200, 300]);
  assert.deepEqual(out.points.map((p) => p.id), ['a', 'b', 'c']);
});

test('a run measured under different semantics is EXCLUDED and counted, never joined', () => {
  const out = buildAttemptSeries([row('c', 300), row('bad', 9_999, undefined, 2), row('a', 100)], 3);
  assert.deepEqual(out.values, [100, 300]);
  assert.equal(out.excludedSemantics, 1);
});

test('identical re-runs are reported by DISTINCT count, not hidden behind a smooth line', () => {
  const out = buildAttemptSeries([row('c', 1225.95), row('b', 1225.95), row('a', 1225.95)], 3);
  assert.equal(out.points.length, 3);
  assert.equal(out.distinct, 1);
});

test('an unmeasurable row is DROPPED and counted — it is never a fabricated zero', () => {
  const out = buildAttemptSeries([row('c', 300), row('empty', undefined), row('a', 100)], 3);
  assert.deepEqual(out.values, [100, 300]);
  assert.equal(out.skipped, 1);
});

test('garbage in, empty out — never a throw and never a point', () => {
  assert.deepEqual(buildAttemptSeries(null, 3).values, []);
  assert.deepEqual(buildAttemptSeries([], 3).values, []);
  assert.deepEqual(buildAttemptSeries([null, undefined], 3).values, []);
});

test('a null semanticsVersion accepts everything, because nothing was asked of it', () => {
  // Newest-first, as the endpoint returns: b(9) then a(2) → plotted oldest first.
  const out = buildAttemptSeries([row('b', 200, undefined, 9), row('a', 100, undefined, 2)], null);
  assert.deepEqual(out.values, [100, 200]);
  assert.equal(out.excludedSemantics, 0);
});
