/**
 * pipeline-phases.js — THE STAGE LIST a bespoke strategy page is measured against.
 *
 * ── THE IDEA, AND WHAT IT IS WORTH ──────────────────────────────────────────────────────────────
 * A page built for one strategy is easy to make incomplete: it shows the stages whoever wrote it
 * happened to think of. The META.Stack pipeline already has a canonical stage list — the 15 nodes on
 * `/development/pipeline-graph-lab` — so a page can declare, for each stage, either the sections that
 * cover it or the reason it has nothing here. Anything else is a stage nobody noticed was missing.
 *
 * ⚠️ THIS IS A CHECKLIST, NOT A DATA SOURCE. The graph lab's node TEXT is illustrative and partly
 * stale (measured 2026-11-20: it still says "99 Directives · 32 Protocols" against 60 registered
 * protocols, and "3 Bots" against 64 active strategies). Only the stage IDS and their meaning are used
 * here; every number a page shows must come from an endpoint.
 *
 * ⚠️ AND IT IS DELIBERATELY NOT A PAGE BUILDER. The temptation is to let this file drive rendering —
 * columns, panels, order. That is the point at which a checklist becomes a poor layout engine: the
 * depth view needs two linked tables and a decomposition, not a card. So a phase names the sections
 * that serve it; how those sections look stays with the page.
 *
 * `absent` is a real answer and it is the useful one: it says "this stage exists in the system and this
 * page cannot show it", which is a finding for the next page rather than a gap a reader infers.
 */

/**
 * @typedef {Object} PipelinePhase
 * @property {string} id       stable key; also the graph-lab node id where one exists
 * @property {string} label    what the stage does, in the pipeline's own vocabulary
 * @property {string} provides what a reader should be able to answer once this stage is shown
 * @property {string[]} sections DOM ids the page renders for this stage (empty when absent)
 * @property {string} [absent] why this page shows nothing for the stage
 */

/** @type {readonly PipelinePhase[]} */
export const PIPELINE_PHASES = Object.freeze([
  {
    id: 'data',
    label: 'Data',
    provides: 'which bars exist for the day, their cadence and their freshness',
    sections: ['mvp-sec-data'],
  },
  {
    id: 'providers',
    label: 'Providers',
    provides: 'whether the bars came from a provider that was healthy at the time',
    sections: [],
    absent:
      'A backtest reads stored bars, so the provider that fetched them at the time is not part of the run. '
      + 'Reporting today’s provider health beside a historical run would state a fact about a different moment.',
  },
  {
    id: 'directives',
    label: 'Directives',
    provides: 'each directive’s score, its reason sentence, and whether it was counted',
    sections: ['mvp-sec-directives'],
  },
  {
    id: 'protocols',
    label: 'Protocol',
    provides: 'the composite, its denominator, the group split and the gate verdict',
    sections: ['mvp-sec-protocol'],
  },
  {
    id: 'scoring',
    label: 'Scoring',
    provides: 'every bar’s score beside the move it was produced in',
    sections: ['mvp-sec-bars'],
  },  {
    id: 'signals',
    label: 'Signals',
    provides: 'which bars produced an actionable class, and which were dropped by the bar gate',
    sections: ['mvp-sec-ladder'],
  },
  {
    id: 'selection',
    label: 'Selection',
    provides: 'which candidates a day’s list offered and which the ranking picked',
    sections: ['mvp-sec-selection'],
  },
  {
    id: 'bots',
    label: 'Bot configuration',
    provides: 'every trade-management number, whose record supplied it, and whether the engine applies it',
    sections: ['mvp-sec-trade-config'],
  },
  {
    id: 'automation',
    label: 'Decisions',
    provides: 'what the engine did on each bar — entered, exited, or neither',
    sections: ['mvp-sec-decisions'],
  },
  {
    id: 'execution',
    label: 'Execution',
    provides: 'entry and exit price, the bracket, and the exit reason per trade',
    sections: ['mvp-sec-execution'],
  },
  {
    id: 'portfolio',
    label: 'Outcome',
    provides: 'P/L per trade, per symbol and per day, and the totals those add to',
    sections: ['mvp-sec-outcome'],
  },
  {
    id: 'risk',
    label: 'Risk',
    provides: 'the risk multiplier that scaled each score, and the account the sizes come from',
    sections: ['mvp-sec-bars', 'mvp-sec-trade-config'],
  },
  {
    id: 'db',
    label: 'Persistence',
    provides: 'the stored run this view came from, so the same numbers can be reopened',
    sections: ['mvp-sec-persistence'],
  },  {
    id: 'alerts',
    label: 'Alerts',
    provides: 'whether anything was raised while the run was in progress',
    sections: [],
    absent:
      'A backtest is a synchronous request with no alert path. Nothing raises an alert from a simulated bar, '
      + 'so the stage has no data here and an empty panel would imply it had been checked.',
  },
  {
    id: 'bridge-mt5',
    label: 'Broker / bridge',
    provides: 'the venue the prices are for, and whether that venue could have traded the symbol',
    sections: [],
    absent:
      'The run prices off stored bars, not a live bridge, and it places no order. Broker routing is a '
      + 'live-trading stage; its absence from a backtest is correct rather than a gap.',
  },
]);

/** Phases with no section on this page, with the stated reason — a finding list, never a silent gap. */
export function absentPhases(phases = PIPELINE_PHASES) {
  return phases.filter((p) => p.sections.length === 0);
}

/**
 * How many declared sections each phase claims. Used by the guard to catch a phase claiming a section
 * that does not exist in the page — the section ids and the markup are written in two files, so a
 * rename leaves coverage looking complete while rendering nothing.
 */
export function phaseById(phases = PIPELINE_PHASES) {
  const map = new Map();
  for (const p of phases) map.set(p.id, p);
  return map;
}
