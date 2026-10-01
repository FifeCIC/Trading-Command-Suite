#!/usr/bin/env node
/**
 * audit-schema-drift.cjs — FIELD-LEVEL drift between `schema.prisma` and the live database.
 *
 * WHY THIS EXISTS (#948)
 * ----------------------
 * This repo has no migration history (that is #769 — the TABLE-level blind spot). There is a
 * second, distinct blind spot this file closes: a MODELLED table can be missing COLUMNS that
 * exist in the database. Prisma then cannot read them, a filter on them cannot even be written,
 * and every query SILENTLY UNDER-REPORTS. It is the repo's most expensive failure signature —
 * plausible output, no error.
 *
 * Both known instances were found BY ACCIDENT, months apart:
 *   - `symbol_route.provider`  — in the DB, not in the model; blocked binance route seeding.
 *   - `Trade.pnlInvalid` (+ pnlInvalidReason, pnlRaw, exitPriceRaw) — in the DB, not in the
 *     model. #805: the P&L report counted 82 fabricated rows as trades (8.77% vs a real 31.3%).
 *
 * WHAT IT COMPARES
 * ----------------
 * The Prisma DMMF (the SAME mapping the generated client uses — so this cannot disagree with
 * what the app actually does) against `information_schema.COLUMNS`.
 *
 *   model  -> table :  `@@map(...)` (DMMF `dbName`) else the model name
 *   field  -> column:  `@map(...)`  (DMMF `dbName`) else the field name
 *   fields counted  :  kind `scalar` and `enum` ONLY — relation fields (`kind: 'object'`) do
 *                      not own a column and must NOT be reported as missing.
 *
 * SCOPE — modelled tables only. A table with NO model is #769's scope (`db:check` +
 * `nest/prisma/raw-managed/`), and is counted here but never flagged.
 *
 * DIRECTIONS
 * ----------
 *   DB-only column    (in DB, not in model)  -> FAIL  — the DANGEROUS direction; reads as OK.
 *   model-only column (in model, not in DB)  -> FAIL  — the loud direction; usually throws.
 *
 * ⚠️ TYPED-FIELD CONSTRAINT (learned the hard way): MySQL column names are compared
 * CASE-INSENSITIVELY. `symbol` and `Symbol` are the same column; comparing case-sensitively
 * would invent drift that does not exist.
 *
 * Usage:
 *   node scripts/audit-schema-drift.cjs               # audit the live DB
 *   node scripts/audit-schema-drift.cjs --self-test   # prove BOTH directions can be detected
 *   node scripts/audit-schema-drift.cjs --json        # machine-readable result
 *
 * Exit: 0 = no drift, 1 = drift found (or self-test failure), 2 = cannot run (no DB / no DMMF).
 */
'use strict';

const { PrismaClient, Prisma } = require('@prisma/client');

const prisma = new PrismaClient();

// ─────────────────────────────────────────────────────────────────────────────
// PURE HELPERS — no DB, no DMMF. Exported so --self-test can exercise them and
// so the classifier can be proven to fail in both directions.
// ─────────────────────────────────────────────────────────────────────────────

/** The real table name for a DMMF model: `@@map` if present, else the model name. */
function tableOf(model) {
  return model.dbName || model.name;
}

/** The real column name for a DMMF field: `@map` if present, else the field name. */
function columnOf(field) {
  return field.dbName || field.name;
}

/**
 * The fields that own a column. Relation fields (`kind: 'object'`) point at another model and
 * have no column of their own — including them would report every relation as "model-only".
 * `enum` fields DO own a column (stored as a string), so they are kept.
 */
function columnFields(model) {
  return (model.fields || []).filter((f) => f.kind === 'scalar' || f.kind === 'enum');
}

/**
 * classify() — compare one modelled table's columns against the database's.
 * @param {string[]} dbColumns    columns read from information_schema (real names)
 * @param {string[]} modelColumns columns the Prisma model declares (real names)
 * @returns {{missingInModel: string[], missingInDb: string[]}}
 *   missingInModel = in DB, not in model  (DANGEROUS — Prisma cannot read it)
 *   missingInDb    = in model, not in DB  (loud — usually throws)
 */
function classify(dbColumns, modelColumns) {
  const dbLower = new Map(dbColumns.map((c) => [c.toLowerCase(), c]));
  const modelLower = new Map(modelColumns.map((c) => [c.toLowerCase(), c]));
  const missingInModel = dbColumns.filter((c) => !modelLower.has(c.toLowerCase()));
  const missingInDb = modelColumns.filter((c) => !dbLower.has(c.toLowerCase()));
  return { missingInModel, missingInDb };
}

