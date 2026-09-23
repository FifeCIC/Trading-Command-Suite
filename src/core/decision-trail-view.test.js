/**
 * decision-trail-view.test.js — a mode may hide an OBSERVATION, never a DECISION (R12/#971).
 * ======================================================================================
 * Run with: `npm run test:decision-trail-view`
 *
 * The canary direction is the whole point: hiding a *decision* row would make the page report
 * "nothing was decided" while looking perfectly normal, and a filtered list that does not say it
 * filtered is the same defect one step quieter.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { applyObservationMode, OBSERVATION_MODES, MODE_INFO, DEFAULT_OBSERVATION_MODE } from './decision-trail-view.js';

const obs = (at, symbol = 'SPY', extra = {}) => ({ decision: 'OBSERVED', strategyId: '', symbol, timestamp: at, ...extra });
const dec = (at, decision = 'SCORED', strategyId = 'bot-1') => ({ decision, strategyId, symbol: 'XAUUSD', timestamp: at });

const trails = [
  dec('2026-09-23T10:00:00Z'),
  obs('2026-09-23T10:00:00Z'),
  obs('2026-09-23T10:00:00Z'),
  dec('2026-09-23T10:05:00Z', 'EXECUTED'),
  obs('2026-09-23T10:05:00Z', 'EURCAD'),
];

test('mode A shows everything and hides nothing', () => {
  const { rows, counts } = applyObservationMode(trails, 'A');
  assert.equal(rows.length, 5);
  assert.equal(counts.hidden, 0);
  assert.equal(counts.filtered, false);
  assert.equal(counts.observations, 3);
  assert.equal(counts.decisions, 2);
});

test('mode B hides ONLY observations, and says how many', () => {
  const { rows, counts } = applyObservationMode(trails, 'B');
  assert.equal(rows.length, 2, 'the two decision rows survive');
  assert.ok(rows.every((r) => r.type === 'trail'));
  assert.deepEqual(
    rows.map((r) => r.trail.decision),
    ['SCORED', 'EXECUTED'],
    'both decisions are present, in order',
  );
  assert.equal(counts.hidden, 3);
  assert.equal(counts.filtered, true, 'the page must be able to SAY it filtered');
  // Nothing vanishes without being counted.
  assert.equal(rows.length + counts.hidden, counts.total);
});

test('mode B can never hide a decision — canary both directions', () => {
  const onlyDecisions = [dec('2026-09-23T11:00:00Z'), dec('2026-09-23T11:01:00Z', 'BLOCKED')];
  const { rows, counts } = applyObservationMode(onlyDecisions, 'B');
  assert.equal(rows.length, 2, 'no observations to hide, so nothing is hidden');
  assert.equal(counts.hidden, 0);
  assert.equal(counts.filtered, false);
  // And the inverse: a row with a consumer is never treated as an observation, whatever its value.
  for (const decision of ['SCORED', 'BLOCKED', 'SKIP', 'EXECUTED', 'FAILED', 'QUEUED']) {
    const { counts: c } = applyObservationMode([dec('2026-09-23T11:02:00Z', decision)], 'B');
    assert.equal(c.hidden, 0, `${decision} with a bot must not be hidden`);
  }
});

test('mode C folds observations per tick and loses none', () => {
  const { rows, counts } = applyObservationMode(trails, 'C');
  assert.equal(counts.groups, 2, 'two ticks carried observations');
  const groups = rows.filter((r) => r.type === 'group');
  assert.equal(groups.length, 2);
  assert.equal(groups[0].observations.length, 2);
  assert.equal(groups[1].observations.length, 1);
  assert.deepEqual(
    rows.filter((r) => r.type === 'trail').map((r) => r.trail.decision),
    ['SCORED', 'EXECUTED'],
  );
  const grouped = groups.reduce((n, g) => n + g.observations.length, 0);
  assert.equal(grouped + counts.decisions, counts.total, 'nothing is lost in the fold');
  assert.equal(counts.hidden, 0, 'mode C does not hide — it summarises');
});

test('an EMPTY list and a FULLY-filtered list do not look the same', () => {
  const empty = applyObservationMode([], 'B');
  assert.equal(empty.rows.length, 0);
  assert.equal(empty.counts.total, 0);
  assert.equal(empty.counts.filtered, false, 'nothing was filtered because there was nothing');

  const allObs = applyObservationMode([obs('2026-09-23T12:00:00Z'), obs('2026-09-23T12:01:00Z')], 'B');
  assert.equal(allObs.rows.length, 0);
  assert.equal(allObs.counts.total, 2);
  assert.equal(allObs.counts.filtered, true, 'an empty VIEW with a non-empty source must say so');
  assert.equal(allObs.counts.hidden, 2);
});

test('an unknown mode falls back to the DEFAULT rather than rendering nothing', () => {
  assert.equal(DEFAULT_OBSERVATION_MODE, 'C', 'the owner chose collapse');
  const unknown = applyObservationMode(trails, 'Z');
  // The default (C) shows everything: decisions as cards, observations folded.
  assert.equal(unknown.counts.total, 5);
  assert.equal(unknown.counts.hidden, 0, 'the default hides nothing');
  assert.equal(unknown.rows.length, 4, '2 decision cards + 2 group rows');
  assert.equal(applyObservationMode(trails, undefined).counts.total, 5);
  assert.equal(applyObservationMode(null, 'B').counts.total, 0);
});

test('a collapsed row names the STRONGEST score it is hiding (the actionable half)', () => {
  const withScores = [
    obs('2026-09-23T10:00:00Z', 'EURUSD', { compositePct: 59 }),
    obs('2026-09-23T10:00:00Z', 'GBPUSD', { compositePct: 12 }),
    obs('2026-09-23T10:00:00Z', 'USDJPY', { compositePct: 41, signal: 'BUY' }),
    dec('2026-09-23T10:00:00Z'),
  ];
  const { rows } = applyObservationMode(withScores, 'C');
  const group = rows.find((r) => r.type === 'group');
  assert.equal(group.observations.length, 3);
  assert.equal(group.strongest.symbol, 'EURUSD', 'the highest score, not the first row');
  assert.equal(group.strongest.value, 59);
  assert.equal(group.strongest.text, '59.0%');

  // And the other direction: with nothing numeric, the row must say NOTHING rather than 0.
  const noScores = applyObservationMode([obs('2026-09-23T10:00:00Z'), obs('2026-09-23T10:00:01Z')], 'C');
  assert.equal(noScores.rows.find((r) => r.type === 'group').strongest, null);
});

test('every mode is described, so the picker cannot render a blank button', () => {
  assert.deepEqual(OBSERVATION_MODES, ['A', 'B', 'C']);
  for (const mode of OBSERVATION_MODES) {
    assert.ok(MODE_INFO[mode].label && MODE_INFO[mode].title && MODE_INFO[mode].desc, mode);
  }
});
