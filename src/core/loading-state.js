/**
 * loading-state.js — WHICH loading effect is honest for a given wait, and what a rail may show.
 * ================================================================================================
 * Extracted from the components so the rules are testable with `node --test` (the convention the rest of
 * `src/core` follows) instead of being asserted in a comment.
 *
 * ── THE DECISION, AND WHY IT IS A FUNCTION ──────────────────────────────────────────────────────
 * Decided 2026-11-23: three loading animations, because different situations call for different ones. The
 * danger with three options is that the choice becomes taste. It is not taste — it is a question about
 * what the client KNOWS:
 *
 *   shape known                  → skeleton (draw the layout that is coming, so nothing jumps)
 *   length known, shape not      → step rail (one segment per real step)
 *   neither known                → orbit (a wait with no layout and no count)
 *
 * ⚠️ SHAPE WINS over length. A table with a known row count still gets a skeleton: the reader is about
 * to see a table, and a rail would then be replaced by a layout change on top of the wait.
 *
 * ⚠️ THE RAIL REFUSES WITHOUT A REAL TOTAL. Owner, 2026-11-20, on this app: *"loading bars that aren't
 * actually based on something loading."* So `stepProgress()` returns `null` — not a 0%, not an
 * indeterminate sweep — when no real count exists. A bar filling on a timer is a number nobody
 * measured, and it looks exactly like a measurement.
 */

/**
 * Which effect the wait calls for.
 *
 * @param {{ shapeKnown?: boolean, length?: number|null }} facts
 *   shapeKnown — the final layout is known (a table, a card grid, a chart)
 *   length     — how many steps the work has, when that is genuinely countable
 * @returns {'skeleton'|'steps'|'orbit'}
 */
export function resolveLoadingMode({ shapeKnown = false, length = null } = {}) {
  if (shapeKnown) return 'skeleton';
  const n = Number(length);
  if (Number.isFinite(n) && n > 0) return 'steps';
  return 'orbit';
}

/**
 * What the rail may render.
 *
 * @returns {{ steps: number, at: number, complete: boolean, currentIndex: number } | null}
 *   `null` means NO REAL TOTAL — the caller must render the refusal sentence, never a bar.
 */
export function stepProgress(done, total) {
  const steps = Number.isFinite(Number(total)) ? Math.floor(Number(total)) : 0;
  if (steps < 1) return null;
  const at = Math.max(0, Math.min(Math.floor(Number(done) || 0), steps));
  return {
    steps,
    at,
    complete: at >= steps,
    /** The step in progress, or -1 once every step is complete. */
    currentIndex: at < steps ? at : -1,
  };
}
