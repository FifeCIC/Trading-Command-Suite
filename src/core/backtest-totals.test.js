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
  assert.deepEqual(pickRepeatPair(runs, 'B').pair, { aId: 'p2-old', bId: 'p2-new', n: 2 });
  assert.equal(pickRepeatPair(runs, 'A', ['p1-old']).pair, null);
  assert.match(pickRepeatPair([{ id: 'x', period: 'C', createdAt: '2026-10-01' }], 'C').reason, /fewer than two/);
});

test('a run with no stored scores cannot take part in the pair', () => {
  const runs = [
    { id: 'nostore', period: 'D', createdAt: '2026-10-01T00:00:00Z', hasScores: false },
    { id: 'hasstore1', period: 'D', createdAt: '2026-10-02T00:00:00Z', hasScores: true },
    { id: 'hasstore2', period: 'D', createdAt: '2026-10-03T00:00:00Z', hasScores: true },
  ];
  assert.deepEqual(pickRepeatPair(runs, 'D').pair, { aId: 'hasstore1', bId: 'hasstore2', n: 2 });
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
  assert.deepEqual(pickRepeatPair(runs, 'E').pair, { aId: 'instant1', bId: 'instant2', n: 2 });

  const unknown = runs.map(({ hasInstants, ...r }) => r);
  assert.deepEqual(
    pickRepeatPair(unknown, 'E').pair,
    { aId: 'noinstant', bId: 'instant2', n: 3 },
    'an absent flag is unknown, not false — otherwise an older payload silently hides every run',
  );
});
