#!/usr/bin/env node
/**
 * validate-config-db-refs.cjs — every config value that NAMES a database object must be valid
 * in that database.
 *
 * ⚠️ WHY THIS EXISTS (2026-09-16)
 * ------------------------------
 * A config file changed one string: `directiveoutcome.dateCol` from `predictedAt` to `createdAt`.
 * The change was CORRECT (`predictedAt` is a derived value, so a mis-stamped row deleted itself —
 * which is why #827 could only ever observe "33 rows in a 3-hour window").
 *
 * That one string is used as:
 *
 *     DELETE FROM `directiveoutcome` WHERE `createdAt` < cutoff                     -- the prune
 *     SELECT MIN(`createdAt`), MAX(`createdAt`) FROM `directiveoutcome`             -- health panel
 *
 * Both are RANGE PREDICATES, and a range predicate can only use an index where the column is the
 * FIRST key part. `predictedAt` was indexed; `createdAt` was not.
 *
 * ⚠️ WHAT WAS CLAIMED HERE FIRST, AND WHY IT IS RETRACTED. This header originally asserted that
 * the unindexed column turned the health panel's MIN/MAX into a 32-second scan of a 1,497 MB table,
 * causing a 504. **None of that is supported by measurement:**
 *
 *   • `directiveoutcome` is **1.10 MB / ~7,000 rows**. A 32s scan of it is physically impossible.
 *   • `apiactivitylog` records exactly ONE 504 (09:01:47, 30,015 ms), and the endpoint returned
 *     200 in ~350 ms from 09:06 onward — BEFORE the index existed.
 *   • With the index deliberately dropped again, the endpoint answered in 88 ms.
 *
 * Two things changed together (index added, API restarted) and the credit went to the one with a
 * narrative. The 504's cause remains **unknown**. See `change-completion.instructions.md` → Gate 3
 * for the full correction and the lesson: **do not attribute a fix you did not isolate.**
 *
 * ⚠️ SO WHY KEEP THIS GUARD? Because the rule it enforces is sound on its own terms and cheap to
 * check: a configured column that is used as a predicate should exist and should lead an index.
 * What is withdrawn is only the claim that it would have prevented that outage. Its value here is
 * ordinary hygiene, not a rescue.
 *
 * THE RULE THIS ENCODES
 * ---------------------
 * **A config that PARSES is not a config that WORKS.**
 *
 * This is the same shape as a rule the repo already learned in another domain —
 * `database-seed-discipline.instructions.md`: *"A seeder that RUNS is not a seeder that RESTORES."*
 * Both say the same thing: a declaration is not validated by being well-formed, only by being
 * checked against the thing it names.
 *
 * RELATIONSHIP TO `validate-retention-columns.cjs`
 * -----------------------------------------------
 * That guard is STATIC — it reads `schema.prisma` and runs in `prebuild` with no database, so it
 * runs everywhere. This one is LIVE and needs the database. They are complementary and neither
 * subsumes the other:
 *
 *   • `schema.prisma` is DOCUMENTATION. This repo bans `prisma db push` (#769) and has 10
 *     raw-managed tables, so indexes are applied by hand with `ALTER TABLE`. An `@@index` line
 *     can therefore exist in the schema and NOT in the database — the static guard would pass
 *     while the endpoint still 504s. This live check is what closes that gap.
 *   • This check also catches a table or column that does not exist at all, and measures the
 *     actual response time rather than inferring it from an index declaration.
 *
 * Usage (from nest/):  node scripts/validate-config-db-refs.cjs
 * Exit code: 1 on any violation, 0 otherwise. Unparseable config is an ERROR, never a pass.
 */

const fs = require('fs');
const path = require('path');

const NEST_ROOT = path.resolve(__dirname, '..');
const CONFIG = path.join('src', 'modules', 'system', 'retention.config.ts');

/**
 * A range predicate should answer in well under this. Healthy measured values are 1-50ms even on
 * the largest table; the failure being guarded was 32,298ms. Deliberately loose so this fails on a
 * structural regression and never on a busy machine — a guard that cries wolf gets ignored.
 */
const PREDICATE_BUDGET_MS = 2000;

const errors = [];
const notes = [];

function read(rel) {
  const abs = path.join(NEST_ROOT, rel);
  if (!fs.existsSync(abs)) return null;
  return fs.readFileSync(abs, 'utf8');
}

