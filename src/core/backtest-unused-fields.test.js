/**
 * backtest-unused-fields.test.js — the inventory must never turn a missing field into a value (#1340).
 *
 * The whole panel exists so the owner can choose what to surface. Its one dangerous failure is
 * rendering a declared field as though the run had returned it: a blank cell reads as "zero" or
 * "nothing happened", and the reader would decide against a field that was never present.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { inventoryRows, formatValue, readPath, UNUSED_FIELD_INVENTORY } from './backtest-unused-fields.js';

const payload = {
  rankingProvider: { provider: 'yahoo', available: ['yahoo'], ambiguous: false, note: null },
  candidates: ['NWTG', 'CANG', 'ELOG'],
  priorSessions: 3,
  sideSource: 'protocol',
  datasetSide: 'winners',
  fillGap: { measured: 0, beyond: 0, medianPct: null },
  perSymbol: [{ symbol: 'ELOG', excludedNotSelected: 0, excludedBeforeCutoff: 2 }],
  admission: null,
};

test('readPath resolves a nested key and refuses to throw on anything else', () => {
  assert.equal(readPath(payload, 'rankingProvider.provider'), 'yahoo');
  assert.equal(readPath(payload, 'nope.deeper.still'), undefined);
  assert.equal(readPath(null, 'a'), undefined);
  assert.equal(readPath(payload, ''), undefined);
});

test('every declared row is reported, whether the run returned it or not', () => {
  const rows = inventoryRows(payload);
  assert.equal(rows.length, UNUSED_FIELD_INVENTORY.length);
  assert.equal(rows.find((r) => r.path === 'priorSessions').present, true);
});

test('a declared field the run does not return is ABSENT, not zero and not blank', () => {
  const rows = inventoryRows({});
  const missing = rows.find((r) => r.path === 'rankingProvider');
  assert.equal(missing.present, false);
  assert.equal(missing.value, undefined);
  assert.equal(formatValue(missing.value), null);
});

test('a null value counts as absent — "the run had nothing" is not "the field is zero"', () => {
  const rows = inventoryRows(payload);
  assert.equal(rows.find((r) => r.path === 'admission').present, false);
});

test('a zero value is PRESENT, which is the case a falsy check would get wrong', () => {
  const rows = inventoryRows({ priorSessions: 0 });
  const row = rows.find((r) => r.path === 'priorSessions');
  assert.equal(row.present, true);
  assert.equal(formatValue(row.value), '0');
});

test('a nested object is read through its path, not borrowed from a sibling', () => {
  const rows = inventoryRows({ perSymbol: [{ symbol: 'ELOG', excludedBeforeCutoff: 2 }] });
  // `excludedBeforeCutoff` lives per symbol and is NOT declared at the top level: reporting it present
  // here would show one symbol's figure as though it were the run's.
  assert.equal(rows.some((r) => r.path === 'excludedBeforeCutoff'), false);
  assert.equal(rows.find((r) => r.path === 'rankingProvider').present, false);
});

test('formatValue summarises objects and never leaks [object Object]', () => {
  assert.match(formatValue({ provider: 'yahoo', ambiguous: false }), /provider: yahoo/);
  assert.equal(formatValue([1, 2, 3]), '1, 2, 3');
  assert.equal(formatValue([{ a: 1 }, { a: 2 }]), '2 item(s)');
  assert.equal(formatValue([]), '(none)');
  assert.equal(formatValue({}), '(empty)');
  assert.equal(formatValue('  '), '(empty)');
  assert.equal(formatValue(1.23456), '1.23');
  assert.equal(formatValue(7), '7');
  assert.equal(formatValue(true), 'yes');
});
