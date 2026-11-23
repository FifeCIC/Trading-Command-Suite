/**
 * backtest-unused-fields.js — WHAT THE PIPELINE RECORDS AND THIS PAGE DOES NOT SHOW (#1340).
 *
 * ── WHY A DECLARATION, AND WHY THAT IS SAFE HERE ─────────────────────────────────────────────────
 * Owner requirement, 2026-11-23: list what the protocols and bots already record and the backtesting
 * page does not use, so a decision about what to surface can be made from the data rather than from
 * memory.
 *
 * Whether a field is USED cannot be computed at runtime — it is a fact about the source, not about the
 * payload. So the list is declared. What keeps it honest is that every VALUE is read from the live run:
 * when a field stops being returned, the row says **"not returned by this run"** rather than showing a
 * stale example. A declaration whose evidence is live cannot quietly become fiction; it goes visibly
 * blank.
 *
 * ⚠️ MEASURED, NOT REMEMBERED. Every path below was confirmed by counting its occurrences across the
 * movers page and its four panels on 2026-11-23: `rankingProvider`, `candidates`, `priorSessions`,
 * `sideSource`, `datasetSide`, `fillGap` and `admission` were each **0** (or comment-only).
 * `exitDivergence`, `caveats`, `comparison`, `selectionRun`, `best`, and the two per-symbol exclusion
 * counts ARE rendered and are therefore NOT listed.
 *
 * ⚠️ ONLY PATHS THIS PAYLOAD ACTUALLY CARRIES. `runCounters`, `sharpeRatio` and `maxDrawdown` are
 * recorded on the per-symbol `backtestrun`, not on a selection run — listing them here would put a
 * permanently-absent row in a table whose whole job is to show what is available.
 */

/** One row per field the run returns and the page does not show. */
export const UNUSED_FIELD_INVENTORY = [
  {
    path: 'rankingProvider',
    label: 'Ranking provider',
    tells:
      'Which provider ranked the day\'s candidates, and whether it was ambiguous. A different provider '
      + 'is a different candidate list — the run is not comparable with one ranked by another.',
  },
  {
    path: 'candidates',
    label: 'Candidates the ranker could choose from',
    tells:
      'The full list before the top-N cut. It shows whether a pick won a contest or was the only '
      + 'option, which is the difference between a strategy and an artefact of a short list.',
  },
  {
    path: 'priorSessions',
    label: 'Warm-up sessions',
    tells:
      'How many earlier sessions the directives read before the day being measured. A day with fewer '
      + 'warm-up sessions is measured on colder indicators, and the result says nothing about that today.',
  },
  {
    path: 'sideSource',
    label: 'Where the direction came from',
    tells:
      'Whether LONG/SHORT came from the protocol, the dataset or an override. A run whose side was '
      + 'guessed is not a run of the strategy the reader thinks.',
  },
  {
    path: 'datasetSide',
    label: 'The dataset\'s own side',
    tells:
      'Whether the day list was built from winners or losers. Shown beside `sideSource` it makes a '
      + 'disagreement between them visible instead of silent.',
  },
  {
    path: 'fillGap',
    label: 'Stop-fill gap',
    tells:
      'How far past each stop level the bar actually traded — the assumption the engine makes when it '
      + 'fills a stop exactly at the level. ⚠️ Computed on every run and shown nowhere. `measured: 0` '
      + 'means this run had no stop exit to measure, not that the gap was zero.',
  },
  {
    path: 'admission',
    label: 'Portfolio admission',
    tells:
      'Present only in `admission: portfolio` mode: how many trades the bot could not have taken, and '
      + 'why (cooldown vs position cap). Null in the default independent mode, which is why it reads as '
      + 'absent here.',
  },
];

/**
 * Resolve `a.b` against a payload without throwing.
 *
 * ⚠️ A MISSING PATH RETURNS `undefined`, and the panel renders that as "not returned by this run" —
 * never as `0`, `—` or an empty string. "No value" and "the value is zero" are different claims.
 */
export function readPath(payload, path) {
  if (!payload || typeof path !== 'string' || path === '') return undefined;
  let node = payload;
  for (const key of path.split('.')) {
    if (node == null || typeof node !== 'object') return undefined;
    node = node[key];
  }
  return node;
}

/**
 * The inventory as display rows for one run.
 *
 * `present` is what makes drift visible: a declared field the run no longer returns is reported as
 * absent rather than silently omitted from the table.
 */
export function inventoryRows(payload, inventory = UNUSED_FIELD_INVENTORY) {
  return inventory.map((item) => {
    const value = readPath(payload, item.path);
    return {
      path: item.path,
      label: item.label,
      tells: item.tells,
      present: value !== undefined && value !== null,
      value,
    };
  });
}

/** A value as a cell a reader can scan. Objects are summarised, never `[object Object]`. */
export function formatValue(value) {
  if (value === undefined || value === null) return null;
  if (typeof value === 'number') return Number.isInteger(value) ? String(value) : value.toFixed(2);
  if (typeof value === 'string') return value.trim() === '' ? '(empty)' : value;
  if (typeof value === 'boolean') return value ? 'yes' : 'no';
  if (Array.isArray(value)) {
    if (value.length === 0) return '(none)';
    if (value.every((v) => typeof v !== 'object')) return value.join(', ');
    return `${value.length} item(s)`;
  }
  if (typeof value === 'object') {
    const keys = Object.keys(value);
    if (keys.length === 0) return '(empty)';
    // A short object is more useful as pairs than as a count.
    return keys
      .slice(0, 4)
      .map((k) => `${k}: ${formatValue(value[k]) ?? '—'}`)
      .join(' · ');
  }
  return String(value);
}

/**
 * ── DECISION (2026-11-23, primary) ───────────────────────────────────────────────────────────────
 * WHAT:      the inventory lists only paths the SELECTION-RUN payload carries, and every value is read
 *            live so a field that disappears renders as absent rather than as a stale example.
 * WHY:       a table whose job is to show what is available must not carry permanently-absent rows, and
 *            a declaration that cannot be checked against the payload rots into fiction the moment a
 *            response shape changes.
 * INSTEAD OF: listing `runCounters`, `sharpeRatio` and `maxDrawdown`, which are recorded on the
 *            per-symbol `backtestrun` and never reach this page's payload.
 * REVERSE BY: add a `source: 'protocol-run'` variant and group the table by source — the present/absent
 *            test still applies per row, so nothing becomes a guess.
 * REGISTER:  docs/SETTLED-DECISIONS.md row 263
 * GUARD:     src/core/backtest-unused-fields.test.js
 */