/**
 * decision-display.js — the ONE vocabulary for a decision row (#971).
 * ==================================================================
 *
 * WHY THIS EXISTS
 * ---------------
 * `decision_log.decision` carries claims that were previously ALL spelled 'SCORED':
 *
 *   OBSERVED            the ladder scored this symbol and NOBODY consumes the row. An
 *                       observation. Nothing will ever trade it — and that is the fact the
 *                       value now states, rather than something a reader must infer.
 *   SCORED              a BOT scored a signal it may act on (a consumer exists).
 *   BLOCKED / SKIP      a consumer existed and REFUSED (gate, duplicate guard, market closed).
 *   QUEUED / EXECUTED / FAILED / PYRAMID
 *                       the signal reached the order path.
 *
 * ⚠️ THE DEFECT THIS CLOSES. Before #971 the ladder wrote `decision: 'SCORED'` together with
 * `strategyId: ''`, so "nothing reads this" had to be INFERRED from an empty column — and 539 of
 * 577 scored rows sat in that state. Three pages each carried a private colour map that had to be
 * edited independently to even notice. The value is now the claim; `isObservation()` is the one
 * reader of it; the palette below is the one map.
 *
 * ⚠️ HISTORICAL ROWS. Rows written before #971 still hold 'SCORED' with `strategyId = ''`.
 * `isObservation()` treats an empty strategyId as an observation, so the distinction is
 * answerable across the whole table WITHOUT rewriting log history.
 */

export const OBSERVATION_MARKER = 'OBSERVED';

/**
 * Every value a writer may emit. Kept as a list (not just an object) so a test can assert the
 * palette covers all of them — a marker with no colour renders as "unknown", which is the
 * silent-grey defect this module exists to prevent.
 */
export const CANONICAL_DECISION_VALUES = [
  'OBSERVED', 'SCORED', 'SIGNAL', 'QUEUED', 'EXECUTED', 'FAILED', 'BLOCKED', 'SKIP',
  'PYRAMID', 'HOLD',
];

/** The single palette. `OBSERVED` is deliberately the muted slate of "no action", not a
 *  status colour — it must not be mistaken for a signal that did something. */
export const DECISION_COLORS = {
  OBSERVED: '#94a3b8',
  SCORED: '#3b82f6',
  SIGNAL: '#3b82f6',
  QUEUED: '#a855f7',
  EXECUTED: '#22c55e',
  FAILED: '#ef4444',
  BLOCKED: '#f59e0b',
  SKIP: '#64748b',
  PYRAMID: '#22c55e',
  HOLD: '#94a3b8',
};

const UNKNOWN_COLOR = 'var(--ink-soft)';

/** Only values whose human label is NOT the raw value are listed here. */
const LABEL_OVERRIDES = { OBSERVED: 'OBSERVED · no consumer' };

/**
 * isObservation(row) — true when NOTHING consumes this row.
 * Accepts the marker, and a pre-#971 row (SCORED + no strategyId).
 */
export function isObservation(row) {
  if (!row) return false;
  if (row.decision === OBSERVATION_MARKER) return true;
  return row.decision === 'SCORED' && !row.strategyId;
}

/** decisionColor(decision) — palette lookup with an explicit neutral fallback. */
export function decisionColor(decision) {
  return DECISION_COLORS[decision] || UNKNOWN_COLOR;
}

/** decisionLabel(decision) — the words shown to a human. */
export function decisionLabel(decision) {
  if (!decision) return '—';
  return LABEL_OVERRIDES[decision] || decision;
}
