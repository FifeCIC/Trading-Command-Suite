/**
 * decision-display.test.js — an observation must not render like a tradeable signal (#971).
 * ======================================================================================
 * Run with: `npm run test:decision-display`
 *
 * WHY THIS EXISTS
 * ---------------
 * 539 of 577 scored rows in `decision_log` belonged to no bot. They were written as 'SCORED',
 * the same value a bot's signal carries, so the Decision Trail rendered an observation exactly
 * like something that could trade. The canary direction matters as much as the positive one:
 * these tests assert that an OBSERVED row and a SCORED row differ in BOTH label and colour, AND
 * that a REAL bot row is not swept up as an observation.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  OBSERVATION_MARKER,
  CANONICAL_DECISION_VALUES,
  DECISION_COLORS,
  isObservation,
  decisionColor,
  decisionLabel,
} from './decision-display.js';

test('an observation and a tradeable signal do not render the same (both directions)', () => {
  const observed = { decision: OBSERVATION_MARKER, strategyId: '' };
  const botRow = { decision: 'SCORED', strategyId: 'bot-eurusd-1' };

  // Direction 1: the observation is an observation, and says so in words.
  assert.equal(isObservation(observed), true);
  assert.notEqual(decisionLabel(observed.decision), decisionLabel(botRow.decision));
  assert.notEqual(decisionColor(observed.decision), decisionColor(botRow.decision));
  assert.match(decisionLabel(observed.decision), /no consumer/);

  // Direction 2: the bot row is NOT an observation (a sweep-up here would hide real signals).
  assert.equal(isObservation(botRow), false);
  assert.equal(decisionLabel(botRow.decision), 'SCORED');
});

test('pre-#971 rows (SCORED with no strategyId) are still read as observations', () => {
  // History is not rewritten: the empty strategyId IS the historical marker.
  assert.equal(isObservation({ decision: 'SCORED', strategyId: '' }), true);
  assert.equal(isObservation({ decision: 'SCORED', strategyId: null }), true);
  assert.equal(isObservation({ decision: 'SCORED' }), true);
  // …but a refusal or a dispatch is never an observation, whatever the strategyId.
  for (const decision of ['BLOCKED', 'SKIP', 'EXECUTED', 'FAILED', 'QUEUED']) {
    assert.equal(isObservation({ decision, strategyId: '' }), false, decision);
  }
  assert.equal(isObservation(null), false);
});

test('the palette covers every canonical value (a new marker cannot render as silent grey)', () => {
  for (const value of CANONICAL_DECISION_VALUES) {
    assert.ok(DECISION_COLORS[value], `no colour for ${value}`);
  }
  assert.equal(Object.keys(DECISION_COLORS).length, CANONICAL_DECISION_VALUES.length);
  assert.equal(decisionColor('NOT_A_REAL_VALUE'), 'var(--ink-soft)');
});

test('OBSERVED is not a status colour (it must not look like it did something)', () => {
  assert.notEqual(DECISION_COLORS.OBSERVED, DECISION_COLORS.EXECUTED);
  assert.notEqual(DECISION_COLORS.OBSERVED, DECISION_COLORS.FAILED);
  assert.notEqual(DECISION_COLORS.OBSERVED, DECISION_COLORS.BLOCKED);
  assert.equal(decisionLabel(undefined), '—');
});
