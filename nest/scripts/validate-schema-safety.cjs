#!/usr/bin/env node
/**
 * Schema safety check — refuse to let `prisma db push` delete live data.
 * =======================================================================
 *
 * THE PROBLEM
 * -----------
 * `prisma db push` is a DECLARATIVE DIFF WITH DESTRUCTIVE DEFAULTS. It treats
 * `schema.prisma` as the complete truth, so any database table with no matching model is
 * classified as garbage and dropped. It prints a warning list and waits for a `y`.
 *
 * That is correct behaviour for a database whose schema is only ever changed through
 * Prisma. It is dangerous the moment raw SQL creates a table — which this repo does
 * extensively. On 2026-09-10 a routine `db push` proposed dropping:
 *
 *   strategy_signal_queue   1 row      ← the trade execution queue (12 code references)
 *   paper_trade             44 rows    ← paper trading ledger
 *   signal_outcome_log      1,370 rows ← one row per persisted signal
 *   signal_outcome_meta     4,586 rows ← blocker / conflict / warning entries
 *   marketbar_ts_backup_... 195,391 rows ← rollback path for the #750 timestamp repair
 *   …plus 6 more populated objects
 *
 * None of those four live tables has a `CREATE TABLE` anywhere in the repo — they exist
 * only in the running database. A `db push` would have destroyed them with no error.
 *
 * WHAT THIS DOES
 * --------------
 * Compares live database tables against `schema.prisma` models. Any table that has NO
 * model must be listed in RAW_MANAGED_TABLES with a reason and an owning module. Anything
 * unlisted and non-empty FAILS the check, loudly, naming the row count.
 *
 * WHY A ROW COUNT AND NOT JUST A NAME LIST
 * ----------------------------------------
 * An empty unmodelled table is genuinely disposable — it is a leftover, and dropping it is
 * harmless. A table with rows is either live data or someone's rollback path, and the cost
 * of being wrong is asymmetric: refusing to build costs a minute, dropping 195,391 rows
 * costs the ability to verify a production repair. So the check only blocks on non-empty
 * tables, which keeps it from becoming noise that gets ignored (the failure mode the
 * contract validator's own comments warn about).
 *
 * ⚠️ NOT PART OF `prebuild`. It needs a live database, and a build that requires a live
 * database is a build nobody can run offline or in CI. Run it as a preflight:
 *
 *   npm run db:check          # from nest/
 *
 * EXIT CODES
 *   0  safe (or database unreachable — reported, not fatal)
 *   1  UNSAFE: unmodelled non-empty tables present. Do not run `db push`.
 */

const fs = require('fs');
const path = require('path');

const NEST_ROOT = path.resolve(__dirname, '..');
const SCHEMA_PATH = path.join(NEST_ROOT, 'prisma', 'schema.prisma');

/**
 * Tables that are deliberately managed outside Prisma.
 *
 * Every entry needs BOTH a reason and an owner. The reason is the documentation — an entry
 * that cannot explain itself is a table nobody understands, which is the state this check
 * exists to make visible. If you add a raw-managed table, add it here in the same commit.
 */
