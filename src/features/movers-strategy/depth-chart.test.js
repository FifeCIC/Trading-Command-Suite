import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDepthChart, barSeconds } from './depth-chart.js';

const iso = (hhmm) => `2026-11-11T${hhmm}:00.000Z`;
const bar = (hhmm, price, score = 50) => ({ time: iso(hhmm), price, score, state: 'quiet' });
const trade = (over = {}) => ({
  entryDate: iso('15:30'),
  exitDate: iso('15:40'),
  entryPrice: 1.45,
  exitPrice: 1.46,
  direction: 'LONG',
  pnl: 10,
  exitReason: 'TP',
  ...over,
});

test('times are UNIX SECONDS, not milliseconds — a millisecond axis draws 1970', () => {
  const s = barSeconds(iso('15:30'));
  assert.equal(s, Math.floor(Date.parse(iso('15:30')) / 1000));
  assert.ok(s < 2e9, 'seconds, not milliseconds');
});

test('the axis is sorted and de-duplicated, because the library THROWS on unsorted data', () => {
  const { price } = buildDepthChart(
    [bar('15:40', 3), bar('15:30', 1), bar('15:30', 2)],
    [],
  );
  assert.deepEqual(price.map((p) => p.value), [1, 3], 'first reading for a duplicated instant wins');
  assert.deepEqual(price.map((p) => p.time), [...price.map((p) => p.time)].sort((a, b) => a - b));
});

test('a bar with no readable close is counted but not drawn — a short line is missing data', () => {
  const c = buildDepthChart([bar('15:30', 1), bar('15:35', null), bar('15:40', 3)], []);
  assert.equal(c.bars, 3);
  assert.equal(c.priced, 2);
  assert.equal(c.price.length, 2);
});

test('a trade snaps BACK to the bar it happened on — never forward onto the next one', () => {
  const c = buildDepthChart([bar('15:30', 1), bar('15:35', 2)], [trade({ entryDate: iso('15:33'), exitDate: iso('15:33') })]);
  const entry = c.markers[0];
  assert.equal(entry.time, barSeconds(iso('15:30')), 'the bar at or before the decision, not the one after');
});

test('a trade before the first bar is placed on the first bar, not dropped', () => {
  const c = buildDepthChart([bar('15:35', 1)], [trade({ entryDate: iso('15:00'), exitDate: iso('15:36') })]);
  assert.equal(c.unplaced, 0);
  assert.equal(c.markers[0].time, barSeconds(iso('15:35')));
});

test('no bars at all means every trade is UNPLACED and said so — not silently missing', () => {
  const c = buildDepthChart([], [trade(), trade({ entryDate: iso('16:00') })]);
  assert.equal(c.markers.length, 0);
  assert.equal(c.unplaced, 2);
});

test('markers are sorted by time — the library requires it, so input order cannot be trusted', () => {
  const c = buildDepthChart(
    [bar('15:30', 1), bar('15:40', 2), bar('15:50', 3)],
    [trade({ entryDate: iso('15:50'), exitDate: iso('15:55') }), trade({ entryDate: iso('15:30'), exitDate: iso('15:40') })],
  );
  const times = c.markers.map((m) => m.time);
  assert.deepEqual(times, [...times].sort((a, b) => a - b));
});

test('a refused trade is DRAWN and labelled — the engine still opened it', () => {
  const c = buildDepthChart([bar('15:30', 1)], [trade({ kept: false })]);
  assert.match(c.markers[0].text, /refused/);
  assert.equal(c.markers[0].color, '#6b7280');
});

test('direction decides which side the marker sits on, so a short is not read as a long', () => {
  const long = buildDepthChart([bar('15:30', 1)], [trade()]).markers[0];
  const short = buildDepthChart([bar('15:30', 1)], [trade({ direction: 'SHORT' })]).markers[0];
  assert.equal(long.position, 'belowBar');
  assert.equal(short.position, 'aboveBar');
});

test('levels are drawn ONLY for the trade alive at the pinned bar', () => {
  const bars = [bar('15:30', 1), bar('15:40', 2), bar('15:50', 3)];
  const trades = [
    trade({ entryDate: iso('15:30'), exitDate: iso('15:40'), stopLoss: 1.4, takeProfit: 1.5 }),
    trade({ entryDate: iso('15:50'), exitDate: iso('15:55'), entryPrice: 3, stopLoss: 2.9, takeProfit: 3.1 }),
  ];
  const none = buildDepthChart(bars, trades);
  assert.equal(none.levels.length, 0, 'no pin, no lines — a chart of levels nobody asked for');

  const pinned = buildDepthChart(bars, trades, { pinTime: iso('15:50') });
  assert.deepEqual(pinned.levels.map((l) => l.title), ['stop', 'target']);
  assert.deepEqual(pinned.levels.map((l) => l.price), [2.9, 3.1], 'the second trade\'s bracket, not the first');
});

test('an unrecorded stop or target draws NO line rather than a line at zero', () => {
  const c = buildDepthChart([bar('15:30', 1)], [trade({ stopLoss: null, takeProfit: null })], { pinTime: iso('15:30') });
  assert.equal(c.levels.length, 0);
});
