#!/usr/bin/env node
/**
 * db-schema.cjs — print the REAL columns and types for one or more tables, from the live database.
 *
 * WHY THIS EXISTS
 * ---------------
 * Measured 2026-09-25: an agent guessed a column name six times in one session and was wrong more
 * than half of them — `trade.ticker`, `protocol.denominatorMode`, `ab_pair.name`,
 * `trading_strategy.abPairId`, and `score_snapshot.protocolId`'s TYPE (a slug in a varchar(36)
 * column). Every one was a single `SHOW COLUMNS` away, and every wrong guess produced a query that
 * returned NO ROWS rather than an error — the "plausible result, no error" shape this repo keeps
 * re-finding. Four of those six cost a full round trip before the mistake was visible.
 *
 * The repo already states the principle for COUNTS (`docs-facts.cjs`: "quote nothing from memory —
 * either read it here, or query the endpoint"). This is the same rule applied to the SCHEMA, which
 * that tool deliberately does not cover.
 *
 * The point is not that agents cannot look this up. It is that looking it up must be CHEAPER than
 * guessing. One command, no quoting, no remembered password.
 *
 * ⚠️ READ-ONLY BY CONSTRUCTION. This script issues `SELECT` against `information_schema` only. It
 * never writes, never migrates, and never touches a live table's rows.
 *
 * ⚠️ IT MUST FAIL LOUDLY. If the database cannot be reached, that is an ERROR and a non-zero exit —
 * never an empty table. A schema tool that prints "no columns" because MySQL was down is worse than
 * no tool, because the reader concludes the table does not exist. (Same rule as
 * `change-completion.instructions.md`: *a verifier that cannot read its input must ERROR, never pass*.)
 *
 * USAGE
 *   node scripts/db-schema.cjs <table> [<table> ...]     # columns + types
 *   node scripts/db-schema.cjs --pattern 'ab_%'          # discover tables by name
 *   node scripts/db-schema.cjs --self-test               # prove the guard can FAIL (no DB needed)
 *
 * DATABASE_URL is read from `nest/.env` — the same file the app reads. It is never hardcoded here,
 * because a second copy of a credential is a second thing to rot.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const REPO_ROOT = path.resolve(__dirname, '..');
const ENV_PATH = path.join(REPO_ROOT, 'nest', '.env');
const DB_NAME_FALLBACK = 'tradingcs';

// ⚠️ THE CONNECTION LAYER LIVES IN ONE PLACE NOW: `scripts/lib/mysql-cli.cjs`, which carries the
// guards, their docblocks and their self-test. This file used to define them itself, unexported, so
// any second tool needing the database had to copy them or invent its own — and that duplication is
// what the repo names as its most expensive kind of technical debt. This file now CONSUMES the one
// implementation, so the two cannot drift. `selfTest()` below still runs its cases against these
// imported bindings, so the proof is unchanged.
const { assertIdentifier, assertPattern, query, connect, selfTest } = require('./lib/mysql-cli.cjs');

/** mysql://user:pass@host:port/db  ->  the pieces the CLI needs. */

function columnsFor(tables, conn) {
  const list = tables.map((t) => `'${assertIdentifier(t)}'`).join(',');
  const sql =
    `SELECT TABLE_NAME, COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_KEY, COLUMN_DEFAULT, EXTRA ` +
    `FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() ` +
    `AND TABLE_NAME IN (${list}) ORDER BY TABLE_NAME, ORDINAL_POSITION`;
  const out = query(sql, conn);
  const rows = out.split(/\r?\n/).filter(Boolean).slice(1).map((l) => l.split('\t'));
  return rows;
}

function tablesMatching(pattern, conn) {
  assertPattern(pattern);
  const sql =
    `SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() ` +
    `AND TABLE_NAME LIKE '${pattern}' ORDER BY TABLE_NAME`;
  return query(sql, conn).split(/\r?\n/).filter(Boolean).slice(1).map((r) => r.trim());
}

// (assertPattern moved to scripts/lib/mysql-cli.cjs — imported at the top of this file.)

// ── self-test ────────────────────────────────────────────────────────────────────────────────
/**
 * Proves the guard can FAIL, in both directions, without needing a database.
 *
 * ⚠️ This exists because its author's previous script (`audit-directive-reachability.cjs`) produced
 * TWO contradictory answers on two runs and both were wrong — it had no self-test, so nothing
 * noticed. A guard that has never been observed to fail is a decoration
 * (development-philosophy §5).
 */
// The self-test LIVES IN THE LIBRARY now (`scripts/lib/mysql-cli.cjs`) and covers the same 13 cases
// against the same guards — it moved with the code it tests, so the proof and the implementation
// cannot drift apart. `--self-test` below calls it.

// ── main ─────────────────────────────────────────────────────────────────────────────────────
function main() {
  const argv = process.argv.slice(2);
  // ⚠️ `selfTest()` now returns a FAILURE COUNT instead of exiting — the library must not decide
  // when the process ends. (It also never exits from a library: a caller may want to continue.)
  if (argv.includes('--self-test')) return process.exit(selfTest() ? 1 : 0);

  try {
    const conn = connect();

    if (argv.includes('--pattern')) {
      const pattern = argv[argv.indexOf('--pattern') + 1];
      if (!pattern) throw new Error('--pattern needs a value, e.g. --pattern "ab_%"');
      const found = tablesMatching(pattern, conn);
      if (!found.length) {
        // A real answer, but say what it was asked — an empty list and a failed query must differ.
        console.log(`\n  0 tables match '${pattern}' in ${conn.database} (query succeeded)\n`);
        return;
      }
      console.log(`\n  ${found.length} table(s) matching '${pattern}' in ${conn.database}:\n`);
      for (const t of found) console.log(`    ${t}`);
      console.log('');
      return;
    }

    const tables = argv.filter((a) => !a.startsWith('--'));
    if (!tables.length) {
      console.log('usage: node scripts/db-schema.cjs <table> [<table>...]');
      console.log('       node scripts/db-schema.cjs --pattern \'ab_%\'');
      console.log('       node scripts/db-schema.cjs --self-test');
      process.exit(1);
    }

    const rows = columnsFor(tables, conn);
    const seen = new Set(rows.map((r) => r[0]));

    for (const t of tables) {
      if (!seen.has(t)) {
        // ⚠️ NOT an empty section. A named table that does not exist is an ERROR, because printing
        // nothing would read as "this table has no columns".
        console.error(`\n  ERROR: table "${t}" does not exist in ${conn.database}`);
        process.exitCode = 1;
        continue;
      }
      console.log(`\n  ${t}`);
      console.log(`  ${'column'.padEnd(30)} ${'type'.padEnd(22)} null  key   default`);
      console.log('  ' + '-'.repeat(84));
      for (const r of rows.filter((x) => x[0] === t)) {
        const [, col, type, nullable, key, def, extra] = r;
        console.log(
          `  ${col.padEnd(30)} ${type.padEnd(22)} ${(nullable === 'YES' ? 'YES' : 'no').padEnd(5)} ` +
            `${(key || '').padEnd(5)} ${def ?? ''}${extra ? '  ' + extra : ''}`,
        );
      }
    }
    console.log('');
    console.log('  ⚠️ Read the TYPE, not just the name. `score_snapshot.protocolId` is varchar(36) and');
    console.log('     holds a SLUG; `watchlist.protocolId` is varchar(100) and holds a UUID. Same name,');
    console.log('     different thing — joining one to `protocol.id` returns nothing, silently.\n');
  } catch (err) {
    console.error(`\n  db-schema ERROR: ${err.message}\n`);
    process.exit(1);
  }
}

main();