const RAW_MANAGED_TABLES = {
  strategy_signal_queue: {
    owner: 'automation',
    reason: 'Trade execution queue. Written via $executeRawUnsafe in automation-loop.service.ts and signal-queue.service.ts. On the money path — must never be dropped.',
  },
  paper_trade: {
    owner: 'automation',
    reason: 'Paper-trading ledger. Written in automation-loop.service.ts, read by automation.controller.ts.',
  },
  signal_outcome_log: {
    owner: 'signals',
    reason: 'One row per persisted signal (preTradeReady + counts). Written by signal-outcome.service.ts.',
  },
  signal_outcome_meta: {
    owner: 'signals',
    reason: 'Typed blocker / conflict / warning entries keyed to signal_outcome_log. Written by signal-outcome.service.ts.',
  },
  directiveoutcome_ts_backup_20260910: {
    owner: 'migration',
    reason: 'Pre-repair backup of directive outcome timestamps (#750). Rollback path — delete only once the repair is confirmed complete.',
  },
  marketbar_ts_backup_20260910: {
    owner: 'migration',
    reason: 'Pre-repair backup of market bar timestamps (#750), 195k rows. Rollback path — delete only once the repair is confirmed complete.',
  },
  position_ts_backup_20260910: {
    owner: 'migration',
    reason: 'Pre-repair backup of position timestamps (#750). Rollback path.',
  },
  trade_ts_backup_20260910: {
    owner: 'migration',
    reason: 'Pre-repair backup of trade timestamps (#750). Rollback path.',
  },
  watchlist_backup_763: {
    owner: 'migration',
    reason: 'Backup taken before the watchlist consolidation (#763). Rollback path.',
  },
  watchlist_backup_764: {
    owner: 'migration',
    reason: 'Backup taken before the watchlist consolidation (#764). Rollback path.',
  },
  // ⚠️ These were caught by this guard on 2026-09-10 ~18:30, created by another agent while
  // working #761. Declared here rather than removed: they are the rollback path for a change
  // in flight, and deleting someone else's backup mid-change is exactly the kind of
  // cross-agent interference this repo has already been bitten by.
  // OWNER: whoever is working #761 — delete these once that change is confirmed good.
  protocol_directive_entry_backup_761: {
    owner: 'migration',
    reason: 'Pre-change backup of protocol_directive_entry taken during #761 work. Rollback path — delete once #761 is confirmed complete.',
  },
  protocol_directive_group_backup_761: {
    owner: 'migration',
    reason: 'Pre-change backup of protocol_directive_group taken during #761 work. Rollback path — delete once #761 is confirmed complete.',
  },
  // Caught by this guard 2026-09-10 (second catch in one day) — created while working #780.
  // Same disposition: it is someone's rollback path for an in-flight change, so it is declared
  // rather than dropped. Consistency here matters more than tidiness — a backup deleted by a
  // different agent than the one who took it is unrecoverable for the original purpose.
  marketbar_future_orphan_backup_780: {
    owner: 'migration',
    reason: 'Backup of future-dated / orphaned market bars taken during #780 work. Rollback path — delete once #780 is confirmed complete.',
  },
};

/**
 * Strip Prisma line comments (`//` and `///`) so a `@@map(...)` that appears in PROSE is not read
 * as a directive.
 *
 * ⚠️ MEASURED 2026-09-29, and it was self-inflicted. A comment inside `BacktestPeriod` read
 * *"Same reason `SymbolRoute` carries `@@map(\"symbol_route\")`"* — and the parser, matching the
 * first `@@map` in the model body, resolved `BacktestPeriod` to **`symbol_route`**. The comment was
 * believed over the directive below it.
 *
 * Two failures in one: the model was checked against the WRONG table (so a correct mapping read as
 * corrupt), and `backtest_period` — the table it really maps to — looked unmodelled in the other
 * direction. A parser that reads comments as code is the same defect class as a document that lies.
 */
function stripComments(schema) {
  return schema
    .split('\n')
    .map((line) => {
      const i = line.indexOf('//');
      return i === -1 ? line : line.slice(0, i);
    })
    .join('\n');
}

/**
 * model -> the table it RESOLVES to (`@@map` value when present, else the model name verbatim).
 *
 * ⚠️ This direction is the one `schemaTables()` cannot express, and it is the direction that
 * breaks at runtime. Prisma's implicit table name is the model name EXACTLY — so a model called
 * `BacktestPeriod` looks for a table named `BacktestPeriod`. On Windows MySQL matches table names
 * case-insensitively, which is why the repo's older models work unmapped (`MarketBar` finds
 * `marketbar`) and why the failure is so easy to miss: it is the UNDERSCORE that differs, not the
 * case. A model with no `@@map` whose snake_case table exists resolves to `backtestperiod` and
 * finds nothing.
 */
