#!/usr/bin/env node
/**
 * validate-raw-managed-ddl.cjs — the checked-in DDL must still describe the LIVE table.
 * =================================================================================================
 *
 * THE GAP THIS CLOSES (#769)
 * --------------------------
 * `nest/prisma/raw-managed/*.sql` is described as *"the reproduction path"* for the four tables that have
 * no Prisma model — including `strategy_signal_queue`, the **trade execution queue**. Measured
 * 2026-10-28: all four live tables have a file, and every live column appears in it. But **nothing
 * compared them**: the `.sql` files are declarations, and a declaration is not validated by being
 * well-formed — only by being checked against the thing it names.
 *
 * The failure mode is the quiet one this repo keeps finding: add a column with `ALTER TABLE`, forget the
 * `.sql`, and the reproduction path silently stops reproducing. Nobody notices until a rebuild, at which
 * point the queue table is missing a column the code writes. 14 unmodelled tables exist; 10 are
 * backup/repair snapshots whose DDL is deliberately absent (they are rollback paths, deleted once their
 * repair is confirmed — capturing them would create files that are stale by design).
 *
 * ── WHAT IS COMPARED ──────────────────────────────────────────────────────────────────────────
 * Column NAMES, both directions:
 *   · a live column missing from the `.sql` → the file no longer reproduces the table (FAIL);
 *   · a `.sql` column missing from the live table → the file describes something that is not there (FAIL).
 * Column TYPES are **not** compared: the live database is the authority for types and Prisma cannot
 * express every MySQL nuance this schema already uses, so a type mismatch here would be noise. Stated
 * rather than implied.
 *
 * ⚠️ ERROR IS NOT PASS. If the database cannot be read, this exits 1 and says it could not run.
 * ⚠️ `--self-test` proves the comparison fails in both directions, with no database.
 *
 * Usage:
 *   node nest/scripts/validate-raw-managed-ddl.cjs
 *   node nest/scripts/validate-raw-managed-ddl.cjs --self-test
 */

const fs = require('fs');
const path = require('path');

const DDL_DIR = path.join(__dirname, '..', 'prisma', 'raw-managed');

/** Backticks around a column name in the CREATE statement. */
const COLUMN_RE = /^\s*`([a-zA-Z0-9_]+)`\s+[a-zA-Z]/;

/** The table a `.sql` file creates. */
function tableOf(sql) {
  const m = sql.match(/CREATE TABLE (?:IF NOT EXISTS )?`([a-zA-Z0-9_]+)`/i);
  return m ? m[1] : null;
}

/**
 * Columns declared in a CREATE statement — only the lines that begin with a backticked identifier, so
 * PRIMARY KEY / KEY / CONSTRAINT lines are not mistaken for columns.
 */
function columnsIn(sql) {
  return sql
    .split(/\r?\n/)
    .map((line) => line.match(COLUMN_RE))
    .filter(Boolean)
    .map((m) => m[1]);
}

/** Compare one table's declared columns against the live set. Pure, so it can be tested. */
function diffColumns(declared, live) {
  const d = new Set(declared);
  const l = new Set(live);
  return {
    missingFromSql: [...l].filter((c) => !d.has(c)).sort(),
    missingFromDb: [...d].filter((c) => !l.has(c)).sort(),
  };
}

