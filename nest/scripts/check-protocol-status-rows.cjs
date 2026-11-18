#!/usr/bin/env node
/**
 * check-protocol-status-rows.cjs — a protocol that SAYS it is scoring must have persisted something.
 *
 * BLIND SPOT IT CLOSES (#1236). `leverage-v2-long` reported `state: 'scoring'`, `symbolsResolved: 79`,
 * `symbolsScored: 79` while `score_snapshot` held **zero rows for it, ever**. Every reader of score
 * history — ceiling analysis, outcome tracking, the Strategies view — saw nothing for that protocol,
 * and nothing errored. The state was a claim about INTENT; the table is the fact.
 *
 * WHAT IT ASSERTS
 *   For every protocol whose live status is `state = 'scoring'`:
 *     - `symbolsScored > 0`            (the cheap half — the state must not contradict its own count)
 *     - a row exists in `score`        (what the gating and rarity readers consume)
 *     - a row exists in `score_snapshot` (what every history reader consumes)
 *
 * ⚠️ BOTH TABLES, because they are DIFFERENT POPULATIONS ON PURPOSE (SETTLED-DECISIONS row 209):
 * `score` is the live working set, `score_snapshot` is the 90-day history. A protocol absent from one
 * of them is invisible to that table's readers while looking healthy in the other.
 *
 * ⚠️ THE ID IS A SLUG IN BOTH TABLES. `score.strategyId` and `score_snapshot.protocolId` both hold a
 * protocol SLUG — measured 2,740/2,740 against `protocol.slug`, 0 against `scoring_strategy.id`. A
 * query with a UUID returns no rows and no error, which is this repo's most expensive failure shape.
 *
 * RUNS ON DEMAND, NOT IN `prebuild` — it needs the API and a live database, so it is a check, not a
 * build gate. That is stated rather than implied, because a check nobody runs is a decoration.
 *
 * USAGE
 *   node nest/scripts/check-protocol-status-rows.cjs              # exit 1 on any violating protocol
 *   node nest/scripts/check-protocol-status-rows.cjs --base http://localhost:3201
 *   node nest/scripts/check-protocol-status-rows.cjs --self-test  # prove both directions
 */
const http = require('node:http');
const path = require('node:path');

/**
 * The rule, as a pure function so the self-test can drive it with fixtures.
 * `statuses` — [{ protocolId, status: { state, symbolsScored } }]
 * `rowCounts` — Map<slug, { score: number, score_snapshot: number }>
 * Returns `[{ protocolId, problems: string[] }]` for every violation, in input order.
 */
function violations(statuses, rowCounts) {
  const bad = [];
  for (const s of statuses) {
    const st = s.status || {};
    if (st.state !== 'scoring') continue;
    const problems = [];
    if (!(st.symbolsScored > 0)) {
      problems.push(`state is 'scoring' but symbolsScored is ${st.symbolsScored ?? 'absent'}`);
    }
    const counts = rowCounts.get(s.protocolId) || { score: 0, score_snapshot: 0 };
    if (!(counts.score > 0)) problems.push('0 rows in `score`');
    if (!(counts.score_snapshot > 0)) problems.push('0 rows in `score_snapshot`');
    if (problems.length) bad.push({ protocolId: s.protocolId, problems });
  }
  return bad;
}

function get(port, pathname) {
  return new Promise((resolve, reject) => {
    http
      .get({ host: '127.0.0.1', port, path: pathname }, (res) => {
        let b = '';
        res.on('data', (c) => (b += c));
        res.on('end', () => {
          try {
            resolve(JSON.parse(b));
          } catch (e) {
            reject(new Error(`${pathname} did not return JSON (HTTP ${res.statusCode}): ${b.slice(0, 200)}`));
          }
        });
      })
      .on('error', reject);
  });
}

