/**
 * pipeline-phases.test.js — the stage list must be able to say "nothing here, and why".
 *
 * ⚠️ THE FAILURE THIS GUARDS IS A BESPOKE PAGE THAT LOOKS COMPLETE. A phase with no section and no
 * reason is indistinguishable from a phase nobody remembered; the assertion below makes the difference
 * mandatory. Canaried: removing the `absent` string from a sectionless phase fails this file.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PIPELINE_PHASES, absentPhases, phaseById } from './pipeline-phases.js';

const PAGE = new URL('../pages/MoversStrategyBacktestPage.jsx', import.meta.url);
const PANEL = new URL('../components/backtest/MoversDepthPanel.jsx', import.meta.url);
const CONFIG = new URL('../components/backtest/TradeConfigPanel.jsx', import.meta.url);
const GRAPH = new URL('../pages/PipelineGraphLabPage.jsx', import.meta.url);

/**
 * Phases that exist in the META.Stack pipeline but are NOT a graph-lab node.
 *
 * ⚠️ AN ENTRY HERE IS A DECISION, so it must say why. The alternative — quietly allowing a phase that
 * the graph does not draw — is how a "canonical" stage list stops being canonical.
 */
const NOT_A_GRAPH_NODE = {
  selection: 'Choosing WHICH instrument to trade is a strategy shape, not a pipeline stage: the graph draws one pipe through scoring → signals → automation, and every strategy walks it. A selection layer sits in front of that pipe.',
};

test('every phase is either covered or explains itself', () => {
  for (const p of PIPELINE_PHASES) {
    assert.ok(
      p.sections.length > 0 || (typeof p.absent === 'string' && p.absent.length > 40),
      `${p.id}: has no section and no stated reason — that is a gap a reader will infer as "fine"`,
    );
  }
});

test('a phase never claims a section and a reason at once', () => {
  for (const p of PIPELINE_PHASES) {
    assert.ok(
      !(p.sections.length > 0 && p.absent),
      `${p.id}: claims a section AND an absence — one of the two is stale`,
    );
  }
});

test('ids are unique, because they key the graph-lab mapping', () => {
  const ids = PIPELINE_PHASES.map((p) => p.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(phaseById(PIPELINE_PHASES).size, ids.length);
});

test('every phase states what a reader gets from it', () => {
  for (const p of PIPELINE_PHASES) {
    assert.ok(p.provides && p.provides.length > 20, `${p.id}: nothing says what this stage answers`);
    assert.ok(p.label, `${p.id}: no label`);
  }
});

test('▶ CANARY — every declared section id really exists in the page or its panels', () => {
  // Three files, one contract: the phase list names DOM ids, the page and its two panels render them.
  // A rename on either side would leave coverage looking complete while the strip links to nothing.
  const source = [
    readFileSync(PAGE, 'utf8'),
    readFileSync(PANEL, 'utf8'),
    readFileSync(CONFIG, 'utf8'),
  ].join('\n');
  for (const p of PIPELINE_PHASES) {
    for (const id of p.sections) {
      assert.ok(
        source.includes(`id="${id}"`),
        `${p.id} claims section id "${id}" but nothing renders it`,
      );
    }
  }
});

test('the absent list is not empty, because a backtest legitimately cannot cover every stage', () => {
  assert.ok(absentPhases().length > 0);
});

test('▶ CANARY — every phase is a node on the pipeline graph, or is declared an extension', () => {
  // This is the GUARDRAIL SEED the owner asked for on 2026-11-20: the graph lab is the system diagram,
  // so a stage list that drifts from it must fail rather than quietly become a second diagram. A phase
  // invented here without touching the graph is exactly the "new pathway because it is shorter route"
  // this is meant to catch.
  const graph = readFileSync(GRAPH, 'utf8');
  for (const p of PIPELINE_PHASES) {
    const drawn = graph.includes(`id: '${p.id}'`);
    const declared = Object.hasOwn(NOT_A_GRAPH_NODE, p.id);
    assert.ok(
      drawn || declared,
      `${p.id} is neither a node on PipelineGraphLabPage nor declared in NOT_A_GRAPH_NODE — `
      + 'either add it to the diagram or say why it is not a pipeline stage',
    );
    assert.ok(
      !(drawn && declared),
      `${p.id} is both drawn on the graph and declared an extension — remove the exemption`,
    );
  }
});
