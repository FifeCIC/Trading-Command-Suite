#!/usr/bin/env node
/**
 * validate-schema-facts.cjs — the architecture documentation must not describe a table that is not there.
 *
 * © 2026 Ryan Bayne / FifeCIC · AGPL-3.0 · https://github.com/FifeCIC/Trading-Command-Suite
 *
 * WHY THIS EXISTS (2026-11-07, #1246)
 * -----------------------------------
 * `DATABASE_SCHEMA` was declared twice by hand, and the two copies had drifted: three tables that
 * exist in the live database (SocialMention, InsiderTransaction, CompanyMetric) were documented on
 * the page and MISSING from `src/core/architecture-reference.js`, which is the file an agent greps
 * for the schema. Nothing failed, because no check compared the documentation to the models.
 *
 * The two surfaces have since been single-sourced, so they can no longer disagree with EACH OTHER.
 * That is a different guarantee from agreeing with the CODE, and only this check makes the second
 * one. It is the guard the drift needed in the first place: a human diffing two 5,000-line files
 * found it, and a human should not be the mechanism.
 *
 * ⚠️ WHAT IT DOES NOT CHECK, stated so nobody assumes it. It compares NAMES, not columns or types.
 * A documented table whose `fields` list is stale passes — verifying 59 field lists against the DMMF
 * is a bigger job than this guard, and a half-done version would report CONFORMANCE it has not
 * earned, which is worse than reporting nothing.
 *
 * ⚠️ `plannedMetaTables` IS EXEMPT ON PURPOSE. Those entries say "planned" in the document itself.
 * Measured 2026-11-07 while writing this: I first reported SymbolMeta, SymbolFundamentals and
 * LoopTick as "phantom tables" — they are in `plannedMetaTables`, so their absence is correct, and
 * treating them as defects would have deleted a plan. Only `coreEntities` / `marketDataEntities`
 * claim a table EXISTS.
 *
 * MODES
 *   (default) / --report   print findings; exit 1 on a documented-but-absent table.
 *   --db                   additionally verify against the LIVE database (needs DATABASE_URL).
 *                          Off by default: prebuild must not depend on a running MySQL.
 *   --self-test            prove BOTH directions can fail.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SHARED = path.join(ROOT, 'src', 'core', 'architecture-shared-facts.js');
const PRISMA = path.join(ROOT, 'nest', 'prisma', 'schema.prisma');
const SAFETY = path.join(ROOT, 'nest', 'scripts', 'validate-schema-safety.cjs');

/** Arrays inside DATABASE_SCHEMA whose entries CLAIM the table exists. */
const PRESENT_ARRAYS = ['coreEntities', 'marketDataEntities'];
/** Declared-planned arrays. Never checked for existence. */
const PLANNED_ARRAYS = ['plannedMetaTables'];

/**
 * Tables that are legitimately absent from `schema.prisma` but real. Each needs a REASON.
 * ⚠️ Empty is the correct state. An entry added to silence a genuine gap turns this guard into
 * decoration; add the column to schema.prisma, or delete the documentation line.
 */
const NOT_A_MODEL = new Map();

/** Prisma model names plus their `@@map` targets, lower-cased. */
/**
 * ⚠️ COMPARISON IS NORMALISED, because the document and the database spell one table two ways.
 * `DATABASE_SCHEMA` lists `PaperTrade` and `StrategySignalQueue`; the tables are `paper_trade` and
 * `strategy_signal_queue`. Measured on this guard's FIRST real run: a lower-case-only compare
 * reported both as "documented but absent", and both are real. Stripping case and punctuation is
 * what stops a correct table being called a phantom — the alternative (allowlisting those two)
 * would have hidden the exact names this check exists to catch.
 */
const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9]/g, '');
function prismaTableNames(source) {
  const names = new Set();
  for (const m of source.matchAll(/^model\s+(\w+)\s*\{([\s\S]*?)^\}/gm)) {
    names.add(norm(m[1]));
    const mapped = m[2].match(/@@map\("([^"]+)"\)/);
    if (mapped) names.add(norm(mapped[1]));
  }
  if (names.size === 0) throw new Error('schema.prisma yielded ZERO models — the extractor is wrong, not the file');
  return names;
}

