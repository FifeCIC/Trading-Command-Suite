#!/usr/bin/env node
/**
 * check-outcome-convergence.cjs — is the directive-outcome feedback loop KEEPING UP?
 *
 * WHY THIS EXISTS (#1312, measured 2026-11-19)
 * `directiveoutcome` is the only feedback loop telling a protocol whether its directives work:
 * each row matures by filling four horizons (T+15m/1h/4h/24h) from `marketbar`, and per-directive
 * accuracy is what every tuning decision reads. Measured that morning: 44,443 rows created in 24h
 * against 31,397 completed — **+13,067 net** — while the tick's own log said `drained 1500` next to
 * `finalised 0`. Nothing anywhere compared inflow to outflow, so a loop that stops converging looks
 * exactly like a loop that is busy.
 *
 * WHAT IT REPORTS (and what each number is NOT)
 *   created24h / completed24h  — the two rates. `completed` counts `outcomeComputedAt` set in the
 *                                window, which is COMPLETION, not visit.
 *   net                        — the verdict number. Positive means the queue is diverging.
 *   unfinished / actionable    — the queue depth, and how much of it a pass can act on THIS tick.
 *                                ⚠️ THESE ARE TWO DIFFERENT POPULATIONS and the gap is the point:
 *                                `unfinished` = all rows with `outcomeComputedAt IS NULL`;
 *                                `actionable` = those with a horizon currently due and still null.
 *                                A row waiting on a T+24h that is not due yet is unfinished and
 *                                NOT actionable. Reading either as "the backlog" is the mistake.
 *
 * ⚠️ A NO-BAR WINDOW IS NOT A BROKEN LOOP. With the MT5 bridges down no bar exists for any horizon,
 * so `filled` is legitimately 0 and the queue MUST grow. This script reports the numbers; it does
 * not pretend to know why. Check the bridges before reading a failure here as a code defect.
 *
 * EXIT
 *   0  converging (completed24h >= created24h) OR the queue is small
 *   1  DIVERGING — completed24h < created24h by more than the tolerance AND the queue is large
 *   2  CANNOT JUDGE — the database could not be read. Never a pass.
 *
 * USAGE
 *   node nest/scripts/check-outcome-convergence.cjs
 *   node nest/scripts/check-outcome-convergence.cjs --self-test
 */
const path = require('node:path');

/** Divergence tolerance: a queue this size is residency, not backlog, for a 24h horizon chain. */
const QUEUE_FLOOR = 20000;

/**
 * The verdict, as a pure function so the self-test can drive it.
 * Returns { diverging, reason }.
 */
function verdict({ created24h, completed24h, unfinished, actionable }, floor = QUEUE_FLOOR) {
  if (unfinished <= floor) {
    return { diverging: false, reason: `queue is ${unfinished} row(s), at or below the ${floor} residency floor` };
  }
  if (completed24h >= created24h) {
    return { diverging: false, reason: `completed ${completed24h} >= created ${created24h}` };
  }
  return {
    diverging: true,
    reason: `completed ${completed24h} < created ${created24h} (net +${created24h - completed24h}) with ${unfinished} unfinished, ${actionable} actionable now`,
  };
}

