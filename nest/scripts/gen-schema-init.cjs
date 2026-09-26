#!/usr/bin/env node
/**
 * gen-schema-init.cjs — regenerate `prisma/schema-init.sql`, with the UTC correction applied.
 * ===============================================================================================
 *
 * WHY THIS EXISTS RATHER THAN A DOCUMENTED COMMAND (#997)
 * ------------------------------------------------------
 * `schema-init.sql` is GENERATED from `schema.prisma`, so a bare documented command would let it
 * drift silently. Worse, the generated output is **not directly shippable**: `@default(now())`
 * makes Prisma emit `DEFAULT CURRENT_TIMESTAMP(3)`, which MySQL evaluates in the **session**
 * timezone (SYSTEM = UTC+1 here). This application stores UTC, so a fresh install would write
 * timestamps an hour in the future with no error — exactly the fault #844 fixed.
 *
 * ⚠️ **The prebuild gate caught this**, and that is worth recording: `validate-local-time-sources.cjs`
 * failed the build on the first generated file, naming every offending column. Without that gate the
 * file would have shipped and a fresh install would have had the bug.
 *
 * So the generator does two things a bare command cannot:
 *   1. `DEFAULT CURRENT_TIMESTAMP(n)` → `DEFAULT (UTC_TIMESTAMP(n))`  — the clock, made UTC
 *      `ON UPDATE CURRENT_TIMESTAMP` is deliberately LEFT ALONE: MySQL cannot express it as a
 *      function, and the validator allows it for that reason.
 *   2. Prepends the explanatory header.
 *
 * Usage (from nest/):
 *   node scripts/gen-schema-init.cjs            regenerate the file
 *   node scripts/gen-schema-init.cjs --check    fail if the file on disk is STALE
 *
 * Exit: 0 = written (or --check found it current) · 1 = --check found it stale, or generation failed.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const NEST_ROOT = path.resolve(__dirname, '..');
const OUT = path.join(NEST_ROOT, 'prisma', 'schema-init.sql');
const SCHEMA = path.join(NEST_ROOT, 'prisma', 'schema.prisma');
const CHECK = process.argv.slice(2).includes('--check');

/**
 * Turn Prisma's local-clock defaults into UTC defaults (#844).
 *
 * ⚠️ Only the DEFAULT clause is touched. `ON UPDATE CURRENT_TIMESTAMP(3)` is left exactly as Prisma
 * emitted it — MySQL cannot express it as a function expression, and the validator permits it for
 * that reason. A blanket replace would corrupt it.
 */
function toUtcDefaults(sql) {
  let n = 0;
  const out = sql.replace(/DEFAULT\s+CURRENT_TIMESTAMP(?:\((\d*)\))?/gi, (_m, p) => {
    n++;
    return `DEFAULT (UTC_TIMESTAMP(${p === '' || p === undefined ? '' : p}))`;
  });
  return { sql: out, count: n };
}

function header(createCount, utcCount) {
  return `-- schema-init.sql — the FULL application schema, GENERATED from prisma/schema.prisma.
-- =====================================================================================================
-- ⚠️ THIS FILE IS GENERATED. DO NOT EDIT IT BY HAND — a hand-edited copy drifts from the model, which
-- is the defect it exists to remove. Regenerate with:
--
--     npm --prefix nest run db:init:gen        (writes)
--     npm --prefix nest run db:init:gen:check  (fails if stale)
--
-- ⚠️ WHY A GENERATOR AND NOT A DOCUMENTED COMMAND (#997). The raw \`prisma migrate diff\` output is not
-- directly shippable: \`@default(now())\` emits \`DEFAULT CURRENT_TIMESTAMP(3)\`, which MySQL evaluates
-- in the SESSION timezone (SYSTEM = local). This app stores UTC, so a fresh install would write
-- timestamps in the future with no error — the #844 fault. The generator applies that correction
-- (${utcCount} default(s) rewritten to \`UTC_TIMESTAMP\`) and is reproducible.
--
-- ⚠️ The prebuild gate caught this, and it is worth recording: validate-local-time-sources.cjs failed
-- the build on the FIRST generated version and named every offending column.
--
-- SCALE: ${createCount} CREATE TABLE statements.
--
-- WHAT IT DOES NOT COVER, and both are intentional:
--   1. The 13 raw-managed tables (4 with checked-in DDL in prisma/raw-managed/, 9 created by
--      bootstrapSchema() at boot). They are deliberately NOT in schema.prisma, which is why
--      \`db push\` is banned here (#769).
--   2. Seed DATA. A schema is not a seed; run the seeders after this.
--
-- USAGE (fresh database only):  npm --prefix nest run db:init
-- =====================================================================================================

`;
}

function generate() {
  // ⚠️ `execSync` with a shell, NOT `execFileSync('npx.cmd', …)`. The latter fails on Windows with
  // `pid: 0, stdout: undefined` and no usable message — observed on the first attempt. The shell
  // form resolves npx correctly. Errors are surfaced with stderr rather than swallowed.
  let raw;
  try {
    raw = execSync(
      'npx prisma migrate diff --from-empty --to-schema-datamodel prisma/schema.prisma --script',
      { cwd: NEST_ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] },
    );
  } catch (err) {
    console.error('❌ `prisma migrate diff` failed:');
    console.error(`   ${err.message.split('\n')[0]}`);
    if (err.stderr) console.error(`   ${String(err.stderr).split('\n').slice(0, 5).join('\n   ')}`);
    process.exit(1);
  }
  if (!raw || !/CREATE TABLE/i.test(raw)) {
    console.error('❌ `prisma migrate diff` produced no CREATE TABLE statements — refusing to write.');
    process.exit(1);
  }
  const { sql, count } = toUtcDefaults(raw);
  const createCount = (sql.match(/CREATE TABLE/gi) || []).length;
  return header(createCount, count) + sql;
}

const next = generate();

if (CHECK) {
  if (!fs.existsSync(OUT)) {
    console.error('\n❌ prisma/schema-init.sql does not exist. Run: npm --prefix nest run db:init:gen\n');
    process.exit(1);
  }
  if (fs.readFileSync(OUT, 'utf8') !== next) {
    console.error('\n❌ prisma/schema-init.sql is STALE — schema.prisma has changed since it was generated.');
    console.error('   Run: npm --prefix nest run db:init:gen\n');
    process.exit(1);
  }
  console.log('\n✅ schema-init.sql is current.\n');
  process.exit(0);
}

fs.writeFileSync(OUT, next, 'utf8');
const creates = (next.match(/CREATE TABLE/gi) || []).length;
const utc = (next.match(/UTC_TIMESTAMP/g) || []).length;
console.log(`\n✅ wrote prisma/schema-init.sql — ${creates} CREATE TABLE, ${utc} UTC_TIMESTAMP default(s).`);
console.log('   ⚠️ The 13 raw-managed tables are still not in this file, by design.\n');
