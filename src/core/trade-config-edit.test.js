/**
 * The guard for editing a bot column from the backtest table (register row 247, #1329).
 *
 * ⚠️ Every case here is a way a live trading value can be changed by accident. The important one is
 * "empty is not zero": `Number('')` is `0`, so a cleared stop-loss box would write a 0% stop — no
 * protection at all — while the UI reported a save. The refusal is the feature.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseFieldValue, sameFieldValue, storedRaw, collectChanges } from './trade-config-edit.js';

const num = (over = {}) => ({
  id: 'slPct',
  label: 'Stop loss',
  botValue: 2.5,
  editable: { control: 'number', unit: '%', min: 0, max: 100, step: 0.1, nullable: true, ...over },
});

const int = (over = {}) => ({
  id: 'maxPositions',
  label: 'Max positions',
  botValue: 1,
  editable: { control: 'number', min: 1, max: 50, step: 1, integer: true, ...over },
});

const toggle = () => ({
  id: 'simTslEnabled',
  label: 'Trailing stop',
  botValue: 'off',
  editable: { control: 'toggle' },
});

const time = () => ({
  id: 'exitBeforeUtc',
  label: 'Exit before (UTC)',
  botValue: null,
  editable: { control: 'time', nullable: true },
});

test('a cleared NULLABLE number is null, never 0', () => {
  const r = parseFieldValue(num(), '');
  assert.equal(r.ok, true);
  assert.equal(r.value, null);
  assert.notEqual(r.value, 0);
});

test('a cleared REQUIRED number is refused, not zeroed and not null', () => {
  const r = parseFieldValue(num({ nullable: false }), '   ');
  assert.equal(r.ok, false);
  assert.match(r.error, /cannot be empty/);
});

test('an integer column refuses a fraction (the database would reject it)', () => {
  assert.equal(parseFieldValue(int(), '2').value, 2);
  const r = parseFieldValue(int(), '2.5');
  assert.equal(r.ok, false);
  assert.match(r.error, /whole number/);
});

test('min and max are enforced on the number that would be sent', () => {
  assert.equal(parseFieldValue(int(), '0').ok, false);
  assert.equal(parseFieldValue(int(), '51').ok, false);
  assert.equal(parseFieldValue(int(), '50').value, 50);
});

test('non-numeric text is refused rather than becoming NaN', () => {
  const r = parseFieldValue(num(), 'abc');
  assert.equal(r.ok, false);
  assert.match(r.error, /must be a number/);
});

test('a time is HH:MM or nothing — no free text reaches the column', () => {
  assert.equal(parseFieldValue(time(), '20:45').value, '20:45');
  assert.equal(parseFieldValue(time(), '').value, null);
  assert.equal(parseFieldValue(time(), '8:5').ok, false);
  assert.equal(parseFieldValue(time(), '24:00').ok, false);
});

test('a toggle reads on/off as a boolean for a Boolean column', () => {
  assert.equal(parseFieldValue(toggle(), true).value, true);
  assert.equal(parseFieldValue(toggle(), false).value, false);
  assert.equal(storedRaw(toggle()), false);
  assert.equal(storedRaw({ ...toggle(), botValue: 'on' }), true);
});

test('equality compares PARSED values, so 2.50 is not a change against 2.5', () => {
  assert.equal(sameFieldValue(num(), '2.50', '2.5'), true);
  assert.equal(sameFieldValue(num(), '2.6', '2.5'), false);
  // An empty draft against a null column is not a change either.
  assert.equal(sameFieldValue(num(), '', ''), true);
});

test('collectChanges sends only the dirty rows, and counts refusals', () => {
  const fields = [num(), int(), toggle(), time()];
  const draft = { slPct: '3.5', maxPositions: '4', simTslEnabled: true };
  const { body, problems, count } = collectChanges(fields, draft);
  assert.deepEqual(body, { slPct: 3.5, maxPositions: 4, simTslEnabled: true });
  assert.deepEqual(problems, []);
  assert.equal(count, 3);

  const broken = collectChanges(fields, { maxPositions: '2.5' });
  assert.deepEqual(broken.body, {});
  assert.equal(broken.count, 1);
  assert.match(broken.problems[0], /whole number/);
});

test('CANARY — a non-editable row can never reach the PATCH body', () => {
  const readOnly = { id: 'brokerId', label: 'Broker', botValue: '2', applied: false };
  assert.deepEqual(collectChanges([readOnly], { brokerId: '9' }).body, {});
});