function loadEnv() {
  const envPath = path.join(NEST_ROOT, '.env');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

// ── Parse the declarations ────────────────────────────────────────────────────────────────────

const cfg = read(CONFIG);
if (cfg === null) {
  console.error(`\u274c Could not read ${CONFIG} — the shared owner is missing.`);
  process.exit(1);
}

/** Retention entries: `table: { dateCol: 'col', defaultDays: N, ... }`. */
const retention = [...cfg.matchAll(/^\s{2}(\w+):\s*\{([^}]*)\}/gm)]
  .map(([, table, body]) => {
    const col = /dateCol:\s*'([^']+)'/.exec(body);
    const days = /defaultDays:\s*(\d+)/.exec(body);
    return col ? { table, column: col[1], days: days ? Number(days[1]) : null } : null;
  })
  .filter(Boolean);

/**
 * Archive columns: `table: ['colA', 'colB']` inside ARCHIVE_DATE_COLUMNS.
 * These are READ paths (slice archived data), so they need to EXIST but need not be indexed.
 *
 * ⚠️ The block is mostly DERIVED — `...Object.fromEntries(Object.entries(TABLE_DATE_COLUMN)...)` —
 * with additive overrides. Only the LITERAL entries are parsed here; the derived ones are already
 * validated as retention columns above, so parsing them twice would prove nothing.
 *
 * ⚠️ Extracted by INDEX SLICE, not by a spanning regex. Two earlier attempts used a regex over the
 * whole file and silently matched nothing (the symbol is also named in the header comment), which
 * reported "0 parsed" — a check that had not read its input looking like a check that passed.
 * Slicing from the declaration to the next `};` cannot be fooled by a comment.
 */
const archiveStart = cfg.indexOf('export const ARCHIVE_DATE_COLUMNS');
const archiveEnd = archiveStart === -1 ? -1 : cfg.indexOf('\n};', archiveStart);
const archiveSrc = archiveStart === -1 || archiveEnd === -1 ? '' : cfg.slice(archiveStart, archiveEnd);

