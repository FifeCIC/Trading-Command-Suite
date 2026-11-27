import test from 'node:test';
import assert from 'node:assert/strict';
import { previewCells, hiddenCount, formatMove } from './day-list-preview.js';

const symbols = ['NXXT', 'SCKT', 'SHFS', 'CANG', 'ELOG', 'BGS'];
const atCutoff = { NXXT: 430.26, SCKT: 114.58, SHFS: 88.04, CANG: 39.5, ELOG: 33.65, BGS: 25.19 };
const peaks = { NXXT: 1903.21, SCKT: 166.19, SHFS: 154.49, CANG: 43.11, ELOG: 84.4, BGS: 37.22 };

test('the cell carries the move the RANKER uses, and the peak as a labelled second figure', () => {
  const cells = previewCells(symbols, atCutoff, peaks, 5);
  assert.deepEqual(cells.map((c) => c.symbol), ['NXXT', 'SCKT', 'SHFS', 'CANG', 'ELOG']);
  const n = cells[0];
  assert.equal(n.atCutoff, 430.26, 'the tradeable move, not the 1903% peak');
  assert.equal(n.peak, 1903.21);
  assert.equal(n.showPeak, true, 'they differ, so the peak is information');
});

test('▶ CANARY — the ORDER comes from the server; this module must not re-sort by the peak', () => {
  // Sorted by peak, SHFS (154) would outrank SCKT (114). The server orders by the cutoff move, and a
  // second ordering here would put a different name in column 1 from the one topN=1 picks.
  const cells = previewCells(symbols, atCutoff, peaks, 5);
  assert.deepEqual(cells.map((c) => c.symbol), ['NXXT', 'SCKT', 'SHFS', 'CANG', 'ELOG']);
});

test('a peak that agrees with the cutoff move is NOT repeated', () => {
  const cells = previewCells(['AAA'], { AAA: 40 }, { AAA: 40.2 });
  assert.equal(cells[0].showPeak, false, '0.2pp of noise is not a second measurement');
});

test('an available peak is shown when the cutoff move could not be measured', () => {
  const cells = previewCells(['AAA'], { AAA: null }, { AAA: 900 });
  assert.equal(cells[0].atCutoff, null);
  assert.equal(cells[0].showPeak, true, 'the peak is the only fact there is — show it');
});

test('a null move is NULL, never zero — unmeasurable is not flat', () => {
  const cells = previewCells(['AAA'], { AAA: null }, {});
  assert.equal(cells[0].atCutoff, null);
  assert.equal(cells[0].peak, null);
  assert.equal(formatMove(cells[0].atCutoff), '—');
  assert.equal(formatMove(0), '0.0%', 'a measured zero keeps its own sign-free form');
});

test('the limit is honoured and the remainder is COUNTED, because a silent cut reads as the whole list', () => {
  assert.equal(previewCells(symbols, atCutoff, peaks, 5).length, 5);
  assert.equal(hiddenCount(symbols, 5), 1);
  assert.equal(hiddenCount(['A', 'B'], 5), 0);
  assert.equal(hiddenCount(null, 5), 0);
});

test('a missing symbol list is an empty row, not a throw', () => {
  assert.deepEqual(previewCells(null, atCutoff, peaks), []);
  assert.deepEqual(previewCells(undefined, null, null), []);
});

test('moves print with one decimal and an explicit sign, so a fall is not read as a rise', () => {
  assert.equal(formatMove(430.26), '+430.3%');
  assert.equal(formatMove(-7.32), '-7.3%');
  assert.equal(formatMove(0.04), '0.0%');
  assert.equal(formatMove(null), '—');
  assert.equal(formatMove('nope'), '—');
});
