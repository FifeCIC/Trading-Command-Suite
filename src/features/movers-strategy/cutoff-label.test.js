/**
 * cutoff-label.test.js — the ET label must follow the US clock, not a typed guess.
 *
 * ⚠️ THE TWO CASES THAT MATTER are the same UTC value on an EDT date and an EST date. The old control
 * hardcoded the EST answer, so half the year it told the reader the screen time was an hour earlier
 * than it was. US DST in 2026 runs from 8 March to 1 November, so the fixtures below sit either side
 * of it by a wide margin rather than on the boundary.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { cutoffLabel, offsetLabel, clockLabel, US_OPEN_MIN } from './cutoff-label.js';

test('15:00 UTC is 10:00 ET in WINTER — the value the old control assumed, and it is right here', () => {
  const l = cutoffLabel('15:00', ['2026-11-11']);
  assert.equal(l.et, '10:00');
  assert.equal(l.offset, '30 min in');
  assert.equal(l.varies, false);
});

test('▶ the SAME 15:00 UTC is 11:00 ET in SUMMER — an hour further into the session', () => {
  const l = cutoffLabel('15:00', ['2026-07-15']);
  assert.equal(l.et, '11:00');
  assert.equal(l.offset, '1 h 30 min in');
});

test('the open itself and a pre-open cutoff are different states, not a zero', () => {
  assert.equal(offsetLabel(0), 'at the open');
  assert.equal(offsetLabel(-30), '30 min before the open');
  assert.equal(offsetLabel(60), '1 h in');
  assert.equal(offsetLabel(45), '45 min in');
});

test('a multi-day run that straddles the clock change says VARIES instead of picking one', () => {
  // 2026-11-01 is the US clock change; 10-30 is EDT and 11-02 is EST.
  const l = cutoffLabel('15:30', ['2026-10-30', '2026-11-02']);
  assert.equal(l.varies, true);
  assert.match(l.et, /10:30\/11:30|11:30\/10:30/);
  assert.match(l.offset, / or /);
  assert.equal(l.perDay.length, 2);
});

test('days that agree do not claim to vary', () => {
  const l = cutoffLabel('16:30', ['2026-11-09', '2026-11-10', '2026-11-11']);
  assert.equal(l.varies, false);
  assert.equal(l.et, '11:30');
  assert.equal(l.offset, '2 h in');
});

test('nothing selected is NULL, never a made-up clock', () => {
  assert.equal(cutoffLabel('15:30', []).et, null);
  assert.equal(cutoffLabel('15:30', null).et, null);
  assert.equal(cutoffLabel('15:30', [undefined]).et, null);
});

test('an unusable date or time is null rather than "Invalid Date" on screen', () => {
  assert.equal(cutoffLabel('15:30', ['not-a-date']).et, null);
  assert.equal(clockLabel(null), null);
  assert.equal(offsetLabel(NaN), null);
});

test('▶ CANARY — the EST and EDT answers are genuinely different, so the test above is not vacuous', () => {
  const winter = cutoffLabel('15:00', ['2026-12-10']).et;
  const summer = cutoffLabel('15:00', ['2026-06-10']).et;
  assert.notEqual(winter, summer);
  assert.equal(winter, '10:00');
  assert.equal(summer, '11:00');
});

test('the open constant is 09:30, declared once', () => {
  assert.equal(US_OPEN_MIN, 570);
  assert.equal(clockLabel(US_OPEN_MIN), '09:30');
});
