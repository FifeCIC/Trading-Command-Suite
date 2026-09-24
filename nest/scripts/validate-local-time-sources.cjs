#!/usr/bin/env node
/**
 * validate-local-time-sources.cjs — no SQL in this repo may use MySQL's LOCAL clock.
 *
 * ⚠️ WHY THIS EXISTS (#844)
 * -------------------------
 * MySQL evaluates `NOW()` and `CURRENT_TIMESTAMP` in the **session timezone**, which is `SYSTEM`
 * here — UTC+1. The application stores UTC (`new Date()` in JavaScript). So both forms quietly
 * write an hour in the future, and nothing errors.
 *
 * Measured before the fix:
 *   • **113 columns** carried `DEFAULT CURRENT_TIMESTAMP` — including `position.openedAt`,
 *     `trade.openedAt` and `strategy_signal_queue.createdAt` (the TRADE EXECUTION QUEUE, where
 *     `signal-schemaservice.ts` wrote `createdAt, updatedAt` as `NOW(), NOW()` on every insert).
 *   • **25 explicit `NOW()`** uses — writes AND comparisons.
 *   • and the same DDL was duplicated in `prisma.service.ts`, four `raw-managed/*.sql` files, and
 *     seven `manual-migration-*.{ts,js}` twins.
 *
 * This is the same class as the other silent-number defects in this repo: a plausible timestamp,
 * no error, and a downstream consumer (a time-based exit, a queue expiry, a staleness window) that
 * cannot tell the difference.
 *
 * ⚠️ WHY STATIC AND IN `prebuild`. The live version lives in `db:config-refs` (it inspects the real
 * column defaults). This one has to fire when there is NO database — a developer editing DDL should
 * not need a running MySQL to be told they just reintroduced local time. Both are needed: this
 * catches the source, the live one catches a database that has drifted from it.
 *
 * ⚠️ NOT FIXED BY CHANGING THE SERVER TIMEZONE. That would repair every default in one statement —
 * and silently change the clock for every other project on this shared WAMP/MySQL instance. A
 * cross-project change made to fix one project's bug is the pattern this repo keeps paying for.
 *
 * Exit 0 = OK. Exit 1 = a local-time source, named with file and line.
 */

const fs = require('fs');
const path = require('path');

const NEST = path.resolve(__dirname, '..');
const SCOPES = ['src', 'prisma'];
const EXTS = ['.ts', '.sql', '.js'];

/** A DDL default on the local clock. */
const LOCAL_DEFAULT = /DEFAULT\s+CURRENT_TIMESTAMP/i;
/** `NOW()` as SQL — case-sensitive, and not part of `Date.now()` or an identifier. */
const SQL_NOW = /(^|[^A-Za-z_.])NOW\(\)/;

function walk(dir, out = []) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === 'node_modules' || e.name === '.git') continue;
      walk(p, out);
    } else if (EXTS.some((x) => e.name.endsWith(x)) && !e.name.endsWith('.spec.ts')) {
      out.push(p);
    }
  }
  return out;
}

const violations = [];
let scanned = 0;

for (const scope of SCOPES) {
  for (const file of walk(path.join(NEST, scope))) {
    scanned++;
    const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
    lines.forEach((line, i) => {
      const trimmed = line.trimStart();
      // A comment may legitimately DISCUSS these — the explanations in this codebase do.
      // ⚠️ `--` is SQL's line comment and was MISSING from this list until 2026-09-24, so a `.sql`
      // comment explaining the rule failed the guard that enforces it. Found by writing that
      // explanation in `prisma/sim-tsl-936.sql` (#936). A `--` line is a comment by definition, so
      // adding it cannot hide a violation.
      if (trimmed.startsWith('//') || trimmed.startsWith('--') || trimmed.startsWith('*')
        || trimmed.startsWith('/*') || trimmed.startsWith('#')) return;
      // `ON UPDATE CURRENT_TIMESTAMP` cannot be expressed as a function in MySQL, so it is not a
      // violation here; its update path is fixed in the application instead. Reported separately by
      // `fix-local-time-defaults.cjs`.
      const forDefault = line.replace(/ON\s+UPDATE\s+CURRENT_TIMESTAMP(\s*\(\d*\))?/gi, '');
      if (LOCAL_DEFAULT.test(forDefault)) {
        violations.push({ file, line: i + 1, text: line.trim(), kind: 'DEFAULT CURRENT_TIMESTAMP (local clock)' });
      }
      if (SQL_NOW.test(line)) {
        violations.push({ file, line: i + 1, text: line.trim(), kind: 'SQL NOW() (local clock)' });
      }
    });
  }
}

// A scan that read nothing must ERROR rather than pass — an empty result is not an all-clear.
if (scanned === 0) {
  console.error('❌ Scanned ZERO files — the validator is not reading its target.');
  console.error('   A verifier that inspects nothing and reports OK is worse than no verifier.');
  process.exit(1);
}

console.log(`Local-time sources in SQL — checked ${scanned} file(s) under nest/${SCOPES.join(', nest/')}\n`);

if (violations.length > 0) {
  console.error(`❌ ${violations.length} local-time source(s):\n`);
  for (const v of violations) {
    console.error(`  ${path.relative(NEST, v.file).replace(/\\/g, '/')}:${v.line}`);
    console.error(`      ${v.kind}`);
    console.error(`      ${v.text}`);
  }
  console.error('\nMySQL evaluates NOW() and CURRENT_TIMESTAMP in the SESSION timezone (SYSTEM = UTC+1');
  console.error('on this machine). The application stores UTC, so either form writes an hour in the');
  console.error('future with no error — a plausible timestamp that nothing downstream can question.');
  console.error('\nUse UTC_TIMESTAMP() for the clock, and `DEFAULT (UTC_TIMESTAMP(n))` for a default.');
  console.error('`ON UPDATE CURRENT_TIMESTAMP` is allowed (MySQL cannot express it as a function) but its');
  console.error('update path must be written by the application. See #844.\n');
  process.exit(1);
}

console.log('✅ OK — every SQL clock reference is UTC, and no DDL default uses the local clock.');
