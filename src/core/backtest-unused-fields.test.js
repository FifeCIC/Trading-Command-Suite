/**
 * backtest-unused-fields.test.js — the inventory must never turn a missing field into a value (#1340).
 *
 * The whole panel exists so the owner can choose what to surface. Its one dangerous failure is
 * rendering a declared field as though the run had returned it: a blank cell reads as "zero" or
 * "nothing happened", and the reader would decide against a field that was never present.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  inventoryRows,
  formatValue,
  readPath,
  pickListFor,
  inventoryFindings,
  UNUSED_FIELD_INVENTORY,
  INVENTORY_CONCERNS,
} from './backtest-unused-fields.js';

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

// ── note n · the pick-list ───────────────────────────────────────────────────────────────────────

test('the declaration is healthy in BOTH directions — every field answers a question, every question has fields', () => {
  const f = inventoryFindings();
  assert.deepEqual(f.unassigned, [], 'a field no reader is ever offered');
  assert.deepEqual(f.empty, [], 'a chip that opens an empty table');
  assert.deepEqual(f.unknown, [], 'an `answers` id that is not a declared concern');
});

test('▶ CANARY — a field with NO question is reported, so the pick-list cannot silently drop it', () => {
  const f = inventoryFindings([{ path: 'mystery', answers: [] }]);
  assert.deepEqual(f.unassigned, ['mystery']);
});

test('▶ CANARY — a question with NO field is reported, because an empty chip reads as "nothing to say"', () => {
  const f = inventoryFindings([{ path: 'a', answers: ['comparable'] }]);
  assert.deepEqual(f.empty, ['decision', 'assumed']);
});

test('▶ CANARY — a mistyped `answers` id is reported, or the field vanishes from every pick-list', () => {
  const f = inventoryFindings([{ path: 'a', answers: ['comparabel'] }]);
  assert.deepEqual(f.unknown, ['comparabel']);
  assert.deepEqual(f.unassigned, [], 'it HAS an answer; the answer is just not a real question');
});

test('a pick-list returns the fields that answer ONE question, and says how many it left out', () => {
  const rows = inventoryRows(payload);
  const { rows: picked, concern, hidden } = pickListFor(rows, 'decision');
  assert.equal(concern.question, 'Did the strategy actually choose?');
  assert.deepEqual(picked.map((r) => r.path), ['candidates', 'sideSource', 'datasetSide']);
  assert.equal(hidden, rows.length - picked.length);
  assert.equal(picked.length + hidden, rows.length, 'nothing may be lost between the two counts');
});

test('"all" is the whole inventory with nothing hidden — the default must not filter silently', () => {
  const rows = inventoryRows(payload);
  const all = pickListFor(rows, 'all');
  assert.equal(all.rows.length, rows.length);
  assert.equal(all.hidden, 0);
  assert.equal(all.concern, null);
});

test('an UNKNOWN question returns everything rather than an empty table', () => {
  const rows = inventoryRows(payload);
  const { rows: picked, concern } = pickListFor(rows, 'no-such-concern');
  assert.equal(picked.length, rows.length);
  assert.equal(concern, null);
});

test('a retired field is GONE from the inventory — fillGap is rendered now, so it may not be listed', () => {
  // Measured 2026-11-27: step 2 renders `fillGapChips(fillGapView)`, so the declaration's own claim
  // ("computed on every run and shown nowhere") became false. This asserts the correction holds.
  assert.equal(UNUSED_FIELD_INVENTORY.some((i) => i.path === 'fillGap'), false);
});

test('every concern names a question and a reason a reader can act on', () => {
  for (const c of INVENTORY_CONCERNS) {
    assert.ok(c.id && c.question && c.why, `${c.id} is incomplete`);
    assert.match(c.question, /\?$/, 'a concern is a question, not a noun');
  }
});
