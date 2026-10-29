import test from 'node:test';
import assert from 'node:assert/strict';
import { pickRepeatPair } from './backtest-totals.js';

/**
 * backtest-totals.test.js — the client's last piece of A/B logic: WHICH runs stand in as a window's A
 * and B.
 *
 * ⚠️ The sums, direction counts and the repeat verdict are NOT tested here any more — they moved to
 * `nest/src/modules/backtest/score-maths.ts` and are covered by `score-maths.spec.ts`, because the
 * decision has to be reachable without a browser and two implementations would drift.
 */

test('pickRepeatPair takes the oldest and newest run of the chosen period', () => {
  const runs = [
    { id: 'p1-old', period: 'A', createdAt: '2026-10-01T00:00:00Z' },
    { id: 'p1-new', period: 'A', createdAt: '2026-10-03T00:00:00Z' },
    { id: 'p2-old', period: 'B', createdAt: '2026-10-05T00:00:00Z' },
    { id: 'p2-new', period: 'B', createdAt: '2026-10-09T00:00:00Z' },
  ];
  assert.deepEqual(pickRepeatPair(runs, 'B').pair, { aId: 'p2-old', bId: 'p2-new', n: 2, basis: 'created-order' });
  // ⚠️ No loop recorded → the pair is INFERRED, and it says so (`basis`), so a guessed pair never
  // reads like a recorded attempt (#1144).
  assert.equal(pickRepeatPair(runs, 'B').pair.basis, 'created-order');
  assert.equal(pickRepeatPair(runs, 'A', ['p1-old']).pair, null);
  assert.match(pickRepeatPair([{ id: 'x', period: 'C', createdAt: '2026-10-01' }], 'C').reason, /fewer than two/);
});

/**
 * ⚠️ THE PAIR SHOULD COME FROM THE RECORDED LOOP, NOT FROM CLOCK ORDER (#1144).
 *
 * `iteration` is what the API assigns when a run is posted with an `experimentId`, so it is the only
 * evidence that two runs are consecutive attempts at the same change. Sorting by `createdAt` is a guess
 * that happens to be right when nothing else ran in between — and wrong the moment it did.
 */
test('pickRepeatPair prefers the first and last iteration of a recorded experiment', () => {
  const runs = [
    { id: 'exp-iter3', period: 'P', createdAt: '2026-10-01T00:00:00Z', experimentId: 'exp', iteration: 3 },
    { id: 'loose-old', period: 'P', createdAt: '2026-09-01T00:00:00Z' },
    { id: 'exp-iter1', period: 'P', createdAt: '2026-10-03T00:00:00Z', experimentId: 'exp', iteration: 1 },
    { id: 'exp-iter2', period: 'P', createdAt: '2026-10-02T00:00:00Z', experimentId: 'exp', iteration: 2 },
    { id: 'loose-new', period: 'P', createdAt: '2026-10-09T00:00:00Z' },
  ];
  const { pair } = pickRepeatPair(runs, 'P');
  assert.deepEqual(pair, {
    aId: 'exp-iter1',
    bId: 'exp-iter3',
    n: 3,
    basis: 'experiment',
    experimentId: 'exp',
    fromIteration: 1,
    toIteration: 3,
  });
  // The clock-order fallback would have picked the loose runs, which are not an attempt at all:
  assert.notEqual(pair.aId, 'loose-old');
  assert.notEqual(pair.bId, 'loose-new');
});

test('pickRepeatPair takes the MOST RECENTLY ACTIVE loop when a window has two', () => {
  // ⚠️ A window gets revisited: an old attempt with more runs must not win over the one just used, or the
  // panel would keep measuring last week's abandoned loop while today's sits beside it.
  const runs = [
    { id: 'old-1', period: 'R', createdAt: '2026-10-01T00:00:00Z', experimentId: 'old', iteration: 1 },
    { id: 'old-2', period: 'R', createdAt: '2026-10-01T01:00:00Z', experimentId: 'old', iteration: 2 },
    { id: 'old-3', period: 'R', createdAt: '2026-10-01T02:00:00Z', experimentId: 'old', iteration: 3 },
    { id: 'new-1', period: 'R', createdAt: '2026-10-09T00:00:00Z', experimentId: 'new', iteration: 1 },
    { id: 'new-2', period: 'R', createdAt: '2026-10-09T01:00:00Z', experimentId: 'new', iteration: 2 },
  ];
  const { pair } = pickRepeatPair(runs, 'R');
  assert.equal(pair.experimentId, 'new');
  assert.deepEqual([pair.aId, pair.bId], ['new-1', 'new-2']);
});

test('pickRepeatPair falls back to clock order when only ONE run of a loop can be used', () => {
  const runs = [
    { id: 'exp-iter1', period: 'Q', createdAt: '2026-10-01T00:00:00Z', experimentId: 'exp', iteration: 1 },
    { id: 'exp-iter2-broken', period: 'Q', createdAt: '2026-10-02T00:00:00Z', experimentId: 'exp', iteration: 2, hasInstants: false },
    { id: 'loose-a', period: 'Q', createdAt: '2026-10-03T00:00:00Z' },
    { id: 'loose-b', period: 'Q', createdAt: '2026-10-04T00:00:00Z' },
  ];
  const { pair } = pickRepeatPair(runs, 'Q');
  assert.equal(pair.basis, 'created-order');
  assert.deepEqual([pair.aId, pair.bId], ['exp-iter1', 'loose-b']);
});

test('a run with no stored scores cannot take part in the pair', () => {
  const runs = [
    { id: 'nostore', period: 'D', createdAt: '2026-10-01T00:00:00Z', hasScores: false },
    { id: 'hasstore1', period: 'D', createdAt: '2026-10-02T00:00:00Z', hasScores: true },
    { id: 'hasstore2', period: 'D', createdAt: '2026-10-03T00:00:00Z', hasScores: true },
  ];
  assert.deepEqual(pickRepeatPair(runs, 'D').pair, { aId: 'hasstore1', bId: 'hasstore2', n: 2, basis: 'created-order' });
});

/**
 * ⚠️ A RUN WITH SCORES BUT NO PER-BAR INSTANT IS A SEPARATE EXCLUSION (measured 2026-10-27).
 *
 * `hasScores` was the only flag, so the oldest run of `dev-window-v1` was picked as the window's A and
 * the window then reported "a run stored no per-bar instant, so the two cannot be lined up" — while two
 * measurable runs sat unused on the same period. Both directions are asserted: the flag excludes when
 * false, and its ABSENCE must not exclude (older payloads do not carry it).
 */
test('a run with scores but no per-bar instant cannot take part in the pair', () => {
  const runs = [
    { id: 'noinstant', period: 'E', createdAt: '2026-10-01T00:00:00Z', hasScores: true, hasInstants: false },
    { id: 'instant1', period: 'E', createdAt: '2026-10-02T00:00:00Z', hasScores: true, hasInstants: true },
    { id: 'instant2', period: 'E', createdAt: '2026-10-03T00:00:00Z', hasScores: true, hasInstants: true },
  ];
  assert.deepEqual(pickRepeatPair(runs, 'E').pair, { aId: 'instant1', bId: 'instant2', n: 2, basis: 'created-order' });

  const unknown = runs.map(({ hasInstants, ...r }) => r);
  assert.deepEqual(
    pickRepeatPair(unknown, 'E').pair,
    { aId: 'noinstant', bId: 'instant2', n: 3, basis: 'created-order' },
    'an absent flag is unknown, not false — otherwise an older payload silently hides every run',
  );
});
