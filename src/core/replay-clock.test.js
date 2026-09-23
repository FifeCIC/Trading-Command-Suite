/**
 * replay-clock.test.js — the replay's order and its refusal to invent a result (#819).
 * =================================================================================
 * Run with: `npm run test:replay-clock`
 *
 * The canary direction is the one that matters: a summary that counts an OPEN trade as a win
 * looks completely plausible on screen while being wrong, so the first test asserts an open trade
 * is not counted, and the second asserts "nothing closed yet" renders as null rather than 0%.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildReplayEvents,
  summarise,
  visibleRows,
  filterTrades,
  stepMsFor,
  clampCursor,
  REPLAY_SPEEDS,
} from './replay-clock.js';

const trade = (id, entryTime, exitTime, pnl) => ({
  id,
  direction: 'LONG',
  signal: 'BUY',
  entryScore: 6.6,
  entryTime,
  entryPrice: 100,
  exitTime,
  exitPrice: 101,
  exitReason: 'TP',
  positionSize: 1,
  pnl,
  pnlPct: 1,
});

const trades = [
  trade('a', '2026-07-27T08:00:00.000Z', '2026-07-27T10:00:00.000Z', 10),
  trade('b', '2026-07-27T12:00:00.000Z', '2026-07-27T14:00:00.000Z', -4),
  trade('c', '2026-07-28T09:00:00.000Z', '2026-07-28T11:00:00.000Z', 6),
];

test('an OPEN trade is not a result (both directions)', () => {
  const built = buildReplayEvents(trades);
  // After trade a's exit but before b's: a is closed, b and c untouched.
  const atExitA = summarise(built, 2);
  assert.equal(atExitA.taken, 1);
  assert.equal(atExitA.open, 0);
  assert.equal(atExitA.closed, 1);
  assert.equal(atExitA.wins, 1);

  // After b ENTERED but before b exited: b is open, and must not count as a loss yet.
  const atEntryB = summarise(built, 3);
  assert.equal(atEntryB.taken, 2);
  assert.equal(atEntryB.open, 1, 'b is open');
  assert.equal(atEntryB.closed, 1, 'only a has closed');
  assert.equal(atEntryB.losses, 0, 'an open trade is not a loss');
  assert.equal(atEntryB.realisedPnl, 10, 'only realised P&L counts');

  // And in the other direction: once b exits, it IS counted.
  const atExitB = summarise(built, 4);
  assert.equal(atExitB.closed, 2);
  assert.equal(atExitB.losses, 1);
  assert.equal(atExitB.realisedPnl, 6);
});

test('"nothing closed yet" is null, never 0%', () => {
  const built = buildReplayEvents(trades);
  const atStart = summarise(built, 0);
  assert.equal(atStart.closed, 0);
  assert.equal(atStart.winRatePct, null, 'absence of information, not a bad score');
  assert.equal(summarise(built, 2).winRatePct, 100);
  const all = summarise(built, 'instant');
  assert.equal(all.closed, 3);
  assert.equal(all.winRatePct, 66.7);
});

test('events are ordered entry-then-exit, and a broken pair is reported not reordered', () => {
  const built = buildReplayEvents([
    ...trades,
    trade('bad-time', '2026-07-29T10:00:00.000Z', '2026-07-29T09:00:00.000Z', 1),
    { id: 'no-time', entryTime: null, exitTime: null, pnl: 0 },
  ]);
  assert.equal(built.unusable.length, 2, 'both unusable trades are reported');
  assert.equal(summarise(built, 'instant').unusable, 2);
  // 3 trades × 2 events, and every entry precedes its own exit.
  assert.equal(built.events.length, 6);
  for (let i = 0; i < built.events.length - 1; i++) {
    assert.ok(built.events[i].at <= built.events[i + 1].at, 'time order is monotonic');
  }
  const firstEntry = built.events.findIndex((e) => e.kind === 'entry' && e.trade.id === 'a');
  const firstExit = built.events.findIndex((e) => e.kind === 'exit' && e.trade.id === 'a');
  assert.ok(firstEntry < firstExit);
});

test('the cursor is clamped, and instant reveals everything', () => {
  const built = buildReplayEvents(trades);
  assert.equal(clampCursor(-5, 6), 0);
  assert.equal(clampCursor(99, 6), 6);
  assert.equal(clampCursor('instant', 6), 6);
  assert.equal(summarise(built, 'instant').eventsShown, 6);
});

test('rows show what is revealed, newest first, and mark open trades', () => {
  const built = buildReplayEvents(trades);
  const rows = visibleRows({ trades }, 3);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].trade.id, 'b', 'newest first');
  assert.equal(rows[0].entered, true);
  assert.equal(rows[0].exited, false, 'b is still open at this cursor');
  assert.equal(rows[1].trade.id, 'a');
  assert.equal(rows[1].exited, true);
  assert.equal(built.events.length, 6);
});

test('an unset filter is not a filter', () => {
  assert.equal(filterTrades(trades, {}).length, 3);
  assert.equal(filterTrades(trades, { direction: 'LONG' }).length, 3);
  assert.equal(filterTrades(trades, { direction: 'SHORT' }).length, 0);
  assert.equal(filterTrades(trades, { exitReason: 'TP' }).length, 3);
  assert.equal(filterTrades(trades, { exitReason: 'SL' }).length, 0);
});

test('the speed ladder is ordered and instant does not schedule', () => {
  assert.deepEqual(REPLAY_SPEEDS, [1, 10, 100, 'instant']);
  assert.equal(stepMsFor('instant'), 0);
  assert.ok(stepMsFor(1) > stepMsFor(10));
  assert.ok(stepMsFor(10) > stepMsFor(100));
  assert.ok(stepMsFor(100) >= 20, 'never schedules a 0ms timer');
});
