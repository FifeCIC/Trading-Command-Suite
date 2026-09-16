#!/usr/bin/env node
/**
 * validate-retention-columns.cjs — retention must bound on an INTRINSIC column, and the
 * table→column map must have exactly ONE owner.
 *
 * WHY THIS EXISTS (2026-09-16)
 * ----------------------------
 * `directiveoutcome` was pruned on `predictedAt` — a value the application DERIVES — while every
 * other table used a write-time fact (`timestamp`, `createdAt`, `snappedAt`, `takenAt`,
 * `evaluatedAt`). That single choice caused two opposite failures:
 *
 *   • A mis-stamped row self-deleted. `predictedAt` was written from the evaluated bar's open time
 *     (#827), so a symbol with a dead feed produced rows dated weeks in the past, which the next
 *     retention run removed immediately. **Investigating that defect was harder than it should have
 *     been because the system was erasing its own evidence** — the issue could only ever observe
 *     "33 rows in a 3-hour window".
 *   • A future-stamped row would never be pruned, so the size bound was not a bound at all.
 *
 * The rule this encodes: **a retention bound may only reference when the row was WRITTEN.** A
 * computed column is a claim about the world; the row's storage age is a fact about the database.
 *
 * It also checks the SECOND failure, which was the same duplication pattern this repo keeps
 * hitting: the table→column map was declared in THREE files (`data-retention`, `backtest-archive`
 * under "keep in sync", and `system-health` under "mirrored from DataRetentionService"). A comment
 * asking a future reader to keep two lists in step is not a mechanism, so this asserts the copies
 * have not come back.
 *
 * Exit 0 = OK. Exit 1 = a violation, with the file and the offending value.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const CONFIG = path.join('nest', 'src', 'modules', 'system', 'retention.config.ts');

/**
 * Columns that record WHEN THE ROW WAS STORED. A retention bound may only use one of these.
 * Extend this list only with a column the database itself populates.
 */
const INTRINSIC_COLUMNS = new Set([
  'createdAt',
  'timestamp',
  'snappedAt',
  'takenAt',
  'evaluatedAt',
]);

/** Files that must NOT re-declare a table→date-column map. */
const MUST_NOT_DECLARE = [
  'nest/src/modules/system/data-retention.service.ts',
  'nest/src/modules/system/backtest-archive.service.ts',
  'nest/src/modules/system/system-health.service.ts',
];

const errors = [];
const notes = [];

function read(rel) {
  try {
    return fs.readFileSync(path.join(ROOT, rel), 'utf8');
  } catch {
    return null;
  }
}

// ── 1. Every configured dateCol must be intrinsic ────────────────────────────────────────────
const cfg = read(CONFIG);
if (!cfg) {
  console.error(`❌ Could not read ${CONFIG} — the shared owner is missing.`);
  process.exit(1);
}

// Parse `tableName: { dateCol: 'x', ... }` entries.
const entries = [...cfg.matchAll(/^\s{2}(\w+):\s*\{([^}]*)\}/gm)];
if (entries.length === 0) {
  console.error('❌ Parsed ZERO table entries from retention.config.ts.');
  console.error('   A verifier that cannot parse its target must ERROR, not report OK.');
  process.exit(1);
}

let checked = 0;
for (const [, table, body] of entries) {
  const m = /dateCol:\s*'([^']+)'/.exec(body);
  if (!m) continue;
  checked++;
  const col = m[1];
  if (!INTRINSIC_COLUMNS.has(col)) {
    errors.push(
      `  ${table.padEnd(20)} prunes on \`${col}\`, which is NOT an intrinsic write-time column.\n` +
      `      A derived value can be wrong, and a wrong one either deletes rows on arrival or never\n` +
      `      deletes them at all. Use one of: ${[...INTRINSIC_COLUMNS].join(', ')}.`,
    );
  }
}

if (checked === 0) {
  console.error('❌ Parsed the config but found NO dateCol values — the check is not reading it.');
  console.error('   Fix the parser rather than trusting a green result.');
  process.exit(1);
}
notes.push(`retention date columns checked: ${checked}/${entries.length}`);

// ── 2. The map must have ONE owner ──────────────────────────────────────────────────────────
for (const rel of MUST_NOT_DECLARE) {
  const src = read(rel);
  if (src == null) continue;

  // A local record whose values are column names, keyed by a table we know about.
  // Anchored on our own table names so ordinary object literals cannot trip it.
  const knownTables = entries.map(([, t]) => t);
  const redeclared = knownTables.filter((t) => {
    const re = new RegExp(`\\b${t}\\s*:\\s*(?:\\{[^}]*dateCol|'[a-zA-Z]+'|new Set)`);
    return re.test(src);
  });

  if (redeclared.length > 0) {
    errors.push(
      `  ${rel}\n` +
      `      re-declares the table→column map for: ${redeclared.join(', ')}\n` +
      `      Import from retention.config.ts. A second copy drifts, and a drifted entry here\n` +
      `      silently changes WHICH ROWS GET DELETED.`,
    );
  }
}
notes.push(`files checked for a duplicated map: ${MUST_NOT_DECLARE.length}`);

