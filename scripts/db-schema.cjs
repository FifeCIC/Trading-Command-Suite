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

/**
 * ⚠️ IDENTIFIERS ARE INTERPOLATED INTO SQL, so they are VALIDATED, not escaped.
 * A table name arrives from `argv`; anything outside `[A-Za-z0-9_]` is refused before a query is
 * built. This is the only injection surface in the file and it is closed here rather than trusted.
 */
function assertIdentifier(name) {
  if (!/^[A-Za-z0-9_]+$/.test(name)) {
    throw new Error(
      `refusing "${name}": a table name must match [A-Za-z0-9_]+ — this is the SQL-injection guard, not a style rule`,
    );
  }
  return name;
}

/** Parse the key we need out of a .env file. Deliberately does not evaluate the file. */
function databaseUrlFromEnv(text) {
  const line = text
    .split(/\r?\n/)
    .find((l) => /^\s*DATABASE_URL\s*=/.test(l));
  if (!line) return null;
  let v = line.slice(line.indexOf('=') + 1).trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
    v = v.slice(1, -1);
  }
  return v || null;
}

/** mysql://user:pass@host:port/db  ->  the pieces the CLI needs. */
function parseMysqlUrl(url) {
  const m = /^mysql:\/\/([^:]+):([^@]*)@([^:/]+):(\d+)\/([^?]+)/.exec(url || '');
  if (!m) return null;
  return { user: m[1], password: m[2], host: m[3], port: m[4], database: m[5] };
}

/** Find a usable mysql client without hardcoding one machine's install path. */
function findMysqlClient() {
  // ⚠️ NO `shell: true`. With a shell the args are concatenated rather than escaped, which Node
  // warns about (DEP0190) and which would be an injection surface if a value ever reached argv.
  const onPath = spawnSync('mysql', ['--version'], { stdio: 'ignore' });
  if (!onPath.error && onPath.status === 0) return 'mysql';

  // WAMP layout, matched by glob rather than a pinned version number.
  const binRoot = 'C:\\wamp64\\bin\\mysql';
  if (fs.existsSync(binRoot)) {
    for (const dir of fs.readdirSync(binRoot)) {
      const candidate = path.join(binRoot, dir, 'bin', 'mysql.exe');
      if (fs.existsSync(candidate)) return candidate;
    }
  }
  return null;
}

function query(sql, conn) {
  const client = findMysqlClient();
  if (!client) {
    throw new Error(
      'no mysql client found — install one or add it to PATH. (Refusing to print an empty schema: ' +
        'an empty result and an unreachable database must never look the same.)',
    );
  }
  const args = [
    '-h', conn.host,
    '-P', conn.port,
    '-u', conn.user,
    '--batch',
    '--raw',
    conn.database,
    '-e', sql,
  ];
  // Password via env, never argv — argv is visible in the process list.
  return execFileSync(client, args, {
    env: { ...process.env, MYSQL_PWD: conn.password },
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function connect() {
  if (!fs.existsSync(ENV_PATH)) {
    throw new Error(`nest/.env not found at ${ENV_PATH} — refusing to guess credentials`);
  }
  const url = databaseUrlFromEnv(fs.readFileSync(ENV_PATH, 'utf8'));
  if (!url) throw new Error('DATABASE_URL is not set in nest/.env');
  const conn = parseMysqlUrl(url);
  if (!conn) throw new Error('DATABASE_URL is not a mysql:// URL in the expected shape');
  return conn;
}

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

/** A LIKE pattern is also interpolated — so it is validated too. */
function assertPattern(p) {
  if (!/^[A-Za-z0-9_%]+$/.test(p)) {
    throw new Error(`refusing pattern "${p}": must match [A-Za-z0-9_%]+`);
  }
  return p;
}

// ── self-test ────────────────────────────────────────────────────────────────────────────────
/**
 * Proves the guard can FAIL, in both directions, without needing a database.
 *
 * ⚠️ This exists because its author's previous script (`audit-directive-reachability.cjs`) produced
 * TWO contradictory answers on two runs and both were wrong — it had no self-test, so nothing
 * noticed. A guard that has never been observed to fail is a decoration
 * (development-philosophy §5).
 */
function selfTest() {
  const cases = [
    ['accepts a plain table name', () => assertIdentifier('trade') === 'trade'],
    ['accepts digits and underscores', () => assertIdentifier('ab_pair_2') === 'ab_pair_2'],
    ['REJECTS a semicolon', () => throws(() => assertIdentifier('trade; DROP TABLE trade'))],
    ['REJECTS a backtick escape', () => throws(() => assertIdentifier('trade`'))],
    ['REJECTS a space', () => throws(() => assertIdentifier('trade history'))],
    ['REJECTS a comment', () => throws(() => assertIdentifier('trade--'))],
    ['parses DATABASE_URL', () => {
      const c = parseMysqlUrl('mysql://u:p%40x@localhost:3306/db');
      return c && c.user === 'u' && c.host === 'localhost' && c.port === '3306' && c.database === 'db';
    }],
    ['REJECTS a non-mysql url', () => parseMysqlUrl('postgres://u:p@h:5432/db') === null],
    ['reads DATABASE_URL from .env text', () => {
      const u = databaseUrlFromEnv('# c\nDATABASE_URL="mysql://a:b@h:1/d"\nPORT=3201');
      return u === 'mysql://a:b@h:1/d';
    }],
    ['returns null when DATABASE_URL is absent', () => databaseUrlFromEnv('PORT=3201') === null],
    ['REJECTS a wildcard as an identifier', () => throws(() => assertIdentifier('trade%'))],
    ['accepts a LIKE pattern', () => assertPattern('ab_%') === 'ab_%'],
    ['REJECTS a quoted pattern', () => throws(() => assertPattern("ab_%' OR 1=1"))],
  ];

  let failed = 0;
  for (const [label, fn] of cases) {
    let ok = false;
    try {
      ok = fn() === true;
    } catch {
      ok = false;
    }
    if (!ok) failed++;
    console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}`);
  }
  console.log(
    `\n  ${cases.length - failed}/${cases.length} passed${failed ? '  — SELF-TEST FAILED' : ''}\n`,
  );
  process.exit(failed ? 1 : 0);
}

function throws(fn) {
  try {
    fn();
    return false;
  } catch {
    return true;
  }
}

// ── main ─────────────────────────────────────────────────────────────────────────────────────
function main() {
  const argv = process.argv.slice(2);
  if (argv.includes('--self-test')) return selfTest();

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
