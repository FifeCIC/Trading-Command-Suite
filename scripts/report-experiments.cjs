/**
 * report-experiments.cjs — "which experiments are finished, and what do I DO about it?"
 *
 * WHY THIS EXISTS (2026-11-06, owner):
 *   "I will need agentic AI to be able to pickup on A/B tests and decide how to proceed. Else we
 *    will have clutter and strategies that run for months needlessly."
 *
 * This is the AGENT-FACING surface for `GET /api/automation/experiments`. It is a thin client on
 * purpose: the decision rule lives in `nest/src/common/trading/experiment-decision.ts` and is served
 * by the API, so the page, this script and an agent cannot disagree about what an experiment's state
 * is. A second copy of the rule here would agree today and drift at the first tuning.
 *
 * ⚠️ A DOWN API IS AN ERROR, NEVER AN EMPTY LIST. `[]` means every experiment is healthy; "could not
 * reach the API" is a third state and must not render as the first — that is exactly how a dead
 * experiment stays invisible, which is the defect this tool exists to fix.
 *
 * Usage:
 *   node scripts/report-experiments.cjs                 # table, most urgent first
 *   node scripts/report-experiments.cjs --action DECIDE # only the rows needing this action
 *   node scripts/report-experiments.cjs --todo          # everything NOT running/archived
 *   node scripts/report-experiments.cjs --json          # machine-readable, for an agent
 *   node scripts/report-experiments.cjs --self-test
 */
'use strict';

const BASE = process.env.TCS_API || 'http://localhost:3201';

const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i === -1 ? d : process.argv[i + 1]; };
const has = (n) => process.argv.includes(`--${n}`);

/** Actions that need a human or agent decision. `RUNNING` and `ARCHIVED` deliberately are not here. */
const NEEDS_ACTION = ['DECIDE', 'BLOCKED', 'NO-ARMS', 'UNMEASURED', 'INCONCLUSIVE', 'STALLED'];

/** Objective states that need a person. `ON-TIME` and `SETTLED` do not. */
const OBJECTIVE_NEEDS_ACTION = ['OVERDUE', 'NO-DATE', 'DUE-SOON'];

const ICON = {
  DECIDE: '✅',
  BLOCKED: '🛑',
  'NO-ARMS': '🚫',
  UNMEASURED: '❓',
  INCONCLUSIVE: '⌛',
  STALLED: '💤',
  RUNNING: '▶',
  ARCHIVED: '📦',
  OVERDUE: '⏰',
  'NO-DATE': '📅',
  'DUE-SOON': '⏳',
  'ON-TIME': '▶',
  SETTLED: '📦',
};

function renderRow(e) {
  const n = Object.values(e.n).map((v) => (v === null ? '?' : v)).join('/');
  const due = e.daysLeft === null ? '—' : (e.daysLeft >= 0 ? `${e.daysLeft}d left` : `${-e.daysLeft}d over`);
  const eta = e.etaDays === null ? '—' : `${e.etaDays}d`;
  return {
    action: `${ICON[e.action] || ' '} ${e.action}`,
    kind: e.kind,
    n: `${n} / ${e.requiredPerSide}`,
    due,
    eta,
    title: e.title,
    nextStep: e.nextStep,
  };
}

/**
 * The pure part: given an API payload, produce the table rows and the summary line.
 *
 * Split out so `--self-test` can exercise it WITHOUT an API or a database — a formatter that can
 * only be tested against live data is one that never gets tested.
 */
function summarise(payload, opts = {}) {
  if (!payload || !Array.isArray(payload.experiments)) {
    throw new Error('payload has no `experiments` array — refusing to render a table from nothing');
  }
  let rows = payload.experiments;
  if (opts.action) rows = rows.filter((e) => e.action === opts.action);
  if (opts.todo) rows = rows.filter((e) => NEEDS_ACTION.includes(e.action));

  const counts = {};
  for (const e of payload.experiments) counts[e.action] = (counts[e.action] || 0) + 1;

  // Objectives travel in the same payload but under their own vocabulary — a promise has a DATE,
  // not a sample, so it is summarised separately and never merged into the experiment counts.
  const objectives = Array.isArray(payload.objectives) ? payload.objectives : [];
  const objectiveRows = opts.skipObjectives ? [] : objectives
    .filter((o) => (opts.todo || opts.action ? OBJECTIVE_NEEDS_ACTION.includes(o.action) : true))
    .map((o) => ({
      action: `${ICON[o.action] || ' '} ${o.action}`,
      title: o.title,
      due: o.daysLeft === null ? 'no date' : (o.daysLeft >= 0 ? `${o.daysLeft}d left` : `${-o.daysLeft}d over`),
      progress: o.progressPct === null || o.progressPct === undefined ? '—' : `${o.progressPct}%`,
      prediction: o.hasPrediction ? 'yes' : 'no',
      nextStep: o.nextStep,
    }));
  const objectiveCounts = {};
  for (const o of objectives) objectiveCounts[o.action] = (objectiveCounts[o.action] || 0) + 1;

  return {
    rows: rows.map(renderRow),
    objectiveRows,
    todoCount: payload.experiments.filter((e) => NEEDS_ACTION.includes(e.action)).length
      + objectives.filter((o) => OBJECTIVE_NEEDS_ACTION.includes(o.action)).length,
    counts,
    objectiveCounts,
    total: payload.experiments.length,
    objectiveTotal: objectives.length,
  };
}

