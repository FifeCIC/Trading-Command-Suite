import test from 'node:test';
import assert from 'node:assert/strict';
import { groupPeriods, setHealth } from './period-sets.js';

/**
 * period-sets.test.js — the line between "one data set" and "ten rows that happen to share a name".
 *
 * The defect this guards is a library that LIES about how much evidence it holds: merge two windows
 * under one name and a bar count describes neither, split one set and the reasoning appears ten
 * times. Both failures are silent — the table renders either way.
 */

const row = (over = {}) => ({
  id: over.id ?? `id-${over.symbol ?? 'X'}`,
  name: 'movers-winners-2026-11-11',
  note: 'NXXT +809.1%',
  symbol: 'NXXT',
  timeframe: '5m',
  from: '2026-11-04T00:00:00.000Z',
  to: '2026-11-12T00:00:00.000Z',
  barCount: 230,
  runs: 0,
  ...over,
});

test('rows sharing name, timeframe and window become ONE set', () => {
  const sets = groupPeriods([
    row({ symbol: 'NXXT' }),
    row({ symbol: 'SCKT', barCount: 231 }),
    row({ symbol: 'RETO', barCount: 283 }),
  ]);
  assert.equal(sets.length, 1);
  assert.equal(sets[0].symbols, 3);
  assert.equal(sets[0].totalBars, 744);
  assert.deepEqual(sets[0].periods.map((p) => p.symbol), ['NXXT', 'RETO', 'SCKT']);
});

test('a DIFFERENT timeframe is a different set — 5m bars are not 1d bars', () => {
  // dev-window-v1 really does exist at 5m/15m/1h/1d. Merging them would let a 5m capture's bar
  // count be read as if it described the 1d window.
  const sets = groupPeriods([row({ timeframe: '5m' }), row({ timeframe: '1d' })]);
  assert.equal(sets.length, 2);
});

test('the same name over a DIFFERENT window is a different set', () => {
  // Two captures called "test" over different windows must not share one note.
  const sets = groupPeriods([
    row({ from: '2026-11-04T00:00:00.000Z' }),
    row({ from: '2026-10-01T00:00:00.000Z' }),
  ]);
  assert.equal(sets.length, 2);
});

test('the first NON-EMPTY note wins, so a blank later row cannot erase the reasoning', () => {
  const sets = groupPeriods([row({ note: null }), row({ note: 'the reason' })]);
  assert.equal(sets.length, 1);
  assert.equal(sets[0].note, 'the reason');
});

test('noteVariants counts drift between members instead of hiding it', () => {
  const together = groupPeriods([row({ note: 'same' }), row({ note: 'same' })]);
  assert.equal(together[0].noteVariants, 1);
  const drifted = groupPeriods([row({ note: 'edited one row' }), row({ note: 'original' })]);
  assert.equal(drifted[0].noteVariants, 2);
});

test('barCount null and 0 are counted as different facts', () => {
  const sets = groupPeriods([
    row({ symbol: 'A', barCount: 100 }),
    row({ symbol: 'B', barCount: null }),
    row({ symbol: 'C', barCount: 0 }),
  ]);
  assert.equal(sets[0].neverImported, 1);
  assert.equal(sets[0].emptyWindows, 1);
  assert.equal(sets[0].totalBars, 100, 'null and 0 both contribute 0 bars');
});

test('sets are ordered by window, newest first', () => {
  const sets = groupPeriods([
    row({ name: 'old', from: '2026-01-01T00:00:00.000Z' }),
    row({ name: 'new', from: '2026-12-01T00:00:00.000Z' }),
  ]);
  assert.deepEqual(sets.map((s) => s.name), ['new', 'old']);
});

test('junk input is an empty list, never a throw', () => {
  assert.deepEqual(groupPeriods(null), []);
  assert.deepEqual(groupPeriods(undefined), []);
  assert.deepEqual(groupPeriods({ not: 'an array' }), []);
});

test('setHealth separates ready from PARTIAL, because partial looks complete', () => {
  const all = groupPeriods([row({ symbol: 'A' }), row({ symbol: 'B' })])[0];
  assert.equal(setHealth(all), 'ready');

  const partial = groupPeriods([row({ symbol: 'A' }), row({ symbol: 'B', barCount: null })])[0];
  assert.equal(setHealth(partial), 'partial', '6 of 10 captured must not read as complete');

  const studied = groupPeriods([row({ symbol: 'A', runs: 2 })])[0];
  assert.equal(setHealth(studied), 'studied');

  const empty = groupPeriods([row({ symbol: 'A', barCount: 0 })])[0];
  assert.equal(setHealth(empty), 'empty');
});
