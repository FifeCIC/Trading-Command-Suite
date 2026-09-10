#!/usr/bin/env node
/**
 * Assert the generated Prisma client matches `prisma/schema.prisma` (#765).
 *
 * WHY
 * ---
 * The Prisma client is generated code living in `node_modules/.prisma/client`. It is NOT
 * rebuilt by `tsc`, and `prebuild` did not run `prisma generate`. So a schema change and a
 * build produced a client that was silently OLDER than the schema.
 *
 * The failure is a runtime 500, not a compile error:
 *
 *     PrismaClientValidationError: Unknown field `adaptiveTargetEnabled` for select
 *     statement on model `Protocol`. Available options are marked with ?
 *
 * Measured on 2026-09-10: client generated 11:38:54, schema modified 17:55:24 — **6 hours
 * apart**, with four `adaptiveTarget*` columns the client had never seen. TypeScript could
 * not catch it (Prisma's `select` accepts a generated type, and the generated type simply
 * lacked the field), and the build reported success.
 *
 * This is the same class as every other invariant in this repo: **the failure presents as
 * something that looks fine**. A 500 on one endpoint, from a build that passed.
 *
 * WHAT IT CHECKS
 * --------------
 *   1. `schema.prisma` is not NEWER than the generated client. A newer schema means the
 *      client is stale.
 *   2. Every model field named in `schema.prisma` is present in the generated type
 *      definitions. This catches the case where the timestamps look fine but generation
 *      genuinely did not pick something up.
 *
 * Run from `nest/`: `node scripts/check-prisma-client-fresh.cjs`
 * Wired into `prebuild` so a stale client cannot be built or started.
 */

const fs = require('fs');
const path = require('path');

const NEST_ROOT = path.resolve(__dirname, '..');
const SCHEMA = path.join(NEST_ROOT, 'prisma', 'schema.prisma');
const CLIENT_DIR = path.join(NEST_ROOT, 'node_modules', '.prisma', 'client');
const CLIENT_TYPES = path.join(CLIENT_DIR, 'index.d.ts');

function fail(message, detail) {
  console.error(`\n[prisma-freshness] ❌ ${message}`);
  if (detail) console.error(detail);
  console.error(
    '\n   Fix:  npx prisma generate        (run from nest/)\n' +
      '   Why:  the client is generated code; tsc does not rebuild it.\n',
  );
  process.exit(1);
}

if (!fs.existsSync(SCHEMA)) {
  console.log('[prisma-freshness] skipped — no prisma/schema.prisma');
  process.exit(0);
}
if (!fs.existsSync(CLIENT_TYPES)) {
  fail(
    'the Prisma client has never been generated',
    `   expected: ${CLIENT_TYPES}`,
  );
}

// ── 1. Timestamps ──────────────────────────────────────────────────────────
const schemaMtime = fs.statSync(SCHEMA).mtimeMs;
const clientMtime = fs.statSync(CLIENT_TYPES).mtimeMs;

if (schemaMtime > clientMtime) {
  const hours = ((schemaMtime - clientMtime) / 3_600_000).toFixed(1);
  fail(
    `the Prisma client is STALE — schema.prisma is ${hours}h newer than the generated client`,
    `   schema:  ${new Date(schemaMtime).toISOString()}\n` +
      `   client:  ${new Date(clientMtime).toISOString()}\n` +
      `   A stale client rejects fields the schema defines: PrismaClientValidationError\n` +
      `   "Unknown field X for select statement on model Y" — a runtime 500, not a build error.`,
  );
}

// ── 2. Field-level check ───────────────────────────────────────────────────
// Timestamps can match while generation genuinely missed something, so confirm the
// generated types actually name the model fields the schema declares.
const schema = fs.readFileSync(SCHEMA, 'utf8');
const types = fs.readFileSync(CLIENT_TYPES, 'utf8');

/** Pull `fieldName Type` lines out of each `model X { ... }` block. */
function schemaFields() {
  const out = [];
  const modelRe = /^model\s+(\w+)\s*\{([\s\S]*?)^\}/gm;
  let m;
  while ((m = modelRe.exec(schema)) !== null) {
    const [, model, body] = m;
    for (const raw of body.split('\n')) {
      const line = raw.trim();
      if (!line || line.startsWith('//') || line.startsWith('@@')) continue;
      const name = line.split(/\s+/)[0];
      // Skip block attributes and relation-only lines we can't assert on cheaply.
      if (!/^[A-Za-z_]\w*$/.test(name)) continue;
      out.push({ model, field: name });
    }
  }
  return out;
}

const fields = schemaFields();
const missing = [];
for (const { model, field } of fields) {
  // The generated client names every scalar field somewhere in its type surface. A field
  // that appears nowhere at all is the #765 symptom.
  if (!types.includes(field)) missing.push(`${model}.${field}`);
}

if (missing.length > 0) {
  fail(
    `${missing.length} schema field(s) are absent from the generated client`,
    '   ' +
      missing.slice(0, 12).join('\n   ') +
      (missing.length > 12 ? `\n   …and ${missing.length - 12} more` : ''),
  );
}

console.log(
  `[prisma-freshness] ✅ client is current (${fields.length} model fields verified against schema.prisma)`,
);