function selfTest() {
  let pass = 0; let fail = 0;
  const t = (n, c) => { if (c) pass++; else { fail++; console.log(`  ✖ ${n}`); } };

  const mk = (action, over = {}) => ({
    kind: 'ab-test', id: 'x', title: 'T', action, reason: 'r', nextStep: 'do it',
    requiredPerSide: 30, n: { control: 4, variant: 5 }, daysLeft: 3, etaDays: 12, ...over,
  });

  const payload = {
    experiments: [
      mk('DECIDE'), mk('BLOCKED'), mk('RUNNING'), mk('ARCHIVED'), mk('STALLED'),
      mk('UNMEASURED', { n: { control: 4, variant: null } }),
    ],
  };

  const all = summarise(payload);
  t('renders every experiment', all.rows.length === 6);
  t('counts every action', all.counts.DECIDE === 1 && all.counts.RUNNING === 1);
  t('todo excludes RUNNING and ARCHIVED', all.todoCount === 4);

  const todo = summarise(payload, { todo: true });
  t('--todo drops RUNNING', !todo.rows.some((r) => /RUNNING/.test(r.action)));
  t('--todo drops ARCHIVED', !todo.rows.some((r) => /ARCHIVED/.test(r.action)));

  // OBJECTIVES travel in the same payload but are summarised separately: a promise has a DATE, not a
  // sample. Mixing them would put a percentage next to a trade count.
  const withObj = summarise({
    experiments: [mk('RUNNING')],
    objectives: [
      { id: 'o1', title: 'A', action: 'OVERDUE', daysLeft: -5, progressPct: 40, hasPrediction: true, nextStep: 'close it' },
      { id: 'o2', title: 'B', action: 'ON-TIME', daysLeft: 30, progressPct: 0, hasPrediction: false, nextStep: 'wait' },
      { id: 'o3', title: 'C', action: 'NO-DATE', daysLeft: null, progressPct: null, hasPrediction: false, nextStep: 'date it' },
    ],
  });
  t('objectives are summarised separately from experiments', withObj.objectiveTotal === 3 && withObj.total === 1);
  t('an objective with NO date renders "no date", never 0d left', withObj.objectiveRows.some((o) => o.due === 'no date'));
  t('an overdue objective counts toward the todo total', withObj.todoCount === 2); // OVERDUE + NO-DATE
  t('ON-TIME objectives are excluded from --todo', summarise({
    experiments: [], objectives: [{ id: 'o', title: 'B', action: 'ON-TIME', daysLeft: 30, progressPct: 0, hasPrediction: false, nextStep: 'wait' }],
  }, { todo: true }).objectiveRows.length === 0);
  t('a payload with NO objectives key still renders', summarise({ experiments: [mk('RUNNING')] }).objectiveTotal === 0);

  const only = summarise(payload, { action: 'DECIDE' });
  t('--action filters to one action', only.rows.length === 1 && /DECIDE/.test(only.rows[0].action));

  const unknown = summarise(payload).rows.find((r) => /UNMEASURED/.test(r.action));
  t('an UNKNOWN sample renders as ? — never as 0', unknown.n === '4/? / 30');

  const past = summarise({ experiments: [mk('INCONCLUSIVE', { daysLeft: -4 })] }).rows[0];
  t('an overdue review date reads as "over", not negative', past.due === '4d over');

  const noEta = summarise({ experiments: [mk('RUNNING', { etaDays: null })] }).rows[0];
  t('a missing projection renders as an em dash', noEta.eta === '—');

  // A payload with no array must THROW rather than print an empty table: "nothing to report" and
  // "could not read the payload" are different answers and must never look the same.
  let threw = false;
  try { summarise({}); } catch { threw = true; }
  t('a malformed payload THROWS instead of rendering empty', threw);

  console.log(`\n[self-test] ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}

(async () => {
  if (has('self-test')) return selfTest();

  const url = `${BASE}/api/automation/experiments`;
  let payload;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    payload = await res.json();
  } catch (e) {
    // ⚠️ Distinct, loud, and NOT an empty table.
    console.error(`🛑 Could not read ${url}: ${e.message}`);
    console.error('   This is "cannot judge", not "all clear". Start the API (npm --prefix nest run start) and re-run.');
    process.exit(2);
  }

  if (has('json')) { console.log(JSON.stringify(payload, null, 2)); return; }

  const out = summarise(payload, { action: arg('action', null), todo: has('todo') });
  console.log(`\nEXPERIMENTS — ${out.total} total, ${out.todoCount} needing a decision (${payload.computedAt})\n`);
  const counts = Object.entries(out.counts).map(([k, v]) => `${ICON[k] || ''}${k} ${v}`).join(' · ');
  console.log(`  ${counts}\n`);
  if (!out.rows.length) {
    console.log('  (no experiment matches the filter)\n');
  } else {
    for (const r of out.rows) {
      console.log(`${r.action.padEnd(14)} ${r.kind.padEnd(8)} n ${r.n.padEnd(10)} due ${r.due.padEnd(10)} eta ${r.eta}`);
      console.log(`   ${r.title}`);
      console.log(`   → ${r.nextStep}\n`);
    }
  }

  if (out.objectiveTotal) {
    console.log(`\nOBJECTIVES — ${out.objectiveTotal} active, reviewed against their own date\n`);
    const oc = Object.entries(out.objectiveCounts).map(([k, v]) => `${ICON[k] || ''}${k} ${v}`).join(' · ');
    console.log(`  ${oc}\n`);
    if (!out.objectiveRows.length) { console.log('  (none need attention)\n'); return; }
    for (const o of out.objectiveRows) {
      console.log(`${o.action.padEnd(14)} ${o.due.padEnd(10)} progress ${o.progress.padEnd(5)} prediction ${o.prediction}`);
      console.log(`   ${o.title}`);
      console.log(`   → ${o.nextStep}\n`);
    }
  }
})();
