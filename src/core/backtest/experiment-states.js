/**
 * experiment-states.js — "what IS this backtest experiment, and does it need attention?" (#1295).
 *
 * ⚠️ ONE DEFINITION, THREE CONSUMERS. The CLI (`scripts/report-experiments.cjs --backtest`) and the
 * page (`/lab/backtest-experiments`) both answer this question, and an agent reading either must get
 * the same answer. A second copy of the rule would agree today and drift at the first tuning — the
 * repo's most expensive failure shape.
 *
 * So it lives here, in `src/core/`, which BOTH can load: the page imports it as an ES module, and the
 * Node CLI `import()`s the same file (Node resolves `.js` ESM from a CJS script).
 *
 * ── THE FOUR STATES ARE GENUINELY DIFFERENT ────────────────────────────────────────────────────
 *
 *   SHELL       0 runs. An empty `running` loop reads as work in progress to every future reader.
 *               Either fill it or close it.
 *   SINGLE      1 run. One run is not a comparison — there is nothing to compare it TO.
 *   AUTO        the #1295 bucket that unnamed runs land in. It has runs, but it is NOT a deliberate
 *               comparison, and counting it as one would flatter the registry.
 *   COMPARISON  2+ runs and created by a person. This is the only state that is the thing the
 *               registry exists for.
 *
 * ⚠️ AUTO IS TESTED BEFORE THE RUN COUNT, on purpose. An auto bucket with 900 runs would otherwise
 * be classified COMPARISON and read as the most important experiment in the list.
 */

/**
 * @param {{ runs?: unknown, createdBy?: unknown, status?: unknown, createdAt?: unknown }} e
 * @returns {'SHELL'|'SINGLE'|'AUTO'|'COMPARISON'}
 */
export function classifyExperiment(e) {
  if (String(e?.createdBy ?? '') === 'system') return 'AUTO';
  const runs = Number(e?.runs ?? 0);
  // A null/NaN run count is unknown, and unknown must not be read as "has runs". 0 is the safe
  // reading: it asks the reader to look, whereas SINGLE silently accepts a blank.
  if (!Number.isFinite(runs) || runs <= 0) return 'SHELL';
  if (runs === 1) return 'SINGLE';
  return 'COMPARISON';
}

/** Sort order: things needing attention first. AUTO sits after the actionable states. */
const ORDER = { SHELL: 0, SINGLE: 1, AUTO: 2, COMPARISON: 3 };

export const EXPERIMENT_STATE_ORDER = ORDER;

/**
 * The label a reader sees. Kept beside the classifier so a new state cannot be added without a label.
 */
export const EXPERIMENT_STATE_LABEL = {
  SHELL: 'never used',
  SINGLE: 'one run only',
  AUTO: 'unfiled bucket',
  COMPARISON: 'comparison',
};

/** What to do about it. `null` for COMPARISON — the thing that works needs no instruction. */
export const EXPERIMENT_STATE_NEXT_STEP = {
  SHELL: 'Opened and never used: fill it with a run, or close it — an empty running loop reads as work in progress.',
  SINGLE: 'One run is not a comparison: add the arm(s) it should be compared against.',
  AUTO: 'Runs nobody named, grouped so they stay findable. Adopt a run into a real experiment, or delete the bucket.',
  COMPARISON: null,
};

/**
 * Group + count. Returns rows already ordered, plus the counts a summary line needs.
 *
 * ⚠️ THROWS on a payload with no array, rather than returning an empty summary. "No experiments" and
 * "could not read the answer" must never look the same — that is how a registry silently empties.
 */
export function summariseExperiments(payload, now = Date.now()) {
  if (!payload || !Array.isArray(payload.experiments)) {
    throw new Error('payload has no experiments array — cannot judge, and an empty list would lie');
  }
  const rows = payload.experiments.map((e) => {
    const state = classifyExperiment(e);
    const runs = Number(e?.runs ?? 0);
    const ageDays = e?.createdAt
      ? Math.floor((now - new Date(e.createdAt).getTime()) / 86_400_000)
      : null;
    return {
      id: String(e?.id ?? ''),
      state,
      label: String(e?.label ?? '(no label)'),
      protocolId: String(e?.protocolId ?? '?'),
      status: String(e?.status ?? '?'),
      runs: Number.isFinite(runs) ? runs : 0,
      ageDays,
    };
  });
  rows.sort((a, b) => ORDER[a.state] - ORDER[b.state] || (b.ageDays ?? 0) - (a.ageDays ?? 0));

  const count = (s) => rows.filter((r) => r.state === s).length;
  return {
    rows,
    total: rows.length,
    shells: count('SHELL'),
    singles: count('SINGLE'),
    autos: count('AUTO'),
    comparisons: count('COMPARISON'),
    protocols: new Set(rows.map((r) => r.protocolId)).size,
    // The number that proves filing is working. A registry that reports this is one nobody has to
    // trust a script to check.
    needsAttention: count('SHELL') + count('SINGLE'),
  };
}