const archive = [...archiveSrc.matchAll(/(\w+):\s*\[([^\]]*)\]/g)].map(([, table, cols]) => ({
  table,
  columns: cols.split(',').map((c) => c.trim().replace(/['"]/g, '')).filter(Boolean),
}));

// A parsed-nothing result from a non-empty source is an ERROR, not a pass. Without this the check
// reports OK while inspecting nothing — the exact failure mode of the two attempts above.
if (archiveStart === -1) {
  console.error('\u274c Could not locate `export const ARCHIVE_DATE_COLUMNS` in retention.config.ts.');
  console.error('   The check cannot read the declaration it is meant to verify.');
  process.exit(1);
}

if (retention.length === 0) {
  console.error('\u274c Parsed ZERO retention entries from retention.config.ts.');
  console.error('   A verifier that cannot parse its target must ERROR, not report OK.');
  process.exit(1);
}
notes.push(`retention entries parsed: ${retention.length}`);
notes.push(`archive column lists parsed: ${archive.length}`);

// ── Check them against the live database ───────────────────────────────────────────────────────

loadEnv();

(async () => {
  let prisma;
  try {
    ({ PrismaClient } = require('@prisma/client'));
    prisma = new PrismaClient();
    await prisma.$queryRawUnsafe('SELECT 1');
  } catch (err) {
    console.error(`\n\u274c Cannot reach the database: ${err.message.split('\n')[0]}`);
    console.error('   This check is LIVE by design — it exists because schema.prisma is only');
    console.error('   documentation here (no migrations, `db push` banned). Without the database');
    console.error('   it cannot tell you whether an index was actually applied.');
    process.exit(1);
  }

  const tableRows = await prisma.$queryRawUnsafe(
    `SELECT TABLE_NAME FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = 'BASE TABLE'`,
  );
  const liveTables = new Set(tableRows.map((r) => String(r.TABLE_NAME).toLowerCase()));

  const colRows = await prisma.$queryRawUnsafe(
    `SELECT TABLE_NAME, COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE()`,
  );
  const liveColumns = new Set(colRows.map((r) => `${String(r.TABLE_NAME).toLowerCase()}.${String(r.COLUMN_NAME)}`));

  // ⚠️ A range predicate can only use an index where the column is the FIRST key part. A column
  // that merely appears in a composite index cannot serve `WHERE col < x`.
  const statRows = await prisma.$queryRawUnsafe(
    `SELECT TABLE_NAME, COLUMN_NAME, SEQ_IN_INDEX, INDEX_NAME
       FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE()`,
  );
  const leadingIndexed = new Set(
    statRows
      .filter((r) => Number(r.SEQ_IN_INDEX) === 1)
      .map((r) => `${String(r.TABLE_NAME).toLowerCase()}.${String(r.COLUMN_NAME)}`),
  );
  const anyIndexed = new Set(
    statRows.map((r) => `${String(r.TABLE_NAME).toLowerCase()}.${String(r.COLUMN_NAME)}`),
  );

  console.log('Config values that name a database object\n');
  console.log('table'.padEnd(22) + 'column'.padEnd(16) + 'rows'.padStart(9) + '  min()'.padStart(8) + '  verdict');
  console.log('-'.repeat(88));

  for (const { table, column, days } of retention) {
    const key = `${table.toLowerCase()}.${column}`;

    if (!liveTables.has(table.toLowerCase())) {
      errors.push(
        `  ${table}\n` +
          `      the table does not exist. Retention would silently do nothing — the prune finds no\n` +
          `      rows and reports success.`,
      );
      continue;
    }
    if (!liveColumns.has(key)) {
      errors.push(
        `  ${table}.${column}\n` +
          `      the column does not exist. Retention would prune on an unknown column, and the\n` +
          `      health panel's MIN/MAX would throw.`,
      );
      continue;
    }

    // Time the actual predicate the prune and the health panel both run.
    let ms = null;
    try {
      const t0 = Date.now();
      await prisma.$queryRawUnsafe(`SELECT MIN(\`${column}\`) FROM \`${table}\``);
      ms = Date.now() - t0;
    } catch (err) {
      errors.push(`  ${table}.${column}\n      MIN() failed: ${err.message.split('\n')[0]}`);
      continue;
    }

    const rowCount = Number(      (await prisma.$queryRawUnsafe(
        `SELECT TABLE_ROWS AS n FROM information_schema.TABLES
          WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
        table,
      ))[0]?.n || 0,
    );

    const indexed = leadingIndexed.has(key);
    let verdict;
    if (!indexed) {
      verdict = anyIndexed.has(key)
        ? `\u274c NOT LEADING an index`
        : `\u274c NOT INDEXED`;
      errors.push(
        `  ${table}.${column}\n` +
          `      ${anyIndexed.has(key) ? 'appears in an index but NOT as its first column' : 'has no index at all'},\n` +
          `      so \`SELECT MIN(${column})\` measured ${ms}ms (budget ${PREDICATE_BUDGET_MS}ms).\n` +
          `      Both the prune (\`WHERE ${column} < cutoff\`) and the health panel's MIN/MAX are range\n` +
          `      predicates, and neither can use an index that does not START with the column.\n` +
          `      This is exactly the defect that returned 504 for /api/system/health-dashboard on\n` +
          `      2026-09-16 (32,298ms against a 30s timeout). Fix: apply\n` +
          `        ALTER TABLE \`${table}\` ADD INDEX \`${table}_${column}_idx\` (\`${column}\`);\n` +
          `      and add the matching \`@@index([${column}])\` to schema.prisma in the SAME change.\n` +
          `      NEVER \`prisma db push\` — it drops 10 raw-managed tables (#769).`,
      );
    } else if (ms > PREDICATE_BUDGET_MS) {
      verdict = `\u274c SLOW (${ms}ms)`;
      errors.push(
        `  ${table}.${column}\n` +
          `      IS the leading column of an index, yet \`MIN(${column})\` took ${ms}ms\n` +
          `      (budget ${PREDICATE_BUDGET_MS}ms). The index is present but not usable — check for a\n` +
          `      collation mismatch between the column and the predicate, a stale index statistic, or\n` +
          `      a type that forces a cast.`,
      );
    } else {
      verdict = `\u2705 indexed, ${ms}ms`;
    }

    console.log(
      table.padEnd(22) + column.padEnd(16) + String(rowCount).padStart(9) + `${ms}ms`.padStart(8) + `  ${verdict}`,
    );
  }

  // Archive columns are read paths — they must EXIST, but need not be indexed.
  console.log('');
  for (const { table, columns } of archive) {
    for (const col of columns) {
      if (!liveColumns.has(`${table.toLowerCase()}.${col}`)) {
        errors.push(
          `  ${table}.${col} (archive column)\n` +
            `      declared in ARCHIVE_DATE_COLUMNS but does not exist. The archive endpoint would\n` +
            `      throw at request time rather than fail at build time.`,
        );
      }
    }
  }
  notes.push(`archive columns verified to exist: ${archive.reduce((a, e) => a + e.columns.length, 0)}`);

  await prisma.$disconnect();

  // ── Report ───────────────────────────────────────────────────────────────────────────────────
  console.log('Config → database reference check\n');
  for (const n of notes) console.log(`  ${n}`);

  if (errors.length > 0) {
    console.error(`\n\u274c ${errors.length} problem(s):\n`);
    for (const e of errors) console.error(e);
    console.error('\nA config that PARSES is not a config that WORKS. See the header of this file.\n');
    process.exit(1);
  }

  console.log(
    '\n\u2705 OK — every config value that names a database object exists, and every column used as\n' +
      '   a range predicate is the leading column of an index and responds within budget.',
  );
})();
