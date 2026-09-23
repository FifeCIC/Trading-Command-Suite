/**
 * decision-score.test.js — every score renders WITH its unit (#909).
 * ================================================================
 * Run with: `npm run test:decision-score`
 *
 * WHY THIS EXISTS
 * ---------------
 * `decision_log.composite` carried a raw additive score (e.g. 178) for the ladder/A-B writers and
 * a 0-100 percentage (e.g. 7) for the queue path. The dashboard rendered both identically, the
 * Decision Trail coloured both on the RAW scale (1500/500 — a percentage row can never colour),
 * and the Symbol Focus card labelled BOTH `%` — including the raw rows, where `%` is simply wrong.
 *
 * The canary direction matters as much as the positive one: these tests assert that a RAW row is
 * NOT rendered as a bare number (which a reader would take for a percentage) and that a LEGACY row
 * is NOT rendered as if its unit were known.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { decisionScore } from './decision-score.js';

test('a queue-path (percentage) row renders as a percentage, with the gate unit named', () => {
  const s = decisionScore({ compositePct: 7 });

  assert.equal(s.text, '7.0%');
  assert.equal(s.kind, 'pct');
  assert.match(s.title, /configured capacity/);
});

test('a ladder/A-B (raw) row renders as raw — never as a bare number', () => {
  const s = decisionScore({ compositeRaw: 178 });

  // ⚠️ The unit WORD changed from "raw" to "pts" (owner, 2026-09-23: *"'raw' whatever that
  // means"* — the explanation lived only in a tooltip). The invariant is unchanged, and it is the
  // reason this assertion exists: a raw row renders WITH a unit, never as a bare number that a
  // reader would take for a percentage.
  assert.equal(s.text, '178 pts');
  assert.equal(s.text.includes('raw'), false, 'the on-screen word must not be unexplained jargon');
  assert.equal(s.kind, 'raw');
  // The canary: a bare `178` on a surface that also shows percentages is the #909 defect.
  assert.notEqual(s.text, '178');
  assert.match(s.title, /not a percentage/);
});

test('a pre-split row shows its value marked as unit-unknown rather than guessing', () => {
  const s = decisionScore({ composite: 165, compositeRaw: null, compositePct: null });

  assert.equal(s.text, '165?');
  assert.equal(s.kind, 'legacy');
  assert.match(s.title, /unit is unknown/);
});

test('the typed columns win over the legacy value — a split row is never rendered as untyped', () => {
  // A backfilled row carries BOTH (typed value + the historical column it came from).
  assert.equal(decisionScore({ compositeRaw: 178, composite: 178 }).kind, 'raw');
  assert.equal(decisionScore({ compositePct: 7, composite: 7 }).kind, 'pct');
});

test('no score at all is empty — absence, not 0', () => {
  const s = decisionScore({ compositeRaw: null, compositePct: null, composite: null });

  assert.equal(s.text, '');
  assert.equal(s.kind, 'none');
  assert.equal(s.value, null);
});

test('zero is a real measurement and is rendered (0% is not "no data")', () => {
  assert.equal(decisionScore({ compositePct: 0 }).text, '0.0%');
  assert.equal(decisionScore({ compositeRaw: 0 }).text, '0 pts');
});
