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

/**
 * ── THE READER'S QUESTIONS (note n, 2026-11-26) ─────────────────────────────────────────────────────
 * Owner's note: *"Turn the inventory into a pick-list per reader, so choosing what to surface is a
 * mechanism not a conversation."*
 *
 * A flat table of every field nobody shows is a menu of nouns. A reader does not arrive with "tell me
 * about `priorSessions`" — they arrive with one of three doubts about the run in front of them, and they
 * want the fields that settle it. So every field declares the question it ANSWERS, and the panel offers
 * the questions. Choosing what to surface is then a declaration, made once, by whoever adds the field —
 * not a conversation with an agent each time somebody wonders.
 *
 * ⚠️ THIS IS STRUCTURE, NOT PROSE. `answers` is checked by `inventoryFindings()`: a field answering no
 * question is a FINDING (either the declaration drifted or the field should be retired), and a question
 * answered by no field is a FINDING too. Both fail the test, so the list cannot quietly stop working.
 */
export const INVENTORY_CONCERNS = [
  {
    id: 'comparable',
    question: 'Can I compare this with another run?',
    why:
      'Two runs built on different providers or different warm-up are not two measurements of one thing. '
      + 'These are the fields that decide whether a comparison is legitimate.',
  },
  {
    id: 'decision',
    question: 'Did the strategy actually choose?',
    why:
      'A pick that won a contest and a pick that was the only option are different claims. These fields '
      + 'separate a decision from an artefact of the list or of a default.',
  },
  {
    id: 'assumed',
    question: 'Where does the engine assume instead of measuring?',
    why:
      'Every engine substitutes something for reality — a fill, a capacity, a position it could not take. '
      + 'These fields price those substitutions, so a result is read with its assumptions attached.',
  },
];

/** One row per field the run returns and the page does not show. */
export const UNUSED_FIELD_INVENTORY = [
  {
    path: 'rankingProvider',
    answers: ['comparable'],
    label: 'Ranking provider',
    tells:
      'Which provider ranked the day\'s candidates, and whether it was ambiguous. A different provider '
      + 'is a different candidate list — the run is not comparable with one ranked by another.',
  },
  {
    path: 'candidates',
    answers: ['decision'],
    label: 'Candidates the ranker could choose from',
    tells:
      'The full list before the top-N cut. It shows whether a pick won a contest or was the only '
      + 'option, which is the difference between a strategy and an artefact of a short list.',
  },
  {
    path: 'priorSessions',
    answers: ['comparable'],
    label: 'Warm-up sessions',
    tells:
      'How many earlier sessions the directives read before the day being measured. A day with fewer '
      + 'warm-up sessions is measured on colder indicators, and the result says nothing about that today.',
  },
  {
    path: 'sideSource',
    answers: ['decision'],
    label: 'Where the direction came from',
    tells:
      'Whether LONG/SHORT came from the protocol, the dataset or an override. A run whose side was '
      + 'guessed is not a run of the strategy the reader thinks.',
  },
  {
    path: 'datasetSide',
    answers: ['decision'],
    label: 'The dataset\'s own side',
    tells:
      'Whether the day list was built from winners or losers. Shown beside `sideSource` it makes a '
      + 'disagreement between them visible instead of silent.',
  },
  {
    path: 'admission',
    answers: ['assumed'],
    label: 'Portfolio admission',
    tells:
      'Present only in `admission: portfolio` mode: how many trades the bot could not have taken, and '
      + 'why (cooldown vs position cap). Null in the default independent mode, which is why it reads as '
      + 'absent here.',
  },
];

/**
 * ⚠️ `fillGap` WAS RETIRED FROM THIS LIST ON 2026-11-27, AND IT IS THE LIST'S OWN WARNING COMING TRUE.
 * It was declared here with *"Computed on every run and shown nowhere"* — and then note d built the
 * stop-fill QualifierStrip in step 2, so the sentence became false. The declaration's evidence is the
 * PAYLOAD, so a field that disappears goes visibly absent; a field that starts being USED has no such
 * signal, and this row would have gone on claiming a capability gap that no longer existed.
 * ⇒ When a panel starts rendering an inventory field, DELETE ITS ROW in the same change.
 */

/**
 * `pickListFor()` — one reader's question, answered by the fields that address it.
 *
 * @param {ReturnType<typeof inventoryRows>} rows
 * @param {string} concernId  an `INVENTORY_CONCERNS` id, or `'all'`
 * @returns {{rows: Array, concern: object|null, hidden: number}}
 *   `hidden` is how many fields the choice leaves out, so a filtered view never reads as the whole
 *   inventory — the count is printed beside the picker.
 */
export function pickListFor(rows, concernId) {
  const list = Array.isArray(rows) ? rows : [];
  if (concernId === 'all' || concernId == null) {
    return { rows: list, concern: null, hidden: 0 };
  }
  const concern = INVENTORY_CONCERNS.find((c) => c.id === concernId) ?? null;
  if (!concern) return { rows: list, concern: null, hidden: 0 };
  const picked = list.filter((r) => (r.answers ?? []).includes(concernId));
  return { rows: picked, concern, hidden: list.length - picked.length };
}

/**
 * `inventoryFindings()` — the declaration's own health, as data rather than as a comment.
 *
 * ⚠️ BOTH DIRECTIONS ARE CHECKED, because only one of them is obvious. A field with no question is a
 * row no reader will ever be offered. A question with no fields is a chip that opens an empty table —
 * which reads as "the run had nothing to say about that", when the truth is "nobody declared a field".
 */
export function inventoryFindings(inventory = UNUSED_FIELD_INVENTORY, concerns = INVENTORY_CONCERNS) {
  const known = new Set(concerns.map((c) => c.id));
  const unassigned = inventory.filter((i) => !(i.answers ?? []).length).map((i) => i.path);
  const answered = new Set(inventory.flatMap((i) => i.answers ?? []));
  return {
    unassigned,
    empty: concerns.filter((c) => !answered.has(c.id)).map((c) => c.id),
    /** An `answers` id with no matching concern — a typo that would hide a field from every pick-list. */
    unknown: [...answered].filter((a) => !known.has(a)),
  };
}

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
      answers: item.answers ?? [],
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