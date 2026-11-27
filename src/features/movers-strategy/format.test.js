/**
 * format.test.js — `progressLabel` is an off-by-one waiting to happen, so it is tested here.
 *
 * The page shows `Running Mon 10 Nov… · 00:41`; this adds which day of how many. The number is derived
 * from `progress.done`, which counts FINISHED days — so while day 1 runs, `done` is 0. Adding one when
 * the run has finished would report a sixth day for a five-day queue.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { dayLabel, progressLabel } from './format.js';

const queue = ['a', 'b', 'c', 'd', 'e'];

test('the FIRST day running reads 1/5, because done counts finished days', () => {
  assert.equal(progressLabel({ queue, done: 0 }, true), '1/5');
});

test('the last day running reads 5/5, not 6/5', () => {
  assert.equal(progressLabel({ queue, done: 4 }, true), '5/5');
});

test('a FINISHED run reads 5/5 — the running flag is what stops the extra day', () => {
  assert.equal(progressLabel({ queue, done: 5 }, false), '5/5');
  // The same state with `running` still true is the boundary case: it must clamp, not overflow.
  assert.equal(progressLabel({ queue, done: 5 }, true), '5/5');
});

test('a stopped run reads what it actually finished, with the full queue as the denominator', () => {
  assert.equal(progressLabel({ queue, done: 2, stopped: true }, false), '2/5');
});

test('nothing has run is NULL, never 0/0 — "no run" and "nothing finished" are different', () => {
  assert.equal(progressLabel(null, false), null);
  assert.equal(progressLabel(undefined, false), null);
  assert.equal(progressLabel({ queue: [] }, false), null);
  assert.equal(progressLabel({}, false), null);
});

test('a nonsense `done` cannot produce a fraction a reader would believe', () => {
  assert.equal(progressLabel({ queue, done: -3 }, false), '0/5');
  assert.equal(progressLabel({ queue, done: 99 }, false), '5/5');
  assert.equal(progressLabel({ queue, done: 'x' }, false), '0/5');
});

test('dayLabel still renders the day, and an empty date is an em dash, not "Invalid Date"', () => {
  assert.equal(dayLabel('2026-11-10'), 'Tue 10 Nov');
  assert.equal(dayLabel(''), '—');
  assert.equal(dayLabel(null), '—');
});
