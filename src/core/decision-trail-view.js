/**
 * decision-trail-view.js — the three ways to show OBSERVATIONS on the Decision Trail (#R12).
 * =========================================================================================
 *
 * WHY THIS IS PURE AND SEPARATE
 * -----------------------------
 * It decides what the reader SEES, and the expensive failure here is not a crash — it is a reader
 * concluding "nothing was decided" from a list that was quietly filtered. So the rules live in one
 * testable place:
 *
 *   **A decision row is NEVER hidden by any mode.** Only observations — rows with no consumer —
 *   are ever grouped or dropped. If a mode could hide a decision, the page would be lying about
 *   the one thing it exists to show.
 *
 *   **A filtered list always says how much it filtered.** `counts.hidden` is not decoration: in
 *   hide-mode the page renders it, because an empty-looking list and an empty list must never
 *   read the same (repo doctrine: absence of information ≠ a bad result).
 *
 * The three modes are the owner's own three options (review row R8, decided as R12):
 *   **A · chip**     — show every row; an observation carries the "no consumer" chip. (What exists.)
 *   **B · hide**     — observations out of the way, with the hidden count stated.
 *   **C · collapse** — observations folded into ONE line per tick; decisions still get a full card.
 *
 * ⚠️ Measured context that makes this matter: at the time of writing, the 12 most recent rows were
 * ALL observations — the log's majority. They crowd out the rows that actually did something.
 */

import { isObservation } from './decision-display.js';
import { decisionScore } from './decision-score.js';

export const OBSERVATION_MODES = ['A', 'B', 'C'];

/**
 * The mode the page shows when the URL says nothing.
 *
 * ⚠️ Set to **C** from the owner's own reading, 2026-09-23: *"I like C · collapse — but only because
 * A is highly repetitive, they all say OBSERVED"*.
 */
export const DEFAULT_OBSERVATION_MODE = 'C';

export const MODE_INFO = {
  A: {
    label: 'A · chip',
    title: 'Every row, a chip marks the ones nothing consumes',
    desc: 'Nothing is hidden. Reads as a long list, because most rows are observations.',
  },
  B: {
    label: 'B · hide',
    title: 'Only the rows where something happened',
    desc: 'Answers “what did the system actually DO?” — and says how many rows it left out.',
  },
  C: {
    label: 'C · collapse',
    title: 'What happened, plus one line per batch of scores nobody could act on',
    desc: 'Answers both questions at once, with the strongest unused score named per batch.',
  },
};

/** An observation is a row nothing consumes (#971). A decision row is everything else. */
export function isObservationRow(trail) {
  return isObservation(trail);
}

/** The key observations are grouped by in mode C. A tick is identified by its timestamp. */
function tickKey(trail) {
  return trail?.timestamp || `${trail?.symbol ?? '?'}`;
}

/**
 * applyObservationMode(trails, mode) → { rows, counts }
 *
 * `rows` is a list of `{ type: 'trail', trail }` or `{ type: 'group', key, at, observations }`.
 * An unrecognised mode falls back to A rather than rendering nothing.
 */
export function applyObservationMode(trails = [], mode = DEFAULT_OBSERVATION_MODE) {
  const list = Array.isArray(trails) ? trails : [];
  const effective = OBSERVATION_MODES.includes(mode) ? mode : DEFAULT_OBSERVATION_MODE;

  const observations = list.filter((t) => isObservationRow(t));
  const decisions = list.filter((t) => !isObservationRow(t));

  const counts = {
    total: list.length,
    observations: observations.length,
    decisions: decisions.length,
    hidden: 0,
    groups: 0,
    // The one number a reader must never have to infer: was anything left out?
    filtered: false,
  };

  if (effective === 'B') {
    counts.hidden = observations.length;
    counts.filtered = observations.length > 0;
    return { rows: decisions.map((trail) => ({ type: 'trail', trail })), counts };
  }

  if (effective === 'C') {
    const byTick = new Map();
    for (const trail of observations) {
      const key = tickKey(trail);
      const group = byTick.get(key) ?? { type: 'group', key, at: trail.timestamp ?? null, observations: [] };
      group.observations.push(trail);
      byTick.set(key, group);    }
    counts.groups = byTick.size;
    // ⚠️ The owner's reading of the first version, 2026-09-23: "this looks like a list of symbols
    // that have X amount of scores" — a count and a symbol list is a tally, not information. So a
    // group also carries the STRONGEST score in it: the actionable half of the row is "your ladder
    // produced 59% BUY on EURUSD and no bot is watching", which a tally cannot say.
    for (const group of byTick.values()) {
      let best = null;
      for (const trail of group.observations) {
        const score = decisionScore(trail);
        if (score.value === null) continue;
        if (!best || score.value > best.value) {
          best = { value: score.value, text: score.text, symbol: trail.symbol ?? '?', signal: trail.signal ?? null };
        }
      }
      group.strongest = best;
    }
    // Order: keep the incoming order, replacing a run of observations with its group at the
    // position of the FIRST observation in that run. The page's order is recency.
    const seen = new Set();
    const rows = [];
    for (const trail of list) {
      if (!isObservationRow(trail)) {
        rows.push({ type: 'trail', trail });
        continue;
      }
      const key = tickKey(trail);
      if (seen.has(key)) continue;
      seen.add(key);
      rows.push(byTick.get(key));
    }
    return { rows, counts };
  }

  return { rows: list.map((trail) => ({ type: 'trail', trail })), counts };
}
