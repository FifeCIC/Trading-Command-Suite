import test from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyExperiment,
  summariseExperiments,
  EXPERIMENT_STATE_LABEL,
  EXPERIMENT_STATE_NEXT_STEP,
} from './experiment-states.js';

const mk = (runs, over = {}) => ({
  id: 'x', label: 'L', protocolId: 'p', status: 'running', runs, createdAt: '2026-11-01T00:00:00Z', ...over,
});

test('0 runs is a SHELL — an empty running loop reads as work in progress', () => {
  assert.equal(classifyExperiment(mk(0)), 'SHELL');
});

test('1 run is SINGLE — one run is not a comparison', () => {
  assert.equal(classifyExperiment(mk(1)), 'SINGLE');
});

test('2+ runs from a person is COMPARISON', () => {
  assert.equal(classifyExperiment(mk(2)), 'COMPARISON');
  assert.equal(classifyExperiment(mk(5)), 'COMPARISON');
});

test('a system bucket is AUTO, never COMPARISON — even with many runs', () => {
  // ⚠️ The ordering of the checks is the rule: an auto bucket with 900 runs must not read as the
  // most important experiment in the list.
  assert.equal(classifyExperiment(mk(900, { createdBy: 'system' })), 'AUTO');
  assert.equal(classifyExperiment(mk(0, { createdBy: 'system' })), 'AUTO');
});

test('a null or NaN run count is SHELL, never NaN and never SINGLE', () => {
  assert.equal(classifyExperiment(mk(null)), 'SHELL');
  assert.equal(classifyExperiment(mk(undefined)), 'SHELL');
  assert.equal(classifyExperiment(mk('not-a-number')), 'SHELL');
});

test('summariseExperiments counts each state separately', () => {
  const s = summariseExperiments({
    experiments: [mk(0), mk(1), mk(4), mk(900, { createdBy: 'system' })],
  });
  assert.equal(s.total, 4);
  assert.equal(s.shells, 1);
  assert.equal(s.singles, 1);
  assert.equal(s.comparisons, 1);
  assert.equal(s.autos, 1);
  // An AUTO bucket is not a comparison, so it cannot inflate this.
  assert.equal(s.needsAttention, 2);
});

test('AUTO is not counted as a comparison', () => {
  const s = summariseExperiments({ experiments: [mk(900, { createdBy: 'system' })] });
  assert.equal(s.comparisons, 0);
  assert.equal(s.autos, 1);
});

test('rows are ordered SHELL then SINGLE then AUTO then COMPARISON', () => {
  const s = summariseExperiments({ experiments: [mk(4), mk(900, { createdBy: 'system' }), mk(1), mk(0)] });
  assert.deepEqual(s.rows.map((r) => r.state), ['SHELL', 'SINGLE', 'AUTO', 'COMPARISON']);
});

test('protocols counts distinct protocols, not rows', () => {
  const s = summariseExperiments({ experiments: [mk(2), mk(3), mk(2, { protocolId: 'other' })] });
  assert.equal(s.protocols, 2);
});

test('a payload with no array THROWS rather than reading as "no experiments"', () => {
  assert.throws(() => summariseExperiments({}), /no experiments array/);
  assert.throws(() => summariseExperiments(null), /no experiments array/);
});

test('every state has a label and a next-step entry — a new state cannot be added silently', () => {
  for (const state of ['SHELL', 'SINGLE', 'AUTO', 'COMPARISON']) {
    assert.ok(EXPERIMENT_STATE_LABEL[state], `${state} has no label`);
    assert.ok(state in EXPERIMENT_STATE_NEXT_STEP, `${state} has no next-step entry`);
  }
});