function schemaModels(schema) {
  const code = stripComments(schema);
  const map = new Map();
  // ⚠️ `^\s*model`, NOT `^model`. Measured 2026-09-29: `BrokerSymbol` and `BrokerSymbolSync` are
  // INDENTED in this schema, so a line-start anchor misses them — and a missed declaration does not
  // merely go unreported, it makes the PREVIOUS model's block swallow everything up to the next
  // match. `StrategyRegistry` therefore resolved to `broker_symbol_sync`, another model's table.
  const blocks = [...code.matchAll(/^\s*model\s+(\w+)\s*\{/gm)];
  for (let i = 0; i < blocks.length; i++) {
    const name = blocks[i][1];
    const start = blocks[i].index;
    const end = i + 1 < blocks.length ? blocks[i + 1].index : code.length;
    const body = code.slice(start, end);
    // ⚠️ The LAST `@@map` in the block, not the first. A model block is `… @@map("x") }`, and
    // `code` is comment-free, so the last one is the directive — but taking `matchAll` and the last
    // entry also keeps this correct if a future Prisma feature adds a second map above it.
    const all = [...body.matchAll(/@@map\("([^"]+)"\)/g)];
    map.set(name, all.length ? all[all.length - 1][1] : name);
  }
  return map;
}

/**
 * Model names and `@@map` targets from schema.prisma.
 *
 * Reads both because a model may be mapped to a differently-named table, and comparing
 * against model names alone would report every `@@map`ped table as unmodelled — producing
 * a wall of false positives that would get the check disabled.
 */
function schemaTables(schema) {
  const names = new Set();
  for (const [model, table] of schemaModels(schema)) {
    names.add(model);
    // Prisma's implicit table name is the model name, so cover the lowercase form too.
    names.add(model.toLowerCase());
    if (table !== model) names.add(table);
  }
  return names;
}

/**
 * Every model that resolves to a table the database does not have.
 *
 * ⚠️ THE DEFECT THIS EXISTS FOR (#986, measured 2026-09-29). A new model `BacktestPeriod` was
 * added against a table created by hand as `backtest_period`, without `@@map`. Prisma resolved
 * it to `backtestperiod`, which does not exist — so EVERY query on the new service returned
 * HTTP 500 with "The table `backtestperiod` does not exist in the current database", while all
 * 20 unit tests passed. A mocked Prisma never touches a table name, so no test could see it; only
 * a request to the running API could.
 *
 * Pure, so `--self-test` can prove it fails in both directions without a database.
 */
function modelsMissingTables(models, liveTableNames) {
  const live = new Set([...liveTableNames].map((n) => String(n).toLowerCase()));
  const missing = [];
  for (const [model, table] of models) {
    if (!live.has(table.toLowerCase())) missing.push({ model, table });
  }
  return missing;
}

async function main() {
  if (!fs.existsSync(SCHEMA_PATH)) {
    console.error(`[schema-safety] schema not found at ${SCHEMA_PATH}`);
    process.exit(1);
  }
  const schema = fs.readFileSync(SCHEMA_PATH, 'utf8');
  const known = schemaTables(schema);
  const models = schemaModels(schema);

  // Uses the Prisma client's raw escape hatch — the same mechanism the application uses for
  // its raw-managed tables, and already a dependency. Deliberately NOT a new driver: adding
  // one to run a safety check would be its own supply-chain surface.
  //
  // ⚠️ Env must be loaded first. Prisma does NOT auto-load .env for scripts (only the CLI
  // does), so a bare `node scripts/…` would see no DATABASE_URL and silently skip.
  require('dotenv').config({ path: path.join(NEST_ROOT, '.env') });

  let prisma;
  try {
    const { PrismaClient } = require('@prisma/client');
    prisma = new PrismaClient();
  } catch (err) {
    console.log(`[schema-safety] Prisma client unavailable (${err.message.split('\n')[0]}) — skipping.`);
    process.exit(0);
  }

  let rows;
  try {
    rows = await prisma.$queryRawUnsafe(
      `SELECT TABLE_NAME AS name, TABLE_ROWS AS approx
         FROM information_schema.TABLES
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = 'BASE TABLE'
        ORDER BY TABLE_NAME`,
    );
  } catch (err) {
    // A database that is not running must NOT fail a check — otherwise the guard becomes
    // something people skip by default, which is worse than not having it.
    console.log(`[schema-safety] database unreachable (${String(err.message).split('\n')[0]}) — skipping.`);
    await prisma.$disconnect().catch(() => {});
    process.exit(0);
  }

  const unmodelled = [];
  for (const r of rows) {
    const name = String(r.name);
    if (known.has(name) || known.has(name.toLowerCase())) continue;    // TABLE_ROWS is an estimate for InnoDB. Confirm with a real COUNT so the reported
    // number is defensible — this is a guard, and a guard that cites a wrong count gets
    // argued with instead of acted on.
    let count = 0;
    try {
      const c = await prisma.$queryRawUnsafe(`SELECT COUNT(*) AS n FROM \`${name}\``);
      count = Number(c[0].n);
    } catch {
      count = Number(r.approx || 0);
    }
    unmodelled.push({ name, count, declared: !!RAW_MANAGED_TABLES[name] });
  }

  await prisma.$disconnect().catch(() => {});

  const undeclared = unmodelled.filter((t) => !t.declared && t.count > 0);
  const declared = unmodelled.filter((t) => t.declared);
  const emptyUndeclared = unmodelled.filter((t) => !t.declared && t.count === 0);

  // ── The OTHER direction: every declared model must resolve to a table that EXISTS ────────────
  //
  // ⚠️ Both directions are checked here because they are the same question asked twice, and the
  // second one is the one that fails at RUNTIME. A model with no table compiles, type-checks and
  // passes every unit test, then 500s on its first request — measured on #986, where all 20 tests
  // were green while `GET /api/backtest/periods` returned "the table backtestperiod does not exist".
  const missingTables = modelsMissingTables(models, rows.map((r) => String(r.name)));

  console.log(`[schema-safety] ${rows.length} tables; ${known.size} schema names; ${unmodelled.length} unmodelled; ${models.size} models`);
  for (const t of declared) {
    console.log(`  ✓ ${t.name} (${t.count} rows) — raw-managed by ${RAW_MANAGED_TABLES[t.name].owner}`);
  }
  for (const t of emptyUndeclared) {
    console.log(`  · ${t.name} (empty) — harmless leftover`);
  }

  if (undeclared.length > 0) {
    console.error('');
    console.error('[schema-safety] ✗ UNSAFE — these tables have NO schema model and HOLD DATA:');
    for (const t of undeclared) {
      console.error(`    ${t.name}  (${t.count.toLocaleString()} rows)`);
    }
    console.error('');
    console.error('  `prisma db push` would DROP these. Do not run it.');
    console.error('  Either add the table to schema.prisma, or declare it in RAW_MANAGED_TABLES');
    console.error('  in this file with a reason and an owning module.');
    console.error('');
    console.error('  To add a column safely:  ALTER TABLE ... ; npx prisma generate');
    process.exit(1);
  }

  // ⚠️ The model→table failure is reported BEFORE the all-clear, so the all-clear cannot be
  // printed for a schema that has a model with no table.
  if (missingTables.length > 0) {
    console.error('');
    console.error('[schema-safety] ✗ UNSAFE — these models resolve to a table the database does NOT have:');
    for (const m of missingTables) {
      console.error(`    ${m.model} -> ${m.table}   (no such table)`);
    }
    console.error('');
    console.error('  Every query on these models fails at runtime, and NO unit test can see it —');
    console.error('  a mocked Prisma never touches a table name.');
    console.error('');
    console.error('  FIX: Prisma uses the model name VERBATIM as the table name, so a table whose real');
    console.error('  name has an underscore needs an explicit map:');
    console.error('      model FooBar { ... @@map("foo_bar") }');
    console.error('  (The repo\'s older tables have no underscore — marketbar, backtestrun — which is');
    console.error('   why they work unmapped on Windows, where MySQL ignores case.)');
    console.error('');
    process.exit(1);
  }

  console.log('[schema-safety] ✅ OK — every non-empty table is either modelled or declared raw-managed.');
  console.log(`[schema-safety] ✅ OK — all ${models.size} declared model(s) resolve to a table that exists.`);
  process.exit(0);
}

/**
 * --self-test — prove the model→table check can FAIL, in both directions, with no database.
 *
 * "A guard that has never been observed to fail is not a guard. It is a decoration."
 *
 * ⚠️ This covers the PURE functions. The WIRING into `main()` was canaried separately, because a
 * correct function nobody calls is the same defect one level up:
 *
 *   Observed 2026-09-29 — a model with no `@@map` was temporarily appended to `schema.prisma`
 *   (`model CanaryTableThatCannotExist`), `db:check` was run, and it exited **1** naming that model
 *   under `UNSAFE`, after which the schema was restored byte-for-byte (SHA256 compared) and
 *   `db:check` went back to exit 0. The canary script was NOT kept: it edits `schema.prisma`, and
 *   a mutating canary that can be interrupted mid-run is a worse hazard in a shared working tree
 *   than the observation is worth. Re-run it by hand if this wiring is ever changed.
 */
if (process.argv.includes('--self-test')) {
  const cases = [
    {
      label: 'a model whose table exists passes',
      models: new Map([['MarketBar', 'MarketBar']]),
      live: ['marketbar'],
      expect: 0,
    },
    {
      // ⚠️ THE MEASURED DEFECT, exactly: a snake_case table with no @@map. Prisma looks for
      // `backtestperiod`; the database has `backtest_period`.
      label: '⚠️ a snake_case table with NO @@map is reported (the #986 defect)',
      models: new Map([['BacktestPeriod', 'BacktestPeriod']]),
      live: ['backtest_period'],
      expect: 1,
    },
    {
      label: 'the same model WITH @@map passes',
      models: new Map([['BacktestPeriod', 'backtest_period']]),
      live: ['backtest_period'],
      expect: 0,
    },
    {
      label: 'a model with no table at all is reported',
      models: new Map([['Ghost', 'Ghost']]),
      live: ['marketbar'],
      expect: 1,
    },
    {
      label: 'matching is case-insensitive, as MySQL on Windows is',
      models: new Map([['SymbolRoute', 'symbol_route']]),
      live: ['SYMBOL_ROUTE'],
      expect: 0,
    },
  ];

  let failed = 0;
  console.log('[schema-safety] self-test — model→table resolution');
  for (const c of cases) {
    const got = modelsMissingTables(c.models, c.live).length;
    const ok = got === c.expect;
    if (!ok) failed++;
    console.log(`  ${ok ? '✔' : '✖'} ${c.label} (expected ${c.expect} missing, got ${got})`);
  }

  // ⚠️ The PARSER is tested too, not only the comparison. A `@@map` quoted in a comment must not be
  // read as a directive — measured 2026-09-29, where prose made `BacktestPeriod` resolve to
  // `symbol_route` and the guard then checked the model against the wrong table.
  const parserCases = [
    {
      label: 'a `@@map` quoted in a COMMENT is ignored; the real directive wins',
      schema: [
        'model BacktestPeriod {',
        '  // Same reason `SymbolRoute` carries @@map("symbol_route").',
        '  id String @id',
        '  @@map("backtest_period")',
        '}',
      ].join('\n'),
      model: 'BacktestPeriod',
      expect: 'backtest_period',
    },
    {
      label: 'a model with no directive resolves to its own name',
      schema: ['model MarketBar {', '  id String @id', '}'].join('\n'),
      model: 'MarketBar',
      expect: 'MarketBar',
    },
    {
      label: 'a directive is read even when a comment mentions a different one',
      schema: [
        'model A {',
        '  // see @@map("wrong_one")',
        '  @@map("right_one")',
        '}',
      ].join('\n'),
      model: 'A',
      expect: 'right_one',
    },
    {
      // ⚠️ Measured 2026-09-29: `BrokerSymbolSync` is indented in this schema, so a `^model`
      // anchor missed it and `StrategyRegistry` absorbed its `@@map`.
      label: 'an INDENTED model declaration is found, and does not leak its @@map upward',
      schema: [
        'model StrategyRegistry {',
        '  id String @id',
        '  @@map("strategy_registry")',
        '}',
        '',
        '  model BrokerSymbolSync {',
        '    id String @id',
        '    @@map("broker_symbol_sync")',
        '  }',
      ].join('\n'),
      model: 'StrategyRegistry',
      expect: 'strategy_registry',
    },
    {
      label: 'the indented model itself resolves correctly',
      schema: [
        'model StrategyRegistry {',
        '  @@map("strategy_registry")',
        '}',
        '',
        '  model BrokerSymbolSync {',
        '    @@map("broker_symbol_sync")',
        '  }',
      ].join('\n'),
      model: 'BrokerSymbolSync',
      expect: 'broker_symbol_sync',
    },
  ];
  console.log('[schema-safety] self-test — schema parser');
  for (const c of parserCases) {
    const got = schemaModels(c.schema).get(c.model);
    const ok = got === c.expect;
    if (!ok) failed++;
    console.log(`  ${ok ? '✔' : '✖'} ${c.label} (expected ${c.expect}, got ${got})`);
  }

  console.log(
    failed === 0
      ? '[schema-safety] ✅ self-test passed — the check fires on a missing table and stays quiet otherwise'
      : `[schema-safety] ✗ self-test FAILED (${failed} case(s))`,
  );
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(`[schema-safety] unexpected failure: ${err.message}`);
  process.exit(1);
});
