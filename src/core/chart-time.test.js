import test from 'node:test';
import assert from 'node:assert/strict';
import { toChartTime, toChartSeries, toChartTimes } from './chart-time.js';

/**
 * chart-time.test.js — the guard for the class that killed `/education/pattern-scanner`.
 *
 * lightweight-charts asserts on non-unique or unsorted `time` values and the exception takes the
 * page down. The measured instance was `new Date(ts).toISOString().split('T')[0]` on 1H data:
 * **100 bars → 13 distinct dates**, so `setData` threw before the chart drew.
 *
 * The first case below is that exact input, and it fails against the old mapping — that is the
 * point of it. A test that passes both before and after the fix would prove nothing.
 */

test('hourly bars on one day keep HOURLY resolution (the regression)', () => {
  // 6 hourly bars, all on 2026-10-28 — the old date-string mapping gave ONE distinct time for all 6.
  const bars = Array.from({ length: 6 }, (_, i) => ({
    timestamp: `2026-10-28T${String(17 + i).padStart(2, '0')}:00:00Z`,
    open: 100, high: 101, low: 99, close: 100.5,
  }));

  const series = toChartSeries(bars);
  const distinct = new Set(series.map((c) => c.time));

  assert.equal(series.length, 6);
  assert.equal(distinct.size, 6, 'every hourly bar must have its own chart time');
  // The guard's own proof that the input is the shape that broke: all six share one DATE, so the
  // old `toISOString().split('T')[0]` mapping would have produced 1 distinct time, not 6.
  assert.equal(new Set(bars.map((b) => b.timestamp.slice(0, 10))).size, 1);
});

test('output is strictly ascending', () => {
  const bars = [
    { timestamp: '2026-10-28T19:00:00Z', open: 1, high: 1, low: 1, close: 1 },
    { timestamp: '2026-10-28T17:00:00Z', open: 2, high: 2, low: 2, close: 2 },
    { timestamp: '2026-10-28T18:00:00Z', open: 3, high: 3, low: 3, close: 3 },
  ];
  const series = toChartSeries(bars);
  for (let i = 1; i < series.length; i += 1) {
    assert.ok(series[i].time > series[i - 1].time, `index ${i} must be strictly greater`);
  }
});

test('duplicate timestamps collapse to one bar, later value wins', () => {
  const bars = [
    { timestamp: '2026-10-28T17:00:00Z', close: 111 },
    { timestamp: '2026-10-28T17:00:00Z', close: 222 },
  ];
  const series = toChartSeries(bars);
  assert.equal(series.length, 1);
  assert.equal(series[0].close, 222);
});

test('unparseable timestamps are DROPPED, never NaN', () => {
  const series = toChartSeries([
    { timestamp: '2026-10-28T17:00:00Z', close: 1 },
    { timestamp: 'not-a-date', close: 2 },
    { close: 3 },
  ]);
  assert.equal(series.length, 1);
  assert.ok(series.every((c) => Number.isFinite(c.time)));
});

test('toChartTime returns null (not NaN) for empty and garbage input', () => {
  for (const raw of [null, undefined, '', 'garbage', {}]) {
    assert.equal(toChartTime(raw), null, `expected null for ${JSON.stringify(raw)}`);
  }
});

test('daily bars work on the same code path as intraday', () => {
  const series = toChartSeries([{ timestamp: '2026-10-28T22:00:00Z', close: 5 }]);
  assert.equal(series.length, 1);
  assert.equal(typeof series[0].time, 'number');
});

test('toChartTimes stays index-aligned with the RAW bars', () => {
  const bars = [
    { timestamp: '2026-10-28T17:00:00Z' },
    { timestamp: 'not-a-date' },
    { timestamp: '2026-10-28T19:00:00Z' },
  ];
  const times = toChartTimes(bars);
  assert.equal(times.length, 3, 'one entry per raw bar, nulls included');
  assert.equal(typeof times[0], 'number');
  assert.equal(times[1], null);
  assert.ok(times[2] > times[0]);
});

test('empty and undefined input produce an empty series', () => {
  assert.deepEqual(toChartSeries([]), []);
  assert.deepEqual(toChartSeries(undefined), []);
  assert.deepEqual(toChartTimes(undefined), []);
});