function selfTest() {
  const S = (id, state, scored) => ({ protocolId: id, status: { state, symbolsScored: scored } });

  const cases = [
    [
      'a scoring protocol with rows in both tables passes',
      [S('a', 'scoring', 5)],
      new Map([['a', { score: 9, score_snapshot: 9 }]]),
      0,
      null,
    ],
    [
      '#1236 itself: scoring, counts say 79, tables hold nothing',
      [S('leverage-v2-long', 'scoring', 79)],
      new Map(),
      1,
      ['0 rows in `score`', '0 rows in `score_snapshot`'],
    ],
    [
      'rows in score but not score_snapshot is still a violation',
      [S('a', 'scoring', 3)],
      new Map([['a', { score: 4, score_snapshot: 0 }]]),
      1,
      ['0 rows in `score_snapshot`'],
    ],
    [
      'scoring with symbolsScored 0 is a violation even when rows exist',
      [S('a', 'scoring', 0)],
      new Map([['a', { score: 4, score_snapshot: 4 }]]),
      1,
      ["state is 'scoring' but symbolsScored is 0"],
    ],
    [
      'a non-scoring protocol is never judged — no-data is the honest state',
      [S('a', 'no-data', 0), S('b', 'standby', 0), S('c', 'no-symbols', 0)],
      new Map(),
      0,
      null,
    ],
    [
      'every violating protocol is reported, not just the first',
      [S('a', 'scoring', 1), S('b', 'scoring', 1)],
      new Map(),
      2,
      ['0 rows in `score`', '0 rows in `score_snapshot`'],
    ],
  ];

  let failed = 0;
  for (const [name, statuses, counts, expectedCount, expectedProblems] of cases) {
    const got = violations(statuses, counts);
    const problemsOk = !expectedProblems
      || (got.length > 0 && expectedProblems.every((p) => got[0].problems.includes(p)));
    const ok = got.length === expectedCount && problemsOk;
    if (!ok) failed += 1;
    console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${name}${ok ? '' : `  (got ${got.length}: ${JSON.stringify(got[0]?.problems ?? [])})`}`);
  }
  console.log();
  if (failed) {
    console.error(`${failed} of ${cases.length} self-test case(s) failed.`);
    return 1;
  }
  console.log(`self-test: all ${cases.length} cases behaved (violations found AND silence on healthy rows).`);
  return 0;
}

async function main() {
  if (process.argv.includes('--help')) {
    console.log('usage: check-protocol-status-rows.cjs [--self-test] [--base http://host:port]');
    return 0;
  }
  if (process.argv.includes('--self-test')) return selfTest();

  const baseArg = process.argv.indexOf('--base');
  const base = baseArg > -1 ? process.argv[baseArg + 1] : 'http://localhost:3201';
  const port = Number(new URL(base).port || 80);

  let statuses;
  try {
    ({ statuses } = await get(port, '/api/scoring/gated/protocols/status'));
  } catch (e) {
    // Cannot read the input ⇒ CANNOT JUDGE. Never a pass: a check that inspects nothing and reports
    // OK is worse than no check.
    console.error(`CANNOT JUDGE — the status endpoint could not be read (${e.message}).`);
    console.error('The API must be up. This is NOT a pass.');
    return 2;
  }
  if (!Array.isArray(statuses)) {
    console.error('CANNOT JUDGE — /api/scoring/gated/protocols/status returned no `statuses` array.');
    return 2;
  }

  const scoring = statuses.filter((s) => (s.status || {}).state === 'scoring');
  const rowCounts = new Map();
  if (scoring.length) {
    const { PrismaClient } = require(path.join(__dirname, '..', 'node_modules', '@prisma/client'));
    const prisma = new PrismaClient();
    try {
      const slugs = scoring.map((s) => s.protocolId);
      const marks = slugs.map(() => '?').join(',');
      const score = await prisma.$queryRawUnsafe(
        `SELECT strategyId AS slug, COUNT(*) AS n FROM score WHERE strategyId IN (${marks}) GROUP BY strategyId`,
        ...slugs,
      );
      const snap = await prisma.$queryRawUnsafe(
        `SELECT protocolId AS slug, COUNT(*) AS n FROM score_snapshot WHERE protocolId IN (${marks}) GROUP BY protocolId`,
        ...slugs,
      );
      for (const slug of slugs) rowCounts.set(slug, { score: 0, score_snapshot: 0 });
      for (const r of score) rowCounts.get(r.slug).score = Number(r.n);
      for (const r of snap) rowCounts.get(r.slug).score_snapshot = Number(r.n);
    } finally {
      await prisma.$disconnect();
    }
  }

  const bad = violations(statuses, rowCounts);
  console.log(`${statuses.length} protocol(s) reported; ${scoring.length} claim 'scoring'.`);
  if (!bad.length) {
    console.log(`✅ OK — every protocol claiming 'scoring' has symbolsScored > 0 and rows in both tables.`);
    return 0;
  }
  console.error(`\n${bad.length} protocol(s) claim 'scoring' without the rows to back it:`);
  for (const b of bad) console.error(`  ✖ ${b.protocolId}  —  ${b.problems.join('; ')}`);
  console.error('\n`state` must describe what was PERSISTED, not what was attempted (#1236).');
  console.error('A protocol absent from score/score_snapshot is invisible to every reader of it.');
  return 1;
}

main().then((code) => process.exit(code), (e) => {
  console.error(e);
  process.exit(2);
});
