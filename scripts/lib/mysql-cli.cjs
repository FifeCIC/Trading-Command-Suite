/**
 * mysql-cli.cjs — the ONE way a script in this repo talks to MySQL.
 *
 * ⚠️ WHY THIS FILE EXISTS. This connection layer was written inside `scripts/db-schema.cjs` and
 * lived there, unexported, so any second tool that needed the database had to either copy it or
 * invent its own. Both are the same defect the repo names repeatedly: *"a second implementation is
 * the most expensive kind of technical debt — both copies drift and only one gets the next fix."*
 *
 * Extracted 2026-09-29 for `scripts/replay-exit-counterfactual.cjs` (#1024), keeping behaviour
 * byte-for-byte: same guards, same password handling, same client discovery.
 *
 * ⚠️ `db-schema.cjs` now consumes THIS rather than its own copy, so the two cannot diverge. Its
 * `--self-test` output is unchanged.
 *
 * ── The two rules this layer enforces ─────────────────────────────────────────────────────────
 *   1. **Identifiers are VALIDATED, not escaped.** A table name or LIKE pattern is interpolated into
 *      SQL, so anything outside a strict character class is refused before a query is built. That is
 *      the injection surface, and it is closed here rather than trusted at each call site.
 *   2. **The password goes in the environment, never argv** — argv is visible in the process list.
 */
const fs = require('fs');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');
// ⚠️ THE SHARED HARNESS, NOT A LOCAL COPY. This file and `scripts/tools-index.cjs` had each
// hand-rolled the same self-test loop, and `validate-duplication.cjs` failed the build on the pair.
// Extraction is the repo's rule here — banking hides the instance, extraction removes the class.
const { runCases } = require('./validator-helpers.cjs');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const ENV_PATH = path.join(REPO_ROOT, 'nest', '.env');

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

/** A LIKE pattern is also interpolated — so it is validated too. */
function assertPattern(p) {
  if (!/^[A-Za-z0-9_%]+$/.test(p)) {
    throw new Error(`refusing pattern "${p}": must match [A-Za-z0-9_%]+`);
  }
  return p;
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

/**
 * Run SQL and return the client's stdout, verbatim.
 *
 * ⚠️ The caller gets the RAW text, headers included — it is not parsed into objects here, because
 * "an empty result and an unreachable database must never look the same" and only the caller knows
 * which of those it is looking at.
 */
function query(sql, conn) {
  const client = findMysqlClient();
  if (!client) {
    throw new Error(
      'no mysql client found — install one or add it to PATH. (Refusing to print an empty result: ' +
        'an empty result and an unreachable database must never look the same.)',
    );
  }
  const args = ['-h', conn.host, '-P', conn.port, '-u', conn.user, '--batch', '--raw', conn.database, '-e', sql];
  return execFileSync(client, args, {
    env: { ...process.env, MYSQL_PWD: conn.password },
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 256 * 1024 * 1024,
  });
}

/** Connection details from `nest/.env`. Throws rather than guessing credentials. */
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

function throws(fn) {
  try {
    fn();
    return false;
  } catch {
    return true;
  }
}

/**
 * Proves the GUARDS can FAIL, without needing a database.
 *
 * ⚠️ Returns the failure COUNT rather than calling `process.exit`, because this is a library and a
 * library must not decide when the process ends. Callers do `process.exit(selfTest() ? 1 : 0)`.
 *
 * ⚠️ It exists because the author's earlier script (`audit-directive-reachability.cjs`) produced TWO
 * contradictory answers on two runs and both were wrong — it had no self-test, so nothing noticed.
 * A guard that has never been observed to fail is a decoration.
 */
function selfTest() {
  const cases = [
    ['accepts a plain table name', () => assertIdentifier('trade') === 'trade'],
    ['accepts digits and underscores', () => assertIdentifier('ab_pair_2') === 'ab_pair_2'],
    ['REJECTS a semicolon', () => throws(() => assertIdentifier('trade; DROP TABLE trade'))],
    ['REJECTS a backtick escape', () => throws(() => assertIdentifier('trade`'))],
    ['REJECTS a space', () => throws(() => assertIdentifier('trade history'))],
    ['REJECTS a comment', () => throws(() => assertIdentifier('trade--'))],
    ['REJECTS a wildcard as an identifier', () => throws(() => assertIdentifier('trade%'))],
    ['accepts a LIKE pattern', () => assertPattern('ab_%') === 'ab_%'],
    ['REJECTS a quoted pattern', () => throws(() => assertPattern("ab_%' OR 1=1"))],
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
  ];

  // ⚠️ `runCases` applies the STRICT rule (`fn() === true`), which is what this file already used.
  return runCases(cases);
}

module.exports = {
  REPO_ROOT,
  ENV_PATH,
  assertIdentifier,
  assertPattern,
  databaseUrlFromEnv,
  parseMysqlUrl,
  findMysqlClient,
  query,
  connect,
  throws,
  selfTest,
};
