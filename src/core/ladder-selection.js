/**
 * ladder-selection.js — the two decisions that used to destroy a user's selection (#782).
 *
 * ⚠️ WHY THIS IS A SEPARATE, PURE MODULE. Both defects in #782 were *missing guards* inside a
 * `useEffect`, and a guard that lives only inside an effect cannot be tested without a browser and a
 * failing API. Extracting the DECISION means the rules become a table a test can walk, and the
 * component keeps only the side effect (writing the result).
 *
 * ⚠️ THE TWO RULES, and they are different questions:
 *
 *   1. **"Is this empty, or did I fail to ask?"** — an empty list and a failed fetch must never
 *      render the same thing. `[]` is information; "no answer" is not.
 *   2. **"May I prune?"** — pruning is a WRITE to user data. It needs positive evidence that a
 *      protocol no longer exists. The absence of a list is not evidence; it is the absence of
 *      evidence. Measured consequence when this was wrong: a 4-protocol selection collapsed to 1 on
 *      every refresh, and a single 502 during an API restart persisted `[]` to localStorage.
 *
 *   3. **"Is this id just OLD?"** — added 2026-11-06 after the protocol rename. Protocol ids are
 *      stored in the browser as well as the database, and the rename migrated only the database.
 *      A stored id is mapped to its current form BEFORE any pruning decision, so a rename recovers a
 *      selection instead of destroying it.
 */
import { normaliseLegacyProtocolId } from './protocol-id-legacy.js';

/**
 * What should happen to the current direction's selection, given what has loaded.
 *
 * Returns `{ action }` where action is one of:
 *   'none'    — leave storage alone. `reason` says why.
 *   'seed'    — first sight of a loaded list; `ids` is every applicable protocol.
 *   'prune'   — some selected ids no longer exist; `ids` is what survives.
 *
 * ⚠️ `none` is the answer whenever the evidence is missing. Every early return here is a guard that
 * was absent in the original: `!loaded` (list has not arrived) and an empty applicable list (there
 * is nothing to prune AGAINST and nothing to seed FROM).
 */
export function planSelection({ loaded, applicableIds, current, alreadySeeded } = {}) {
  const ids = Array.isArray(applicableIds) ? applicableIds : [];
  const raw = Array.isArray(current) ? current : [];

  // ⚠️ MIGRATE BEFORE JUDGING (#782 follow-up, 2026-11-06). A stored id may be a PRE-RENAME protocol
  // slug — protocol ids live in the browser as well as the database, and the 2026-11-05 rename only
  // migrated the database. Measured: the ladder held 17 long-direction ids, every one pre-rename,
  // and rendered 0 ticked boxes against 51 current protocols; the prune then persisted the emptiness.
  // Mapping first means a rename recovers the selection instead of destroying it.
  const cur = raw.map(normaliseLegacyProtocolId);
  const migrated = cur.some((id, i) => id !== raw[i]) ? cur : null;

  if (!loaded) return { action: 'none', reason: 'not-loaded', migrated };
  if (ids.length === 0) return { action: 'none', reason: 'no-applicable', migrated };
  if (!alreadySeeded) return { action: 'seed', ids, migrated };

  const applicable = new Set(ids);
  const kept = cur.filter((id) => applicable.has(id));
  if (kept.length === cur.length) {
    // Unchanged — but a RENAME may still need persisting, so the caller can write the migrated ids.
    return { action: migrated ? 'migrate' : 'none', reason: 'unchanged', ids: kept, migrated };
  }
  // ⚠️ Only reached with a LOADED, NON-EMPTY list — i.e. positive evidence that these ids are gone.
  return { action: 'prune', ids: kept, dropped: cur.filter((id) => !applicable.has(id)), migrated };
}

/**
 * Which of the three states the protocol panel is in.
 *
 *   'error' — the fetch failed and we have nothing to show. MUST say so, with a retry.
 *   'empty' — the fetch SUCCEEDED and there are genuinely none. "No active protocols" is then true.
 *   'list'  — show them.
 *
 * ⚠️ Never collapse 'error' into 'empty'. That is the exact defect: the page made a confident
 * factual claim about the registry when it had failed to ask. Silence dressed as an answer is
 * worse than an error, because nobody retries.
 *
 * ⚠️ `isError` wins even when a previous success left items in hand? No — deliberately not. If we
 * hold real protocols from an earlier load, showing them (stale but TRUE) beats replacing them with
 * an error. The error state is only for when there is nothing to show.
 */
export function protocolPanelState({ isError, loaded, applicableCount } = {}) {
  const count = Number(applicableCount) || 0;
  if (count > 0) return 'list';
  if (isError) return 'error';
  if (loaded) return 'empty';
  return 'loading';
}
