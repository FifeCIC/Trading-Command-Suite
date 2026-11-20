/**
 * column-spec.test.js — a cockpit column that is named but cannot render must fail, not render blank.
 *
 * ⚠️ THE FAILURE THIS GUARDS is the one every "flexible layout" idea has: a missing column looks the
 * same as a column with no data. Silence is made impossible by requiring an explicit state.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildColumnSpec, columnSummary, REQUIRED_PHASES } from './column-spec.js';

const render = () => null;

test('a fully declared spec has no problems and preserves phase order', () => {
  const byPhase = Object.fromEntries(
    REQUIRED_PHASES.map((id) => [id, { state: 'ready', renderer: render }]),
  );
  const { columns, problems } = buildColumnSpec(byPhase);
  assert.deepEqual(problems, []);
  assert.equal(columns.length, REQUIRED_PHASES.length);
  assert.deepEqual(columns.map((c) => c.id), REQUIRED_PHASES);
});

test('▶ CANARY — an omitted phase is a problem, not a silently absent column', () => {
  const byPhase = Object.fromEntries(
    REQUIRED_PHASES.filter((id) => id !== 'scoring').map((id) => [id, { state: 'ready', renderer: render }]),
  );
  const { problems } = buildColumnSpec(byPhase);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /^scoring: no column declared/);
});

test('▶ CANARY — "ready" without a renderer is refused', () => {
  const byPhase = Object.fromEntries(
    REQUIRED_PHASES.map((id) => [id, { state: 'ready', renderer: id === 'signals' ? undefined : render }]),
  );
  const { problems } = buildColumnSpec(byPhase);
  assert.match(problems.join('\n'), /signals: state 'ready' but no renderer/);
});

test('a skeleton or absent column must say why', () => {
  const byPhase = Object.fromEntries(
    REQUIRED_PHASES.map((id) => [id, id === 'alerts' ? { state: 'absent' } : { state: 'ready', renderer: render }]),
  );
  const { problems } = buildColumnSpec(byPhase);
  assert.match(problems.join('\n'), /alerts: 'absent' needs a note/);
});

test('an unknown state is refused rather than defaulted', () => {
  const byPhase = Object.fromEntries(
    REQUIRED_PHASES.map((id) => [id, id === 'risk' ? { state: 'later' } : { state: 'ready', renderer: render }]),
  );
  const { problems } = buildColumnSpec(byPhase);
  assert.match(problems.join('\n'), /risk: state 'later' is not one of/);
});

test('the summary counts each state separately, so a mostly-empty spec cannot read as complete', () => {
  const byPhase = Object.fromEntries(
    REQUIRED_PHASES.map((id, i) => [id, i === 0
      ? { state: 'ready', renderer: render }
      : { state: 'skeleton', note: 'not built' }]),
  );
  const { columns } = buildColumnSpec(byPhase);
  const text = columnSummary(columns);
  assert.match(text, /^1 column\(s\) render data/);
  assert.match(text, /named but unbuilt/);
});
