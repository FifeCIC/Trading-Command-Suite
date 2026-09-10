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
 * Model names and `@@map` targets from schema.prisma.
 *
 * Reads both because a model may be mapped to a differently-named table, and comparing
 * against model names alone would report every `@@map`ped table as unmodelled — producing
 * a wall of false positives that would get the check disabled.
 */
function schemaTables(schema) {
  const names = new Set();
  for (const m of schema.matchAll(/^model\s+(\w+)/gm)) {
    names.add(m[1]);
    // Prisma's implicit table name is the model name, so cover the lowercase form too.
    names.add(m[1].toLowerCase());
  }
  for (const m of schema.matchAll(/@@map\("([^"]+)"\)/g)) {
    names.add(m[1]);
  }
  return names;
}

async function main() {
  if (!fs.existsSync(SCHEMA_PATH)) {
    console.error(`[schema-safety] schema not found at ${SCHEMA_PATH}`);
    process.exit(1);
  }
  const schema = fs.readFileSync(SCHEMA_PATH, 'utf8');
  const known = schemaTables(schema);

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
    if (known.has(name) || known.has(name.toLowerCase())) continue;
    // TABLE_ROWS is an estimate for InnoDB. Confirm with a real COUNT so the reported
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

  console.log(`[schema-safety] ${rows.length} tables; ${known.size} schema names; ${unmodelled.length} unmodelled`);
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

  console.log('[schema-safety] ✅ OK — every non-empty table is either modelled or declared raw-managed.');
  process.exit(0);
}

main().catch((err) => {
  console.error(`[schema-safety] unexpected failure: ${err.message}`);
  process.exit(1);
});