// ─────────────────────────────────────────────────────────────────────────────
// SELF-TEST — must be able to FAIL in BOTH directions. A guard that cannot be
// observed to fail is a decoration.
// ─────────────────────────────────────────────────────────────────────────────

const selfTest = () => {
  const results = [];
  const check = (name, cond) => results.push({ name, ok: !!cond });

  // 1. identical sets -> no drift
  {
    const r = classify(['id', 'symbol'], ['id', 'symbol']);
    check('identical columns report no drift', r.missingInModel.length === 0 && r.missingInDb.length === 0);
  }
  // 2. DB has an extra column -> DANGEROUS direction detected
  {
    const r = classify(['id', 'symbol', 'provider'], ['id', 'symbol']);
    check('DB-only column is reported as missingInModel', r.missingInModel.length === 1 && r.missingInModel[0] === 'provider');
    check('DB-only column does NOT leak into missingInDb', r.missingInDb.length === 0);
  }
  // 3. model has an extra column -> loud direction detected
  {
    const r = classify(['id'], ['id', 'pnlInvalid']);
    check('model-only column is reported as missingInDb', r.missingInDb.length === 1 && r.missingInDb[0] === 'pnlInvalid');
    check('model-only column does NOT leak into missingInModel', r.missingInModel.length === 0);
  }
  // 4. case difference is NOT drift (MySQL column names are case-insensitive)
  {
    const r = classify(['Symbol'], ['symbol']);
    check('case-only difference is not reported as drift', r.missingInModel.length === 0 && r.missingInDb.length === 0);
  }
  // 5. relation fields own no column; scalar/enum do
  {
    const model = {
      name: 'X',
      fields: [
        { name: 'id', kind: 'scalar', type: 'Int' },
        { name: 'rel', kind: 'object', type: 'Y' },
        { name: 'status', kind: 'enum', type: 'Status' },
      ],
    };
    const cols = columnFields(model).map(columnOf);
    check('columnFields keeps scalar + enum, drops relation', cols.length === 2 && cols.includes('id') && cols.includes('status') && !cols.includes('rel'));
  }
  // 6. @map / @@map resolution
  {
    const model = { name: 'CorrelationPair', dbName: 'correlation_pair', fields: [{ name: 'pairKey', dbName: 'pair_key', kind: 'scalar', type: 'String' }] };
    check('tableOf honours @@map', tableOf(model) === 'correlation_pair');
    check('columnOf honours @map', columnOf(model.fields[0]) === 'pair_key');
    const plain = { name: 'Trade', fields: [{ name: 'id', kind: 'scalar', type: 'Int' }] };
    check('tableOf falls back to model name', tableOf(plain) === 'Trade');
    check('columnOf falls back to field name', columnOf(plain.fields[0]) === 'id');
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`[schema-drift] --self-test ${results.length - failed.length}/${results.length} passed`);
  for (const r of failed) console.log(`   ✗ ${r.name}`);
  return failed.length === 0;
};

// ─────────────────────────────────────────────────────────────────────────────
// LIVE AUDIT
// ─────────────────────────────────────────────────────────────────────────────

/**
 * readDbColumns() — Map(lowerTableName -> { table (real name), columns: string[] }).
 * ⚠️ KEYED BY LOWERCASE. MySQL on Windows stores table names case-insensitively
 * (`lower_case_table_names=1`), so the model `Trade` and the table `trade` are the SAME
 * table. Matching case-sensitively reported 58 modelled tables as "missing" — a false
 * positive from the comparison, not from the database.
 */
async function readDbColumns() {
  const rows = await prisma.$queryRawUnsafe(
    `SELECT TABLE_NAME AS t, COLUMN_NAME AS c
       FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
      ORDER BY TABLE_NAME, ORDINAL_POSITION`,
  );
  const byTable = new Map();
  for (const r of rows) {
    const t = String(r.t);
    const key = t.toLowerCase();
    if (!byTable.has(key)) byTable.set(key, { table: t, columns: [] });
    byTable.get(key).columns.push(String(r.c));
  }
  return byTable;
}