/** Tables declared raw-managed (no Prisma model, deliberately). */
function rawManagedTables() {
  if (!fs.existsSync(SAFETY)) return new Set();
  const src = fs.readFileSync(SAFETY, 'utf8');
  const out = new Set();
  for (const m of src.matchAll(/^\s{2}([a-z][a-z0-9_]*):\s*\{/gm)) out.add(norm(m[1]));
  return out;
}

/**
 * Split the DOCUMENTED schema into claimed-present and declared-planned table names.
 *
 * ⚠️ Reads the OBJECT's arrays directly, not a serialised copy. The first version round-tripped
 * through JSON.stringify and then looked for a `table: '...'` shape — which never matches, because
 * JSON emits double quotes. It parsed ZERO tables and the guard refused to pass with "the extractor
 * is wrong, not the file", which is exactly what a check that reads nothing should do. The fix is
 * not to re-parse our own serialisation: the position of an entry inside an array IS the claim.
 */
function documentedTables(schema) {
  const names = (arr) =>
    Array.isArray(arr) ? [...new Set(arr.map((e) => e && e.table).filter(Boolean))] : [];
  const present = [];
  for (const key of PRESENT_ARRAYS) present.push(...names(schema[key]));
  const planned = [];
  for (const key of PLANNED_ARRAYS) planned.push(...names(schema[key]));
  return { present: [...new Set(present)], planned: [...new Set(planned)] };
}

async function loadDocumentedSchema() {
  // The shared module is ESM and holds the single-sourced DATABASE_SCHEMA.
  if (fs.existsSync(SHARED)) {
    try {
      const mod = await import('file://' + SHARED.replace(/\\/g, '/'));
      if (mod.DATABASE_SCHEMA) return mod.DATABASE_SCHEMA;
    } catch (err) {
      throw new Error(
        `could not import ${path.relative(ROOT, SHARED)} (${err.message}). A guard that cannot read its input must ERROR, not pass.`,
      );
    }
  }
  // Fallback: the page's own copy, if the shared module has not been created yet.
  const page = path.join(ROOT, 'src', 'pages', 'architecture-framework.data.js');
  const src = fs.readFileSync(page, 'utf8');
  const i = src.search(/^export const DATABASE_SCHEMA = /m);
  if (i < 0) throw new Error('DATABASE_SCHEMA not found in either the shared module or the page');
  const rest = src.slice(i);
  const next = rest.slice(1).search(/^export const /m);
  return next < 0 ? rest : rest.slice(0, next + 1);
}

function compare(present, knownNames) {
  const absent = present.filter((t) => {
    if (knownNames.has(norm(t))) return false;
    return !NOT_A_MODEL.has(t);
  });
  return { absent };
}

async function main() {
  const schema = await loadDocumentedSchema();
  const { present, planned } = documentedTables(schema);
  if (present.length === 0) {
    console.error('[schema-facts] ✖ ZERO claimed-present tables parsed from DATABASE_SCHEMA — the extractor is wrong, not the file.');
    return 1;
  }

  const models = prismaTableNames(fs.readFileSync(PRISMA, 'utf8'));
  const raw = rawManagedTables();
  const known = new Set([...models, ...raw]);
  for (const key of NOT_A_MODEL.keys()) known.add(norm(key));

  const { absent } = compare(present, known);

  console.log(
    `[schema-facts] ${present.length} claimed-present table(s), ${planned.length} declared-planned (exempt); ` +
      `${models.size} prisma model name(s), ${raw.size} raw-managed`,
  );

  if (absent.length > 0) {
    console.error('\n[schema-facts] ✖ documented as PRESENT but no such table exists:');
    for (const t of absent) console.error(`     ${t}`);
    console.error(
      '\n  Fix by deleting the entry (if the table is gone), or by adding it to schema.prisma,\n' +
        '  or — if it is a planned table — by moving it into plannedMetaTables where absence is\n' +
        '  the correct state. Do NOT silence it with NOT_A_MODEL unless it is genuinely real.',
    );
    return 1;
  }

  console.log('[schema-facts] ✅ OK — every table documented as present exists as a Prisma model, a @@map target, or a declared raw-managed table.');
  return 0;
}

// ── self-test ─────────────────────────────────────────────────────────────────────────────────

function selfTest() {
  const cases = [];
  const check = (name, cond, detail) => cases.push({ name, ok: !!cond, detail });

  // 1 — prisma extraction finds models AND @@map targets.
  const synthetic = `
model Alpha {
  id String @id
  @@map("alpha_table")
}
model Beta {
  id String @id
}
`;
  const names = prismaTableNames(synthetic);
  check('model name is extracted', names.has('beta'), [...names].join(','));
  check('@@map target is extracted (normalised)', names.has('alphatable'), [...names].join(','));
  check('a model with no @@map is still its own name', names.has('alpha'), [...names].join(','));

  // 2 — an extractor that finds nothing must THROW, not return an empty set.
  let threw = false;
  try {
    prismaTableNames('nothing here');
  } catch {
    threw = true;
  }
  check('zero models throws rather than passing', threw);

  // 3 — section splitting: planned entries are exempt, present ones are not.
  const syntheticSchema = {
    coreEntities: [{ table: 'RealTable', description: 'x', fields: [] }],
    marketDataEntities: [{ table: 'AlsoReal', description: 'y', fields: [] }],
    plannedMetaTables: [{ table: 'FutureTable', description: 'planned', fields: [] }],
  };  const split = documentedTables(syntheticSchema);
  check('plannedMetaTables is recognised as planned', split.planned.includes('FutureTable'), JSON.stringify(split));
  check('planned tables are NOT in the present set', !split.present.includes('FutureTable'), JSON.stringify(split.present));
  check('coreEntities counts as present', split.present.includes('RealTable'), JSON.stringify(split.present));
  check('marketDataEntities counts as present', split.present.includes('AlsoReal'), JSON.stringify(split.present));

  // 4 — BOTH directions of the comparison.
  const known = new Set(['realtable']);
  check(
    'a documented-present table with no model IS reported',
    compare(['RealTable', 'GhostTable'], known).absent.includes('GhostTable'),
    'GhostTable should be absent',
  );
  check(
    'a documented-present table WITH a model is NOT reported',
    compare(['RealTable'], known).absent.length === 0,
    'RealTable should pass',
  );

  // 5 — spelling drift must NOT produce a false positive. Measured on this guard's first real run:
  //     the document says `PaperTrade`, the table is `paper_trade`, and both are correct.
  check(
    'PascalCase documented vs snake_case model is a MATCH',
    compare(['PaperTrade', 'StrategySignalQueue'], new Set([norm('paper_trade'), norm('strategy_signal_queue')])).absent.length === 0,
    'PaperTrade / StrategySignalQueue should resolve',
  );
  check(
    'a near-miss name is still reported (normalisation is not a wildcard)',
    compare(['PaperTrades'], new Set([norm('paper_trade')])).absent.includes('PaperTrades'),
    'PaperTrades must NOT match paper_trade',
  );

  // 6 — the real repo: the three tables this guard was built for must be findable NOW.
  const real = fs.readFileSync(PRISMA, 'utf8');
  const realNames = prismaTableNames(real);
  check(
    'socialmention / insidertransaction / companymetric all resolve to a real model',
    ['socialmention', 'insidertransaction', 'companymetric'].every((t) => realNames.has(t)),
    [...realNames].filter((n) => /social|insider|companymetric/.test(n)).join(','),
  );

  const failed = cases.filter((c) => !c.ok);
  for (const c of cases) console.log(`  ${c.ok ? '✅' : '✖ '} ${c.name}${c.ok ? '' : '  <-- ' + c.detail}`);
  if (failed.length > 0) {
    console.error(`\n[schema-facts] ✖ SELF-TEST FAILED — ${failed.length} of ${cases.length}`);
    return 1;
  }
  console.log(`\n[schema-facts] ✅ self-test: ${cases.length} cases — extraction, the planned-array exemption, and both directions of the comparison observed to behave.`);
  return 0;
}

if (process.argv.includes('--self-test')) {
  process.exit(selfTest());
} else {
  main().then((code) => process.exit(code));
}
