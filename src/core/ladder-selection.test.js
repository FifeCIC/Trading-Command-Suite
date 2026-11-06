/**
 * ladder-selection.test.js — the two #782 acceptance criteria, as executable rules.
 * =====================================================================================
 * Run with: `node --test src/core/ladder-selection.test.js` (and in `prebuild`).
 *
 * ⚠️ THE DEFECTS THESE PIN, both measured on 2026-09-10 and both about *absence of evidence*:
 *
 *   1. `"No active protocols."` was rendered for a FAILED fetch, because the queryFn ended
 *      `.catch(() => ({ protocols: [] }))` — so react-query recorded a SUCCESS and the page made a
 *      confident factual claim about the registry when it had failed to ask.
 *   2. The prune effect had no `loaded` guard, so the empty list was consumed as evidence that
 *      nothing was selected, and `[]` was PERSISTED to localStorage. A 4-protocol selection
 *      collapsed to 1 on every refresh; one 502 during an API restart wiped it.
 *
 * ⚠️ CANARY THEM. Delete the `!loaded` guard from `planSelection` and case 1 must fail; make
 * `protocolPanelState` treat `isError` as `empty` and the panel test must fail. A guard never
 * observed to fail is a decoration.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { planSelection, protocolPanelState } from './ladder-selection.js';

const IDS = ['xau-speed-v1-long', 'forex-session-v1-long', 'vix-spike-v1-long', 'btc-scalp-v1-long'];

test('a FAILED fetch is "error", never "empty" — the page must not claim the registry is empty', () => {
  // The exact shape the old swallowed catch produced: isError false (it resolved!), loaded true,
  // count 0 → 'empty'. With the catch removed, react-query sets isError and loaded stays false.
  assert.equal(protocolPanelState({ isError: true, loaded: false, applicableCount: 0 }), 'error');
  // …and a genuine empty success is still 'empty'. The two must be distinguishable.
  assert.equal(protocolPanelState({ isError: false, loaded: true, applicableCount: 0 }), 'empty');
  // Before any answer arrives, neither claim is available.
  assert.equal(protocolPanelState({ isError: false, loaded: false, applicableCount: 0 }), 'loading');
  // Real rows win over a failed refresh — stale-but-true beats an error with nothing behind it.
  assert.equal(protocolPanelState({ isError: true, loaded: false, applicableCount: 4 }), 'list');
});

test('a failed load cannot prune the selection — "not loaded" is not evidence', () => {
  const plan = planSelection({
    loaded: false,               // the fetch failed or has not answered
    applicableIds: [],           // …so there is no list
    current: IDS,
    alreadySeeded: true,
  });
  assert.equal(plan.action, 'none');
  assert.equal(plan.reason, 'not-loaded');
});

test('an empty applicable list cannot prune either — nothing to prune AGAINST', () => {
  // Reachable legitimately: no protocol applies to SHORT. It must not write `[]`.
  const plan = planSelection({ loaded: true, applicableIds: [], current: IDS, alreadySeeded: true });
  assert.equal(plan.action, 'none');
  assert.equal(plan.reason, 'no-applicable');
});

test('the stored selection SURVIVES a failed-then-successful load (the composed acceptance case)', () => {
  // 1. The user has four protocols selected and has seen the list before.
  let current = IDS;

  // 2. A refetch fails. Nothing may be written.
  const failed = planSelection({ loaded: false, applicableIds: [], current, alreadySeeded: true });
  assert.equal(failed.action, 'none');
  assert.deepEqual(current, IDS, 'selection changed during a failure');

  // 3. The API comes back with the same four protocols. Nothing to drop.
  const recovered = planSelection({ loaded: true, applicableIds: IDS, current, alreadySeeded: true });
  assert.equal(recovered.action, 'none');
  assert.equal(recovered.reason, 'unchanged');

  // 4. …and if one protocol genuinely disappears, THAT is when pruning is allowed.
  const shrunk = planSelection({
    loaded: true,
    applicableIds: IDS.slice(1),
    current,
    alreadySeeded: true,
  });
  assert.equal(shrunk.action, 'prune');
  assert.deepEqual(shrunk.dropped, ['xau-speed-v1-long']);
  assert.deepEqual(shrunk.ids, IDS.slice(1));
});

test('first sight of a loaded list seeds ALL applicable protocols', () => {
  const plan = planSelection({ loaded: true, applicableIds: IDS, current: [], alreadySeeded: false });
  assert.equal(plan.action, 'seed');
  assert.deepEqual(plan.ids, IDS);
});

test('a user who deliberately clears the list keeps it cleared', () => {
  // Already seeded + current empty + a loaded non-empty list = deliberate deselect, not data loss.
  const plan = planSelection({ loaded: true, applicableIds: IDS, current: [], alreadySeeded: true });
  assert.equal(plan.action, 'none');
  assert.equal(plan.reason, 'unchanged');
});

test('every input is tolerated — the effect runs before the data exists', () => {
  for (const args of [undefined, {}, { loaded: true }, { applicableIds: null, current: null }]) {
    assert.doesNotThrow(() => planSelection(args));
  }
  assert.doesNotThrow(() => protocolPanelState());
});

/**
 * ⚠️ ADDED 2026-11-06 after the protocol rename, which migrated the DATABASE but not the browser.
 * Measured on the running app: the ladder held 17 long-direction ids, every one a pre-rename slug
 * (`xau-speed-v1`, `spy-day-v1`, `vix-short-v1` …), and it rendered **0 ticked checkboxes** against
 * 51 current protocols. The prune then correctly removed them as non-existent and persisted the
 * emptiness — #782's own symptom, reached by a different route.
 */
test('a PRE-RENAME id is recovered, not pruned — the rename must not eat a selection', () => {
  const current = ['xau-speed-v1-long', 'spy-day-v1-long', 'btc-scalp-v1-long'];
  const stored = ['xau-speed-v1', 'spy-day-v1', 'btc-scalp-v1']; // what a browser still holds

  const plan = planSelection({
    loaded: true,
    applicableIds: current,
    current: stored,
    alreadySeeded: true,
  });

  assert.equal(plan.action, 'migrate', 'a rename must be a migration, not a prune');
  assert.deepEqual(plan.ids, current, 'every id survived, in its current form');
  assert.deepEqual(plan.migrated, current);
});

test('an irregular rename is recovered too — vix-short-v1 became vix-spike-v1-short', () => {
  const plan = planSelection({
    loaded: true,
    applicableIds: ['vix-spike-v1-short'],
    current: ['vix-short-v1'],
    alreadySeeded: true,
  });
  assert.equal(plan.action, 'migrate');
  assert.deepEqual(plan.ids, ['vix-spike-v1-short']);
});

test('migration never invents an id — an unknown one is still pruned as gone', () => {
  const plan = planSelection({
    loaded: true,
    applicableIds: ['xau-speed-v1-long'],
    current: ['xau-speed-v1', 'a-protocol-that-never-existed'],
    alreadySeeded: true,
  });
  assert.equal(plan.action, 'prune');
  assert.deepEqual(plan.ids, ['xau-speed-v1-long']);
  assert.deepEqual(plan.dropped, ['a-protocol-that-never-existed']);
});
