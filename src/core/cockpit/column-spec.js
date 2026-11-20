/**
 * column-spec.js — THE SHARED SEAM a cockpit is built from.
 *
 * ── WHAT THIS IS FOR ────────────────────────────────────────────────────────────────────────────
 * The existing `/development/meta-stack-cockpit` renders **seven hardcoded columns** in a 27 KB page.
 * That is fine as one screen and useless as a pattern: a second cockpit (for the movers strategy, for a
 * future strategy) would be a second 27 KB page, and the two would drift the way every duplicated
 * surface in this repo has drifted.
 *
 * So a cockpit is declared as a **spec**: an ordered list of columns, each naming a META.Stack phase, a
 * renderer, and what the column will contain. `buildColumnSpec()` refuses a spec that cannot be
 * rendered, so a column named but not implemented fails loudly instead of rendering an empty box that
 * reads as "no data".
 *
 * ⚠️ IT IS A SPEC, NOT A FRAMEWORK. No plugin registry, no dynamic loading, no layout engine. A
 * renderer is a React component; the page maps the spec to JSX. Small enough to delete if the idea does
 * not earn its keep.
 *
 * ⚠️ AND IT IS NOT THE BACKTEST PAGE'S LAYOUT. That page stacks sections. A cockpit is a different
 * surface with a different constraint (columns across monitors); what the two share is the PHASE LIST,
 * which is `pipeline-phases.js`.
 */
import { PIPELINE_PHASES, phaseById } from '../pipeline-phases.js';

/** Every column must reach one of these states. `ready` is the only one that renders data. */
export const COLUMN_STATES = Object.freeze(['ready', 'skeleton', 'absent']);

/**
 * Build a column spec from the canonical phase list, with a per-phase declaration.
 *
 * @param {Record<string, { state: string, renderer?: Function, note?: string }>} byPhase
 * @returns {{ columns: Array, problems: string[] }}
 */
export function buildColumnSpec(byPhase) {
  const problems = [];
  const columns = [];

  for (const phase of PIPELINE_PHASES) {
    const entry = byPhase[phase.id];
    if (!entry) {
      // Silence is the defect this function exists to prevent: an omitted phase must not look like a
      // phase that simply had nothing to show.
      problems.push(`${phase.id}: no column declared — say 'skeleton' or 'absent' explicitly`);
      continue;
    }
    if (!COLUMN_STATES.includes(entry.state)) {
      problems.push(`${phase.id}: state '${entry.state}' is not one of ${COLUMN_STATES.join(', ')}`);
      continue;
    }
    if (entry.state === 'ready' && typeof entry.renderer !== 'function') {
      problems.push(`${phase.id}: state 'ready' but no renderer — it would render an empty column`);
      continue;
    }
    if ((entry.state === 'absent' || entry.state === 'skeleton') && !entry.note) {
      problems.push(`${phase.id}: '${entry.state}' needs a note saying what is missing`);
      continue;
    }
    columns.push({
      id: phase.id,
      label: phase.label,
      provides: phase.provides,
      state: entry.state,
      renderer: entry.renderer ?? null,
      note: entry.note ?? null,
    });
  }

  return { columns, problems };
}

/** One line describing coverage, for a skeleton's own header — never "0 of 15" hidden in a chart. */
export function columnSummary(columns) {
  const ready = columns.filter((c) => c.state === 'ready').length;
  const skeleton = columns.filter((c) => c.state === 'skeleton').length;
  const absent = columns.filter((c) => c.state === 'absent').length;
  return `${ready} column(s) render data · ${skeleton} named but unbuilt · ${absent} not applicable to this surface`;
}

/** Every phase a spec must account for — exported so a guard can assert coverage. */
export const REQUIRED_PHASES = PIPELINE_PHASES.map((p) => p.id);

export { phaseById };