function selfTest() {
  const cases = [
    ['keeping up', { created24h: 1000, completed24h: 1200, unfinished: 44000, actionable: 43000 }, false],
    ['diverging above the floor', { created24h: 44443, completed24h: 31397, unfinished: 44464, actionable: 43630 }, true],
    ['a big queue that is clearing is fine', { created24h: 900, completed24h: 950, unfinished: 30000, actionable: 100 }, false],
    ['a small queue below the floor is never a failure', { created24h: 5000, completed24h: 10, unfinished: 19999, actionable: 19000 }, false],
    ['equal rates are converging, not diverging', { created24h: 2000, completed24h: 2000, unfinished: 50000, actionable: 49000 }, false],
  ];
  let failed = 0;
  for (const [name, input, expected] of cases) {
    const got = verdict(input).diverging;
    const ok = got === expected;
    if (!ok) failed += 1;
    console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${name}${ok ? '' : `  (got diverging=${got}, expected ${expected})`}`);
  }
  console.log();
  if (failed) {
    console.error(`${failed} of ${cases.length} self-test case(s) failed.`);
    return 1;
  }
  console.log(`self-test: all ${cases.length} cases behaved (both verdicts, and the residency floor).`);
  return 0;
}

async function main() {
  if (process.argv.includes('--help')) {
    console.log('usage: check-outcome-convergence.cjs [--self-test]');
    return 0;
  }
  if (process.argv.includes('--self-test')) return selfTest();

  let prisma;
  let stats;
  try {
    const { PrismaClient } = require(path.join(__dirname, '..', 'node_modules', '@prisma/client'));
    prisma = new PrismaClient();
    const now = Date.now();
    const actionableWhere = {
      outcomeComputedAt: null,
      predictedAt: { lte: new Date(now - 15 * 60 * 1000) },
      OR: [
        { predictedAt: { lte: new Date(now - 15 * 60 * 1000) }, priceT15m: null },
        { predictedAt: { lte: new Date(now - 60 * 60 * 1000) }, priceT1h: null },
        { predictedAt: { lte: new Date(now - 4 * 60 * 60 * 1000) }, priceT4h: null },
        { predictedAt: { lte: new Date(now - 24 * 60 * 60 * 1000) }, priceT24h: null },
      ],
    };
    const since = new Date(now - 24 * 60 * 60 * 1000);
    stats = {
      created24h: await prisma.directiveOutcome.count({ where: { predictedAt: { gte: since } } }),
      completed24h: await prisma.directiveOutcome.count({ where: { outcomeComputedAt: { gte: since } } }),
      unfinished: await prisma.directiveOutcome.count({ where: { outcomeComputedAt: null } }),
      actionable: await prisma.directiveOutcome.count({ where: actionableWhere }),
    };
  } catch (e) {
    console.error(`CANNOT JUDGE — the database could not be read (${e.message}). This is NOT a pass.`);
    return 2;
  } finally {
    await prisma?.$disconnect?.();
  }

  console.log(`created   (24h): ${stats.created24h}`);
  console.log(`completed (24h): ${stats.completed24h}`);
  console.log(`net            : ${stats.created24h - stats.completed24h >= 0 ? '+' : ''}${stats.created24h - stats.completed24h}`);
  console.log(`unfinished     : ${stats.unfinished}   (all rows with outcomeComputedAt IS NULL)`);
  console.log(`actionable now : ${stats.actionable}   (a horizon is due and still null — what a pass can touch)`);

  const v = verdict(stats);
  if (v.diverging) {
    console.error(`\n✖ DIVERGING — ${v.reason}`);
    // ⚠️ TWO different causes, and naming only one sends the reader to the wrong place.
    // Bridges DOWN means no bar can fill any horizon, so the queue MUST grow — that is not a bug.
    // Bridges UP with `filled: 0` in the tick log is the #1312 defect (the passes re-reading the
    // same batch), which looks identical from this table alone. So both are named.
    console.error('Rule out BOTH:');
    console.error('  1. bridges DOWN → no bar can fill a horizon, so the queue must grow. Expected, not a bug.');
    console.error('     curl -s -o NUL -w "%{http_code}" http://localhost:5000/health  (and :5001)');
    console.error('  2. bridges UP but the tick log shows `filled 0` every pass → the passes are not advancing.');
    console.error('     Look for the latest "Outcome maturation: visited 250, filled …" lines in nest/logs/console-*.log');
    return 1;
  }
  console.log(`\n✅ CONVERGING — ${v.reason}`);
  return 0;
}

main().then((c) => process.exit(c), (e) => {
  console.error(e);
  process.exit(2);
});