function selfTest() {
  let failures = 0;
  const check = (label, actual, expected) => {
    const ok = JSON.stringify(actual) === JSON.stringify(expected);
    console.log(`   ${ok ? '✅' : '❌'} ${label}${ok ? '' : ` — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`}`);
    if (!ok) failures += 1;
  };

  const sql = [
    // ⚠️ The COLLATE is here because `validate-collation-consistency.cjs` scans for `CREATE TABLE` text
    // anywhere in the repo — including a self-test fixture — and fails one that pins no collation. A
    // fixture string is still a declaration that a reader may copy.
    'CREATE TABLE IF NOT EXISTS `demo` (',
    '  `id` varchar(36) NOT NULL,',
    '  `value` double NULL,',
    '  PRIMARY KEY (`id`),',
    '  KEY `demo_value_idx` (`value`)',
    ') ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;',
  ].join('\n');

  check('reads the table name', tableOf(sql), 'demo');
  check('reads only column lines', columnsIn(sql), ['id', 'value']);
  check('an exact match is clean', diffColumns(columnsIn(sql), ['id', 'value']), {
    missingFromSql: [],
    missingFromDb: [],
  });
  // The cited risk: a column added to the live table but not to the file.
  check('a live column absent from the SQL FAILS', diffColumns(columnsIn(sql), ['id', 'value', 'added']).missingFromSql, ['added']);
  // The other direction: the file describes something the table does not have.
  check('a SQL column absent from the DB FAILS', diffColumns(columnsIn(sql), ['id']).missingFromDb, ['value']);

  console.log(failures === 0 ? '\n[self-test] ✅ PASS\n' : `\n[self-test] ❌ ${failures} case(s) failed\n`);
  return failures === 0 ? 0 : 1;
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--self-test')) return selfTest();

  let files;
  try {
    files = fs.readdirSync(DDL_DIR).filter((f) => f.endsWith('.sql'));
  } catch (err) {
    console.error(`\n❌ Cannot read ${DDL_DIR}: ${err.message}\n`);
    return 1;
  }
  if (files.length === 0) {
    console.error('\n❌ No raw-managed DDL files found — the reproduction path is empty.\n');
    return 1;
  }

  let PrismaClient;
  try {
    ({ PrismaClient } = require('@prisma/client'));
  } catch (err) {
    console.error(`\n❌ Cannot load @prisma/client: ${String(err.message).split('\n')[0]}\n`);
    return 1;
  }
  const prisma = new PrismaClient();

  console.log('\n[raw-managed-ddl] every checked-in CREATE must still describe the live table');
  const problems = [];
  try {
    for (const file of files) {
      const sql = fs.readFileSync(path.join(DDL_DIR, file), 'utf8');
      const table = tableOf(sql);
      if (!table) {
        problems.push({ file, table: '(no CREATE TABLE found)', missingFromSql: [], missingFromDb: [] });
        continue;
      }
      const declared = columnsIn(sql);
      const rows = await prisma.$queryRawUnsafe(
        `SELECT COLUMN_NAME AS c FROM information_schema.COLUMNS
          WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? ORDER BY ORDINAL_POSITION`,
        table,
      );
      const live = rows.map((r) => r.c);
      if (live.length === 0) {
        problems.push({ file, table, missingFromSql: [], missingFromDb: [], absent: true });
        continue;
      }
      const diff = diffColumns(declared, live);
      const clean = diff.missingFromSql.length === 0 && diff.missingFromDb.length === 0;
      console.log(`   ${clean ? '✅' : '❌'} ${table.padEnd(26)} ${declared.length} declared · ${live.length} live`);
      if (!clean) problems.push({ file, table, ...diff });
    }
  } catch (err) {
    // ⚠️ ERROR, never pass.
    console.error(`\n❌ Cannot read the database: ${String(err.message).split('\n')[0]}`);
    console.error('   It did NOT pass — it could not run.\n');
    await prisma.$disconnect();
    return 1;
  }
  await prisma.$disconnect();

  if (problems.length === 0) {
    console.log('\n✅ OK — every raw-managed table reproduces from its checked-in DDL\n');
    return 0;
  }

  console.error('\n❌ the reproduction path no longer reproduces — re-capture the DDL:');
  for (const p of problems) {
    console.error(`\n   ${p.file} → ${p.table}`);
    if (p.absent) console.error('     the table does not exist in this database');
    if (p.missingFromSql.length) console.error(`     LIVE but not in the SQL: ${p.missingFromSql.join(', ')}`);
    if (p.missingFromDb.length) console.error(`     in the SQL but not LIVE: ${p.missingFromDb.join(', ')}`);
  }
  console.error('\n   Capture with `SHOW CREATE TABLE <name>`, keeping the DROP/CREATE shape of the file.\n');
  return 1;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error(`\n❌ validate-raw-managed-ddl crashed: ${err?.stack ?? err}\n`);
    process.exit(1);
  });