async function audit({ asJson } = {}) {
  const dmmf = Prisma.dmmf && Prisma.dmmf.datamodel;
  if (!dmmf || !Array.isArray(dmmf.models)) {
    console.error('[schema-drift] ✗ no DMMF on the generated client — run `npx prisma generate` first');
    return 2;
  }
  const dbByTable = await readDbColumns();

  const failures = [];
  let modelledMatched = 0;
  let missingTables = 0;

  for (const model of dmmf.models) {
    const table = tableOf(model);
    const entry = dbByTable.get(table.toLowerCase());
    if (!entry) {
      // Modelled but absent from the DB entirely — a loud failure worth naming separately.
      missingTables++;
      failures.push({ kind: 'MODEL-NO-TABLE', model: model.name, table, detail: 'model exists but the table does not' });
      continue;
    }
    modelledMatched++;
    const dbCols = entry.columns;
    const modelCols = columnFields(model).map(columnOf);
    const { missingInModel, missingInDb } = classify(dbCols, modelCols);
    if (missingInModel.length) {
      failures.push({ kind: 'DB-COLUMN-NOT-IN-MODEL', model: model.name, table, detail: missingInModel.join(', ') });
    }
    if (missingInDb.length) {
      failures.push({ kind: 'MODEL-COLUMN-NOT-IN-DB', model: model.name, table, detail: missingInDb.join(', ') });
    }
  }

  const modelled = new Set(dmmf.models.map((m) => tableOf(m).toLowerCase()));
  const unmodelled = [...dbByTable.entries()].filter(([k]) => !modelled.has(k)).map(([, v]) => v.table);

  if (asJson) {
    console.log(JSON.stringify({ models: dmmf.models.length, modelledMatched, missingTables, unmodelledTables: unmodelled.length, failures }, null, 2));
  } else {
    console.log(`[schema-drift] models=${dmmf.models.length}  modelled-tables-found=${modelledMatched}  unmodelled-tables=${unmodelled.length} (out of scope — #769)`);
    if (!failures.length) {
      console.log('[schema-drift] ✅ OK — every modelled table has exactly the columns its model declares');
    } else {
      for (const f of failures) {
        console.log(`   ✗ ${f.kind}  ${f.model} -> ${f.table} : ${f.detail}`);
      }
      console.log(`[schema-drift] ✗ ${failures.length} field-level drift item(s) — a Prisma model can silently under-report the database (#948)`);
    }
  }
  return failures.length ? 1 : 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// LIVE CANARY — proves the AUDIT ITSELF can fail, against the REAL database.
// A synthetic model over a real table must be flagged in BOTH directions. This
// is what separates "the classifier is correct" from "the scan reads no tables".
// ─────────────────────────────────────────────────────────────────────────────

async function liveCanary() {
  const dmmf = Prisma.dmmf && Prisma.dmmf.datamodel;
  if (!dmmf) return false;
  // Pick a real table that has at least one column, deterministically.
  const dbByTable = await readDbColumns();
  let table = null;
  for (const m of dmmf.models) {
    const entry = dbByTable.get(tableOf(m).toLowerCase());
    if (entry && entry.columns.length >= 1) { table = entry.table; break; }
  }
  if (!table) { console.log('   ⚠️ live canary skipped — no modelled table readable'); return true; }

  const real = dbByTable.get(table.toLowerCase()).columns;
  // Omit the FIRST real column (-> must appear in missingInModel) and invent one (-> missingInDb).
  const fake = real.slice(1).concat(['zzz_drift_canary_not_real']);
  const r = classify(real, fake);
  const ok =
    r.missingInModel.length === 1 &&
    r.missingInModel[0].toLowerCase() === real[0].toLowerCase() &&
    r.missingInDb.length === 1 &&
    r.missingInDb[0] === 'zzz_drift_canary_not_real';
  console.log(`   live canary on "${table}": ${ok ? 'both directions detected ✓' : 'FAILED ✗'}`);
  return ok;
}

// ─────────────────────────────────────────────────────────────────────────────
// ENTRY
// ─────────────────────────────────────────────────────────────────────────────

(async () => {
  const args = process.argv.slice(2);
  try {
    if (args.includes('--self-test')) {
      const unitOk = selfTest();
      let canaryOk = true;
      try {
        canaryOk = await liveCanary();
      } catch (e) {
        console.log(`   ⚠️ live canary could not run: ${e.message}`);
        canaryOk = false;
      }
      process.exitCode = unitOk && canaryOk ? 0 : 1;
    } else {
      process.exitCode = await audit({ asJson: args.includes('--json') });
    }
  } catch (e) {
    console.error('[schema-drift] FAILED:', e.message);
    process.exitCode = 2;
  } finally {
    await prisma.$disconnect().catch(() => {});
  }
})();

module.exports = { tableOf, columnOf, columnFields, classify };
