/**
 * trade-config-revert.test.js — the rules that decide when a setting goes back.
 *
 * ⚠️ THE CASES THAT MATTER ARE THE ONES THAT MUST **NOT** REVERT. An automatic revert fires on a
 * number, so the failure mode is a bot silently rolled back because a run failed, because the previous
 * figure was missing, or because two runs were compared on values that mean different things.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  snapshotOf,
  revertBody,
  netPnlOf,
  autoRevertDecision,
  REVERT_CAVEAT,
} from './trade-config-revert.js';

const FIELDS = [
  { id: 'slPct', label: 'Stop loss', editable: { control: 'number', nullable: true, min: 0, max: 100 }, botValue: 2.5 },
  { id: 'tpPct', label: 'Take profit', editable: { control: 'number', nullable: true, min: 0, max: 100 }, botValue: 25 },
  { id: 'maxHoldHours', label: 'Max hold', editable: { control: 'number', integer: true, nullable: true }, botValue: 6 },
  { id: 'stopGuard', label: 'Stop Guardian', value: 'live only' },   // no `editable` — no column
];

test('snapshotOf keeps the PREVIOUS raw value of every field being changed', () => {
  const snap = snapshotOf(FIELDS, { slPct: 5, tpPct: 100 });
  assert.deepEqual(snap, { slPct: '2.5', tpPct: '25' });
});

test('▶ CANARY — a row with no column behind it is never snapshotted', () => {
  // `stopGuard` has no `editable`, so a revert body containing it would PATCH a field that is not a column.
  const snap = snapshotOf(FIELDS, { stopGuard: 'live only', slPct: 5 });
  assert.equal(Object.prototype.hasOwnProperty.call(snap, 'stopGuard'), false);
});

test('▶ CANARY — revertBody refuses a value the column cannot take, rather than sending it', () => {
  const { body, problems } = revertBody({ maxHoldHours: '6.5' }, FIELDS);
  assert.deepEqual(body, {});                         // not sent
  assert.match(problems[0], /whole number/);
});

test('revertBody parses back to typed values, including null for a cleared nullable field', () => {
  const { body, problems } = revertBody({ slPct: '2.5', tpPct: '' }, FIELDS);
  assert.deepEqual(body, { slPct: 2.5, tpPct: null });
  assert.deepEqual(problems, []);
});

test('netPnlOf sums only the runs that succeeded, and is null when none did', () => {
  assert.equal(netPnlOf([{ totals: { netPnl: 100 } }, { totals: { netPnl: -20 } }]), 80);
  assert.equal(netPnlOf([{ notice: { code: 'x' } }]), null);
  assert.equal(netPnlOf([]), null);
  assert.equal(netPnlOf(undefined), null);
});

test('▶ CANARY — off by default, and off never reverts whatever the numbers say', () => {
  const d = autoRevertDecision({ enabled: false, beforePnl: 100, afterPnl: -50 });
  assert.equal(d.revert, false);
  assert.match(d.because, /off/);
});

test('a genuinely worse re-run reverts, and names both figures', () => {
  const d = autoRevertDecision({ enabled: true, beforePnl: 100, afterPnl: 40 });
  assert.equal(d.revert, true);
  assert.match(d.because, /40\.00/);
  assert.match(d.because, /100\.00/);
});

test('▶ CANARY — "cannot judge" never reverts: a failed run is not a worse run', () => {
  assert.equal(autoRevertDecision({ enabled: true, beforePnl: 100, afterPnl: null }).revert, false);
  assert.equal(autoRevertDecision({ enabled: true, beforePnl: null, afterPnl: 40 }).revert, false);
  assert.equal(autoRevertDecision({ enabled: true, beforePnl: 100, afterPnl: undefined }).revert, false);
});

test('equal profit is not "less", so it does not revert', () => {
  assert.equal(autoRevertDecision({ enabled: true, beforePnl: 50, afterPnl: 50 }).revert, false);
});

test('every decision carries the caveat, so a revert is never presented as a measurement', () => {
  for (const args of [
    { enabled: true, beforePnl: 10, afterPnl: 5 },
    { enabled: false, beforePnl: 10, afterPnl: 5 },
    { enabled: true, beforePnl: null, afterPnl: 5 },
  ]) {
    assert.equal(autoRevertDecision(args).caveat, REVERT_CAVEAT);
  }
  assert.match(REVERT_CAVEAT, /sample, not a verdict/);
});
