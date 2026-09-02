/**
 * RoadmapCore unit tests — run with `node --test` (npm run test:roadmap).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  roundPosition,
  midpointPosition,
  insertPosition,
  rebalancePositions,
  applyMove,
  validateMove,
  sortCardsByPosition,
} from './roadmap-core.js';

const COLUMNS = ['phase-1', 'phase-2', 'phase-3', 'roadmap', 'triage'];

test('roundPosition keeps 6dp precision', () => {
  assert.equal(roundPosition(1.5), 1.5);
  assert.equal(roundPosition(1.0000005), 1.000001);
  assert.equal(roundPosition(0.3333333333), 0.333333);
});

test('midpointPosition — basic halves', () => {
  assert.equal(midpointPosition(1, 2), 1.5);
  assert.equal(midpointPosition(1.5, 2), 1.75);
  assert.equal(midpointPosition(1, 1.5), 1.25);
});

test('midpointPosition — exhausted gap returns null', () => {
  assert.equal(midpointPosition(1, 1.000001), null);
  assert.equal(midpointPosition(1.000001, 1.000002), null);
});

test('insertPosition — empty, top, bottom, middle', () => {
  assert.deepEqual(insertPosition([], 0), { position: 1, needsRebalance: false });
  assert.deepEqual(insertPosition([1, 2, 3], 0), { position: 0, needsRebalance: false });
  assert.deepEqual(insertPosition([1, 2, 3], 3), { position: 4, needsRebalance: false });
  assert.deepEqual(insertPosition([1, 2, 3], 1), { position: 1.5, needsRebalance: false });
});

test('insertPosition — nested insertion keeps fractional keys (no renumbering)', () => {
  let positions = [1, 2];
  const insert = insertPosition(positions, 1); // between 1 and 2
  assert.equal(insert.position, 1.5);
  assert.equal(insert.needsRebalance, false);
  positions = [1, 1.5, 2];
  const deeper = insertPosition(positions, 1); // between 1 and 1.5
  assert.equal(deeper.position, 1.25);
});

test('insertPosition — exhausted gap requests rebalance', () => {
  const positions = [1, 1.000001];
  const r = insertPosition(positions, 1);
  assert.equal(r.needsRebalance, true);
});

test('rebalancePositions — integer steps', () => {
  assert.deepEqual(rebalancePositions(3), [1, 2, 3]);
});

test('applyMove — midpoint move keeps neighbours untouched', () => {
  const cards = [
    { number: 1, columnId: 'phase-2', position: 1 },
    { number: 2, columnId: 'phase-2', position: 2 },
    { number: 3, columnId: 'phase-2', position: 3 },
  ];
  const moved = applyMove(cards, 3, 'phase-2', 1); // move #3 between #1 and #2
  assert.equal(moved.rebalanced, false);
  const byNumber = new Map(moved.positions.map((p) => [p.number, p.position]));
  assert.equal(byNumber.get(1), 1); // neighbours untouched
  assert.equal(byNumber.get(2), 2);
  assert.equal(byNumber.get(3), 1.5);
});

test('applyMove — exhausted gap rebalances the whole column', () => {
  const cards = [
    { number: 1, columnId: 'phase-2', position: 1 },
    { number: 2, columnId: 'phase-2', position: 1.000001 },
    { number: 3, columnId: 'phase-2', position: 2 },
  ];
  const moved = applyMove(cards, 3, 'phase-2', 1); // squeeze between #1 and #2
  assert.equal(moved.rebalanced, true);
  assert.deepEqual(
    moved.positions.sort((a, b) => a.position - b.position).map((p) => p.number),
    [1, 3, 2],
  );
  assert.deepEqual(moved.positions.map((p) => p.position).sort((a, b) => a - b), [1, 2, 3]);
});

test('validateMove — same-column blocker above the card is fine', () => {
  const cards = [
    { number: 10, columnId: 'phase-3', position: 1 },
    { number: 20, columnId: 'phase-3', position: 2 },
  ];
  const blockedByMap = { 20: [10] };
  const r = validateMove(cards, blockedByMap, 20, 'phase-3', 2, COLUMNS);
  assert.equal(r.ok, true);
});

test('validateMove — refuses dropping above its blocker', () => {
  const cards = [
    { number: 10, columnId: 'phase-3', position: 1 },
    { number: 20, columnId: 'phase-3', position: 2 },
  ];
  const blockedByMap = { 20: [10] };
  const r = validateMove(cards, blockedByMap, 20, 'phase-3', 0, COLUMNS);
  assert.equal(r.ok, false);
  assert.match(r.violations.join(' '), /must sit above/);
});

test('validateMove — blocker in an earlier column is fine, later column refused', () => {
  const cards = [
    { number: 10, columnId: 'phase-3', position: 1 }, // blocker
    { number: 20, columnId: 'phase-1', position: 1 }, // blocked
  ];
  const blockedByMap = { 20: [10] };
  // Moving INTO the blocker's column, below it, is fine.
  const ok = validateMove(cards, blockedByMap, 20, 'phase-3', 1, COLUMNS);
  assert.equal(ok.ok, true);
  // Staying in a column LEFT of its blocker is refused.
  const bad = validateMove(cards, blockedByMap, 20, 'phase-1', 0, COLUMNS);
  assert.equal(bad.ok, false);
  assert.match(bad.violations.join(' '), /later column/);
});

test('validateMove — self-block and unknown blockers', () => {
  const cards = [{ number: 5, columnId: 'phase-1', position: 1 }];
  assert.equal(validateMove(cards, { 5: [5] }, 5, 'phase-1', 0, COLUMNS).ok, false);
  // Unknown blocker (e.g. closed issue) must not hard-block the board.
  assert.equal(validateMove(cards, { 5: [999] }, 5, 'phase-1', 0, COLUMNS).ok, true);
});

test('sortCardsByPosition — column then position', () => {
  const cards = [
    { number: 1, columnId: 'phase-2', position: 2 },
    { number: 2, columnId: 'phase-2', position: 1 },
    { number: 3, columnId: 'phase-1', position: 99 },
  ];
  const sorted = sortCardsByPosition(cards).map((c) => c.number);
  assert.deepEqual(sorted, [3, 2, 1]);
});
