/**
 * steps.test.js — the movers step list is the page's contract with itself (#1342).
 *
 * A step list looks like decoration until one entry drifts: a duplicated id makes the accordion's
 * stored state leak between two steps, a missing `purpose` makes a collapsed step unreadable, and a
 * gap in the numbering makes the reader think a step failed to render. None of those throw.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { MOVERS_STEPS, MOVERS_STEP, MOVERS_PAGE_ID } from './steps.js';

test('every step has the fields the accordion renders', () => {
  for (const s of MOVERS_STEPS) {
    assert.equal(typeof s.id, 'string');
    assert.ok(s.id.startsWith('mvp-step-'), `${s.id} must carry the anchor prefix`);
    assert.equal(typeof s.step, 'number');
    assert.ok(s.title && s.title.length > 3, `${s.id} needs a title`);
    // A purpose is the QUESTION the step answers — a collapsed step without one cannot be judged.
    assert.ok(s.purpose && s.purpose.length > 15, `${s.id} needs a purpose`);
  }
});

test('ids are unique, because the id is also the DOM anchor AND the stored-state key', () => {
  const ids = MOVERS_STEPS.map((s) => s.id);
  assert.equal(new Set(ids).size, ids.length);
});

test('the numbering is contiguous from 1, so no step looks missing', () => {
  assert.deepEqual(
    MOVERS_STEPS.map((s) => s.step),
    MOVERS_STEPS.map((_, i) => i + 1),
  );
});

test('the first step and the summary are the only ones open by default', () => {
  const open = MOVERS_STEPS.filter((s) => s.defaultOpen).map((s) => s.id);
  assert.deepEqual(open, ['mvp-step-settings', 'mvp-step-summary']);
});

test('every step is reachable by id through the lookup', () => {
  for (const s of MOVERS_STEPS) assert.equal(MOVERS_STEP[s.id], s);
});

test('the stored-state namespace is versioned, so a step-list change cannot reuse stale keys', () => {
  assert.match(MOVERS_PAGE_ID, /-v\d+$/);
});
