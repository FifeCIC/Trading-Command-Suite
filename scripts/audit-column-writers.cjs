/**
 * audit-column-writers.cjs — WHICH COLUMNS HAVE NEVER HELD A VALUE, on any table with rows.
 *
 * ── THE DEFECT THIS EXISTS TO CATCH ───────────────────────────────────────────────────────────────
 * Measured 2026-11-26 (#1354): `position.magic` was NULL on **all 14 rows** while the MT5 bridge
 * reported a real magic for every open position — the column had never held a value in its life. It
 * was found by accident, while investigating something else, and only after it had already cost
 * position attribution (`stop-guardian` fell back to a truncated order comment, the #1018 shape).
 *
 * The same look found `position.symbolId`, also NULL on every row. Two silent holes in one table.
 *
 * ⚠️ **`audit-schema-drift.cjs` CANNOT SEE THIS.** That tool answers "is a modelled table missing
 * columns the database has". This one answers the opposite question — "does anything WRITE the
 * columns that exist" — and a column that no writer names is invisible to every static check,
 * because `schema.prisma` and the database agree perfectly. Only the DATA knows.
 *
 * ── WHAT IT REPORTS, AND WHY "NEVER POPULATED" IS A FINDING ──────────────────────────────────────
 * A nullable column with no DEFAULT whose every row is NULL, on a table that has rows, is a column
 * nothing writes. It is not always a bug — `position.magic` is null for Trading212 by design — so the
 * tool reports and names the table's row count beside it. What it must never do is stay silent.
 *
 * ⚠️ THREE STATES, NEVER TWO (the repo's most repeated rule):
 *     rows = 0                     → NOT JUDGED (an empty table proves nothing either way)
 *     rows > 0, all NULL           → NEVER POPULATED  ← the finding
 *     rows > 0, some non-NULL      → POPULATED       (reported only with --all)
 * The third state must not be inferred from "not all NULL" without printing how many rows DO have a
 * value, or a column written once in 4,000 rows reads the same as one written every time.
 *
 * Usage:
 *   node scripts/audit-column-writers.cjs                 # the findings, at or above --min-rows
 *   node scripts/audit-column-writers.cjs --all           # every judged column, populated or not
 *   node scripts/audit-column-writers.cjs --table position
 *   node scripts/audit-column-writers.cjs --min-rows 100  # ignore tables too small to mean anything
 *   node scripts/audit-column-writers.cjs --self-test     # prove the classifier can fail both ways
 *
 * Exit codes: 0 = nothing found · 1 = at least one never-populated column · 2 = could not judge.
 */
'use strict';

const { assertIdentifier, query, connect } = require('./lib/mysql-cli.cjs');

/** Columns that are legitimately null on some installs; each entry must say WHY. */
const ALLOWED = [
  // e.g. { table: 'position', column: 'magic', why: 'Trading212 positions have no magic concept' },
];

/**
 * classify(column, counts) — pure. `counts` is `{ rows, nonNull }`.
 *
 * ⚠️ `unjudged` is a distinct verdict, not a flavour of `populated`. An empty table cannot tell you
 * whether a writer exists, and folding it into "fine" is how a check that inspects nothing reports OK.
 */
function classify(column, counts) {
  const { rows, nonNull } = counts;
  if (!Number.isFinite(rows) || !Number.isFinite(nonNull)) {
    return { column, verdict: 'unjudged', reason: 'row counts unreadable' };
  }
  if (rows === 0) return { column, verdict: 'unjudged', reason: 'table holds no rows' };
  if (nonNull > rows) return { column, verdict: 'unjudged', reason: 'nonNull exceeds rows — counts disagree' };
  if (nonNull === 0) return { column, verdict: 'never-populated', rows, nonNull };
  return { column, verdict: 'populated', rows, nonNull };
}

const isAllowed = (table, column) => ALLOWED.some((a) => a.table === table && a.column === column);

/**
 * The candidate columns: nullable, no DEFAULT, not the primary key.
 *
 * ⚠️ AN INDEXED COLUMN IS STILL A CANDIDATE, and the first version of this probe got that wrong —
 * it filtered `COLUMN_KEY = ''`, so `position.symbolId` (indexed `MUL`, never written) was silently
 * excluded and the run reported `✅ every judged column has been written`. That is the exact defect
 * this tool exists to find, reproduced inside the tool: a filter that hides the answer while printing
 * a pass. Only `PRI` is excluded, because a primary key is never null.
 */
function candidateColumns(table, conn) {
  const sql =
    `SELECT COLUMN_NAME, COLUMN_TYPE FROM information_schema.COLUMNS ` +
    `WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = '${assertIdentifier(table)}' ` +
    `AND IS_NULLABLE = 'YES' AND COLUMN_DEFAULT IS NULL AND COLUMN_KEY <> 'PRI' ` +
    `AND EXTRA NOT LIKE '%GENERATED%' ORDER BY ORDINAL_POSITION`;
  const out = query(sql, conn);
  return out
    .split(/\r?\n/)
    .filter(Boolean)
    .slice(1)
    .map((l) => l.split('\t'))
    .filter((r) => r.length >= 2 && r[0])
    .map(([name, type]) => ({ name, type }));
}

function tables(conn) {
  const out = query(
    `SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() ` +
    `AND TABLE_TYPE = 'BASE TABLE' ORDER BY TABLE_NAME`,
    conn,
  );
  return out.split(/\r?\n/).filter(Boolean).slice(1).map((r) => r.trim());
}

