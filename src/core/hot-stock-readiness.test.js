/**
 * hot-stock-readiness.test.js — pins the difference between "2 of 4" and "cannot judge".
 *
 * ⚠️ The failure this guards is not a crash. It is a card that renders `0/0` when the request failed,
 * which a reader takes as "nothing reads these settings" — a confident claim nobody made.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hotStockReadiness } from './hot-stock-readiness.js';

const rule = (field, enforcement) => ({ field, enforcement, label: field });

test('a failed request is null — CANNOT JUDGE, not "0 of 0"', () => {
  assert.equal(hotStockReadiness(null), null);
  assert.equal(hotStockReadiness(undefined), null);
  assert.equal(hotStockReadiness({}), null);
  assert.equal(hotStockReadiness({ all: 'not an array' }), null);
});

test('a payload with no hotStock fields is null, not a zero-count finding', () => {
  assert.equal(hotStockReadiness({ all: [rule('stopLossPct', 'live')] }), null);
  assert.equal(hotStockReadiness({ all: [] }), null);
});

test('splits read from unread on enforcement, where none means no reader', () => {
  const payload = {
    all: [
      rule('hotStockEnabled', 'display-only'),
      rule('hotStockDetectionMode', 'display-only'),
      rule('hotStockAllocation', 'none'),
      rule('hotStockMaxHoldHours', 'none'),
      rule('stopLossPct', 'live'),
    ],
  };
  const r = hotStockReadiness(payload);
  assert.equal(r.all.length, 4, 'only the hotStock* fields are counted');
  assert.equal(r.read.length, 2);
  assert.deepEqual(r.read.map((x) => x.field), ['hotStockEnabled', 'hotStockDetectionMode']);
  assert.deepEqual(
    r.all.filter((x) => x.enforcement === 'none').map((x) => x.field),
    ['hotStockAllocation', 'hotStockMaxHoldHours'],
  );
});

test('any enforcement other than none counts as a reader', () => {
  const payload = { all: [rule('hotStockEnabled', 'live'), rule('hotStockAllocation', 'legacy-only')] };
  const r = hotStockReadiness(payload);
  assert.equal(r.read.length, 2, 'live and legacy-only both mean something reads the column');
  assert.equal(r.all.length, 2);
});

test('all four read reports 4/4 — the tone decision the page makes', () => {
  const r = hotStockReadiness({
    all: ['Enabled', 'DetectionMode', 'Allocation', 'MaxHoldHours'].map((s) => rule(`hotStock${s}`, 'live')),
  });
  assert.equal(r.read.length, r.all.length);
});

test('entries without a string field are ignored rather than throwing', () => {
  const r = hotStockReadiness({ all: [null, {}, { field: 42 }, rule('hotStockEnabled', 'display-only')] });
  assert.equal(r.all.length, 1);
  assert.equal(r.all[0].field, 'hotStockEnabled');
});
