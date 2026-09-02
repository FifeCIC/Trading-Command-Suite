/**
 * RoadmapCore — pure, portable planning logic (epic #681, Phase C).
 * =====================================================================
 * Zero TCS imports, zero DOM. The ordering + dependency rules every
 * future project gets for free:
 *
 *   - Fractional indexing: `position DECIMAL(20,6)` per column.
 *     Inserting between neighbours creates the midpoint; when the gap is
 *     exhausted the column rebalances at integer steps — neighbours are
 *     never re-numbered globally.
 *   - Dependencies: top-to-bottom order within a column is the sequence;
 *     explicit `blockedBy` covers cross-column edges. A card may never
 *     sit above (or in a column right of) its blockers.
 */

const DECIMALS = 6;
const STEP = 1 / 10 ** DECIMALS; // 1e-6

/** Round to the position scale (6dp, matching DECIMAL(20,6)). */
export function roundPosition(value) {
  return Math.round(value * 10 ** DECIMALS) / 10 ** DECIMALS;
}

/**
 * Midpoint between two neighbouring positions.
 * Returns null when the gap is exhausted (midpoint collapses onto a
 * neighbour) — the caller must rebalance the column.
 */
export function midpointPosition(a, b) {
  const m = roundPosition((a + b) / 2);
  if (m === a || m === b) return null;
  return m;
}

/**
 * Position for inserting at `index` into a column whose existing
 * positions are `sortedPositions` (ascending).
 *
 * Returns `{ position, needsRebalance }` — when needsRebalance is true
 * the caller should re-run the column with integer steps.
 */
export function insertPosition(sortedPositions, index) {
  if (sortedPositions.length === 0) return { position: 1, needsRebalance: false };
  if (index <= 0) return { position: roundPosition(sortedPositions[0] - 1), needsRebalance: false };
  if (index >= sortedPositions.length) {
    return { position: roundPosition(sortedPositions[sortedPositions.length - 1] + 1), needsRebalance: false };
  }
  const m = midpointPosition(sortedPositions[index - 1], sortedPositions[index]);
  if (m == null) return { position: (sortedPositions[index - 1] + sortedPositions[index]) / 2, needsRebalance: true };
  return { position: m, needsRebalance: false };
}

/** Integer-step positions for a rebalanced column: 1.00, 2.00, … */
export function rebalancePositions(count) {
  return Array.from({ length: count }, (_, i) => roundPosition(i + 1));
}

/**
 * Compute the new state for a column after moving `cardNumber` into it
 * at `targetIndex` (0 = top). Handles top/bottom/midpoint inserts and
 * rebalances the column when a gap is exhausted.
 *
 * Returns `{ positions, rebalanced }` where `positions` is an array of
 * `{ number, position }` for EVERY card in the target column (final
 * order) — the caller writes them back.
 */
export function applyMove(cards, cardNumber, targetColumnId, targetIndex) {
  const moving = cards.find((c) => c.number === cardNumber);
  const columnCards = cards
    .filter((c) => c.columnId === targetColumnId && c.number !== cardNumber)
    .sort((a, b) => a.position - b.position);

  const idx = Math.max(0, Math.min(targetIndex, columnCards.length));
  const existingPositions = columnCards.map((c) => c.position);
  const insert = insertPosition(existingPositions, idx);

  const finalOrder = [...columnCards];
  finalOrder.splice(idx, 0, moving);

  let positions;
  let rebalanced = false;
  if (insert.needsRebalance) {
    const steps = rebalancePositions(finalOrder.length);
    positions = finalOrder.map((c, i) => ({ number: c.number, position: steps[i] }));
    rebalanced = true;
  } else {
    positions = [
      ...columnCards.map((c) => ({ number: c.number, position: c.position })),
      { number: cardNumber, position: roundPosition(insert.position) },
    ];
  }
  return { positions, rebalanced, targetIndex: idx };
}

/**
 * Dependency enforcement — can `cardNumber` sit at `targetIndex` in
 * `targetColumnId`?
 *
 * `blockedByMap`: { [cardNumber]: number[] } — blocker issue numbers.
 * `columnOrder`: column ids left → right.
 *
 * A move is valid when every blocker is either:
 *   - in an earlier (left) column, or
 *   - in the same column but ABOVE the moving card in the final order.
 *
 * Returns `{ ok, violations }` — violations are human-readable strings.
 */
export function validateMove(cards, blockedByMap, cardNumber, targetColumnId, targetIndex, columnOrder) {
  const blockers = blockedByMap[cardNumber] || [];
  const violations = [];
  const colIndex = new Map(columnOrder.map((id, i) => [id, i]));
  const targetColIdx = colIndex.get(targetColumnId) ?? 0;

  // Final order of the target column AFTER the move.
  const finalOrder = cards
    .filter((c) => c.columnId === targetColumnId && c.number !== cardNumber)
    .sort((a, b) => a.position - b.position);
  finalOrder.splice(Math.max(0, Math.min(targetIndex, finalOrder.length)), 0, { number: cardNumber });

  for (const blockerNumber of blockers) {
    if (blockerNumber === cardNumber) {
      violations.push(`#${cardNumber} cannot block itself`);
      continue;
    }
    const blocker = cards.find((c) => c.number === blockerNumber);
    if (!blocker) {
      // Unknown blocker (closed/archived?) — don't hard-block the board.
      continue;
    }
    const blockerColIdx = colIndex.get(blocker.columnId) ?? targetColIdx;
    if (blockerColIdx < targetColIdx) continue; // earlier column — fine
    if (blockerColIdx > targetColIdx) {
      violations.push(`Blocked by #${blockerNumber} (in a later column — move that column first)`);
      continue;
    }
    // Same column: blocker must appear ABOVE the moving card.
    const blockerFinalIdx = finalOrder.findIndex((c) => c.number === blockerNumber);
    const movingFinalIdx = finalOrder.findIndex((c) => c.number === cardNumber);
    if (blockerFinalIdx === -1 || blockerFinalIdx >= movingFinalIdx) {
      violations.push(`Blocked by #${blockerNumber} — it must sit above this card`);
    }
  }
  return { ok: violations.length === 0, violations };
}

/** Stable ordering helper: cards within a column, top → bottom. */
export function sortCardsByPosition(cards) {
  return [...cards].sort((a, b) => {
    if (a.columnId !== b.columnId) return a.columnId.localeCompare(b.columnId);
    return (a.position ?? 0) - (b.position ?? 0);
  });
}