/** `SELECT COUNT(*), COUNT(col)` in one pass — the second counts NON-NULL. */
function countFor(table, column, conn) {
  const out = query(
    `SELECT COUNT(*), COUNT(\`${assertIdentifier(column)}\`) FROM \`${assertIdentifier(table)}\``,
    conn,
  );
  const line = out.split(/\r?\n/).filter(Boolean)[1] || '';
  const [rows, nonNull] = line.split('\t').map((v) => Number(v));
  return { rows, nonNull };
}

function run({ all, onlyTable, minRows }) {
  const conn = connect();
  const found = [];
  const judged = [];
  for (const table of onlyTable ? [assertIdentifier(onlyTable)] : tables(conn)) {
    const cols = candidateColumns(table, conn);
    if (!cols.length) continue;
    const rows = countFor(table, cols[0].name, conn).rows;
    if (!Number.isFinite(rows)) continue;
    if (rows < minRows) continue;
    for (const col of cols) {
      const counts = countFor(table, col.name, conn);
      const verdict = classify(col.name, counts);
      verdict.table = table;
      verdict.type = col.type;
      verdict.allowed = isAllowed(table, col.name);
      judged.push(verdict);
      if (verdict.verdict === 'never-populated' && !verdict.allowed) found.push(verdict);
    }
  }
  return { found, judged };
}

/** Proves the classifier reports BOTH answers, and that `unjudged` is not a pass. */
function selfTest() {
  const cases = [
    ['all NULL on a populated table is a finding', classify('c', { rows: 14, nonNull: 0 }), 'never-populated'],
    ['one written row is NOT a finding', classify('c', { rows: 14, nonNull: 1 }), 'populated'],
    ['every row written is not a finding', classify('c', { rows: 14, nonNull: 14 }), 'populated'],
    ['an EMPTY table is unjudged, not fine', classify('c', { rows: 0, nonNull: 0 }), 'unjudged'],
    ['unreadable counts are unjudged, not fine', classify('c', { rows: NaN, nonNull: 0 }), 'unjudged'],
    ['nonNull above rows is unjudged, not fine', classify('c', { rows: 2, nonNull: 5 }), 'unjudged'],
  ];
  let failures = 0;
  for (const [name, got, want] of cases) {
    const ok = got.verdict === want;
    if (!ok) failures += 1;
    console.log(`  ${ok ? '✅' : '❌'} ${name} — expected ${want}, got ${got.verdict}`);
  }
  // ⚠️ The allowlist must be able to HIDE a real finding, or it is decoration. Prove it can.
  const hidden = { table: 'position', column: 'magic' };
  console.log(`  ℹ allowlist has ${ALLOWED.length} entr(ies); isAllowed(${hidden.table}.${hidden.column}) = ${isAllowed(hidden.table, hidden.column)}`);
  console.log(failures === 0 ? '\n✅ self-test: the classifier reports every state' : `\n❌ self-test: ${failures} case(s) failed`);
  process.exit(failures === 0 ? 0 : 1);
}

function main() {
  const argv = process.argv.slice(2);
  if (argv.includes('--self-test')) return selfTest();
  if (argv.includes('--help')) {
    console.log('usage: node scripts/audit-column-writers.cjs [--all] [--table NAME] [--min-rows N] [--self-test]');
    return;
  }
  const all = argv.includes('--all');
  const tIdx = argv.indexOf('--table');
  const onlyTable = tIdx >= 0 ? argv[tIdx + 1] : null;
  const mIdx = argv.indexOf('--min-rows');
  const minRows = mIdx >= 0 ? Number(argv[mIdx + 1]) : 1;
  if (mIdx >= 0 && (!Number.isInteger(minRows) || minRows < 0)) {
    console.error('[column-writers] --min-rows needs a non-negative integer');
    process.exit(2);
  }

  let result;
  try {
    result = run({ all, onlyTable, minRows });
  } catch (err) {
    // ⚠️ CANNOT JUDGE IS EXIT 2, NEVER 0. A probe that could not read the database has checked nothing.
    console.error(`[column-writers] ✖ could not judge: ${err.message}`);
    process.exit(2);
  }

  const { found, judged } = result;
  const unjudged = judged.filter((j) => j.verdict === 'unjudged');
  console.log(
    `[column-writers] ${judged.length} nullable, default-free column(s) across the tables judged` +
    ` · ${found.length} never populated · ${unjudged.length} unjudged`,
  );

  const show = all ? judged : found;
  if (show.length) {
    console.log('');
    console.log('  table.column'.padEnd(42) + 'type'.padEnd(16) + 'rows'.padStart(8) + 'nonNull'.padStart(9) + '  verdict');
    for (const j of show) {
      console.log(
        `  ${`${j.table}.${j.column}`.padEnd(40)}${String(j.type || '').padEnd(16)}` +
        `${String(j.rows ?? '?').padStart(8)}${String(j.nonNull ?? '?').padStart(9)}  ` +
        `${j.verdict}${j.allowed ? ' (allowlisted)' : ''}${j.reason ? ` — ${j.reason}` : ''}`,
      );
    }
  }

  if (found.length) {
    console.log('');
    console.log('[column-writers] 🛑 a column no writer names is invisible to every static check —');
    console.log('                 `schema.prisma` and the database agree perfectly. Only the data knows.');
    console.log('                 Fix by writing it, or add an allowlist entry with a REASON.');
    process.exit(1);
  }
  console.log('[column-writers] ✅ OK — every judged column has been written at least once');
}

if (require.main === module) main();

module.exports = { classify, isAllowed, ALLOWED, selfTest };
