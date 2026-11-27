/**
 * selection-exclusions.test.js — the split must never be a plausible number with the wrong meaning.
 *
 * ⚠️ THE CASE THAT MATTERS IS THE LAST ONE: the derived `total` is asserted against the figure the
 * SERVER sends (`totals.engineTradesOutsideSelection`). Two copies of one sum is the defect this whole
 * module exists to avoid — if they ever disagree, the header and its breakdown describe different runs
 * and nothing else would notice.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { summariseExclusions, EXCLUSION_CODES } from './selection-exclusions.js';

test('the two codes are kept apart, and the total is their sum', () => {
  const s = summariseExclusions([{ symbol: 'NXXT', trades: 29, excludedNotSelected: 25, excludedBeforeCutoff: 9 }]);
  assert.equal(s.kept, 29);
  assert.equal(s.notSelected, 25);
  assert.equal(s.beforeCutoff, 9);
  assert.equal(s.total, 34);
  assert.equal(s.engineTotal, 63, 'kept + notSelected + beforeCutoff — every trade the engine produced');
});

test('a code with nothing in it is dropped, so the caption never says "0 pre-cutoff"', () => {
  const s = summariseExclusions([{ trades: 4, excludedNotSelected: 7, excludedBeforeCutoff: 0 }]);
  assert.deepEqual(s.byCode.map((c) => c.code), ['not-selected']);
  assert.equal(s.total, 7);
});

test('several symbols are summed, which is what a top-N > 1 run produces', () => {
  const s = summariseExclusions([
    { trades: 3, excludedNotSelected: 2, excludedBeforeCutoff: 1 },
    { trades: 5, excludedNotSelected: 0, excludedBeforeCutoff: 4 },
  ]);
  assert.equal(s.kept, 8);
  assert.equal(s.notSelected, 2);
  assert.equal(s.beforeCutoff, 5);
  assert.equal(s.total, 7);
});

test('a symbol that reported nothing is SKIPPED, not counted as zero', () => {
  const s = summariseExclusions([
    { trades: 3, excludedNotSelected: 2, excludedBeforeCutoff: 1 },
    { symbol: 'BAD' },
    null,
  ]);
  assert.equal(s.kept, 3, 'the failed symbol must not dilute the counts it never made');
  assert.equal(s.total, 3);
});

test('a zero total is PRESENT, not absent — "nothing was excluded" is a result', () => {
  const s = summariseExclusions([{ trades: 6, excludedNotSelected: 0, excludedBeforeCutoff: 0 }]);
  assert.equal(s.total, 0);
  assert.deepEqual(s.byCode, []);
  assert.equal(s.engineTotal, 6);
});

test('no perSymbol at all is NULL, never zeros — a failed day has not excluded anything', () => {
  assert.equal(summariseExclusions(undefined), null);
  assert.equal(summariseExclusions(null), null);
  assert.equal(summariseExclusions([]), null);
  assert.equal(summariseExclusions([{ symbol: 'X' }]), null, 'rows with no counts report nothing');
});

test('▶ CANARY — a run where every trade was counted reports a zero total, so the null branch is a real branch', () => {
  // If `summariseExclusions` returned null here too, the two states would be indistinguishable and the
  // test above would pass for the wrong reason.
  const s = summariseExclusions([{ trades: 1, excludedNotSelected: 0, excludedBeforeCutoff: 0 }]);
  assert.notEqual(s, null);
  assert.equal(s.total, 0);
});

test('the derived total matches the figure the SERVER sends, on the measured run', () => {
  // Measured 2026-11-27, movers-winners-2026-11-11 · movers-v1-long · topN 1 · cutoff 15:30:
  // `totals.engineTradesOutsideSelection` was 34 and `totals.trades` was 29.
  const perSymbol = [{ symbol: 'NXXT', trades: 29, excludedNotSelected: 25, excludedBeforeCutoff: 9 }];
  const s = summariseExclusions(perSymbol);
  assert.equal(s.total, 34, 'must equal totals.engineTradesOutsideSelection');
  assert.equal(s.kept, 29, 'must equal totals.trades');
});

test('every code carries a label and a sentence a reader can act on', () => {
  for (const c of EXCLUSION_CODES) {
    assert.ok(c.code && c.label && c.tells, `${c.code} is incomplete`);
    assert.ok(c.tells.length > 40, `${c.code} does not say enough to act on`);
  }
});