// ── 3. Every retention column must be SERVABLE BY AN INDEX ──────────────────────────────────
//
// ⚠️ THIS CHECK EXISTS BECAUSE A RANGE PREDICATE NEEDS AN INDEX — NOT BECAUSE IT CAUSED AN OUTAGE.
//
// The retention column is not just a config value — it is a RANGE PREDICATE used on every prune
// (`DELETE ... WHERE col < cutoff`) and in `SystemHealthService.getDbDiagnostics()`.
//
// ⚠️ An earlier version of this comment claimed the absence of such an index caused a 32-second
// scan of a 1.5 GB table and a 504 on the health endpoint. **That is retracted** — the table is
// 1.10 MB, the 504 occurred once and the endpoint was healthy before the index was added. Two
// changes were made together and the wrong one was credited. Full correction:
// `change-completion.instructions.md` → Gate 3.
//
// The rule is kept because it is sound and cheap, not because it rescued anything:
// **a retention column must be the LEADING column of some index.** "Present in an index" is not
// enough — a column that is the second part of a composite index cannot serve a range scan, which
// is why this checks position, not membership.
//
// The check is STATIC (schema.prisma, not the live database) so it runs in `prebuild` with no
// connection. That is deliberate: a guard that needs a database is a guard that gets skipped.
const SCHEMA = path.join('nest', 'prisma', 'schema.prisma');
const schema = read(SCHEMA);
if (schema == null) {
  console.error(`❌ Could not read ${SCHEMA} — cannot verify that retention columns are indexed.`);
  process.exit(1);
}

/** model → { table, leadingIndexColumns:Set } parsed from schema.prisma. */
const modelIndexes = new Map();
{
  // Models are top-level `model X { ... }` blocks. Non-greedy to the first closing brace at
  // column 0, which is how Prisma formats them.
  const models = [...schema.matchAll(/^model\s+(\w+)\s*\{([\s\S]*?)^\}/gm)];
  for (const [, modelName, body] of models) {
    const mapMatch = /@@map\("([^"]+)"\)/.exec(body);
    const table = (mapMatch ? mapMatch[1] : modelName).toLowerCase();
    const leading = new Set();
    for (const idx of body.matchAll(/@@index\(\[([^\]]+)\]/g)) {
      const first = idx[1].split(',')[0].trim().replace(/[`"']/g, '');
      if (first) leading.add(first);
    }
    modelIndexes.set(table, { model: modelName, leading });
  }
}

if (modelIndexes.size === 0) {
  console.error('❌ Parsed ZERO models from schema.prisma — the index check cannot work.');
  console.error('   A verifier that cannot parse its target must ERROR, not report OK.');
  process.exit(1);
}

let indexedChecked = 0;
for (const [, table, body] of entries) {
  const m = /dateCol:\s*'([^']+)'/.exec(body);
  if (!m) continue;
  const col = m[1];
  const entry = modelIndexes.get(table.toLowerCase());
  if (!entry) {
    // Not modelled in Prisma — a raw-managed table. Its indexes are outside this check's reach,
    // so say so rather than passing it silently.
    notes.push(`⚠️  ${table}: not in schema.prisma (raw-managed) — index position not verifiable here`);
    continue;
  }
  indexedChecked++;
  if (!entry.leading.has(col)) {
    errors.push(
      `  ${table.padEnd(20)} retention column \`${col}\` is NOT the leading column of any index\n` +
      `      in model ${entry.model} (schema.prisma). The prune is \`WHERE ${col} < cutoff\` and the\n` +
      `      health panel runs MIN/MAX on it — neither can use an index that does not start with\n` +
      `      \`${col}\`, so both become a full table scan.\n` +
      `      Measured cost of getting this wrong: 32,298ms unindexed on directiveoutcome, which\n` +
      `      exceeded the 30s gateway timeout and returned 504 for /api/system/health-dashboard.\n` +
      `      Fix: add \`@@index([${col}])\` to model ${entry.model}, then apply it with ALTER TABLE\n` +
      `      (NEVER \`prisma db push\` — see database-schema.instructions.md).`,
    );
  }
}
notes.push(`retention columns checked for a usable index: ${indexedChecked}/${entries.length}`);

// ── Report ─────────────────────────────────────────────────────────────────────────────────
console.log('Retention columns — intrinsic only, one owner\n');
for (const n of notes) console.log(`  ${n}`);

if (errors.length > 0) {
  console.error(`\n❌ ${errors.length} problem(s):\n`);
  for (const e of errors) console.error(e);
  console.error('\nA retention policy must not be able to delete the record of a bug any faster');
  console.error('than a human can look at it. See the header of this file.\n');
  process.exit(1);
}

console.log('\n✅ OK — every retention bound uses a write-time column, and the map has one owner.');
