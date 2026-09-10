# Schema drift control — diagnosis and proposed measures

**Date:** 2026-09-10
**Trigger:** `prisma db push` proposed dropping 12 populated objects. Investigating why.

---

## The diagnosis is worse than "drift"

This is not untidy schema. It is **an unreproducible schema**:

1. **No migrations history exists at all.** No `_prisma_migrations` table, no
   `nest/prisma/migrations/` directory. Every schema change in this repo's life has been a
   direct `db push`. There is no record of *when* anything changed or *why*, so a drifted
   database cannot be reconciled — there is nothing to reconcile against.

2. **Four tables holding live data have no `CREATE TABLE` anywhere in the repo.**
   They exist only in the running database:

   | Table | Rows | Written by |
   |---|---|---|
   | `strategy_signal_queue` | 1 | `automation-loop.service.ts` (12 references) — **the trade execution queue** |
   | `paper_trade` | 44 | `automation-loop.service.ts`, `automation.controller.ts` |
   | `signal_outcome_log` | 1,370 | `signal-outcome.service.ts` |
   | `signal_outcome_meta` | 4,586 | `signal-outcome.service.ts` |

   Because they are absent from `schema.prisma`, Prisma classifies them as unmanaged and
   **its default `db push` behaviour is to drop them.** A single `npm run db:push` would
   have destroyed the trade execution queue and 5,956 rows of signal outcome history, with
   no error and no backup.

3. **The six backup tables are also unmodelled**, including
   `marketbar_ts_backup_20260910` (195,391 rows) created during today's timestamp repair.
   Those are recoverable by re-deriving, but only if someone remembers why they exist.

4. **The database has 121 tables against 111 schema models.** Ten objects are invisible to
   the ORM — so they are untracked, unprotected, and one `db push` from deletion.

**Root cause:** the app's newer subsystems (automation queue, paper trading, signal
outcomes) were built by adding tables with raw SQL and accessing them via
`$queryRawUnsafe` / `$executeRawUnsafe`. That is a legitimate pattern for a fast-moving
subsystem, but nothing ever registered those tables with the schema or the migration
system, so the ORM's view of the database silently diverged from reality.

---

## Why this is a load-bearing risk, not housekeeping

`db push` is a **declarative diff with destructive defaults**. It treats
`schema.prisma` as the complete truth: anything in the database but not in the file is
garbage to be removed. That is correct for a database whose schema is only ever changed
through Prisma. It is dangerous the moment raw SQL creates anything — which it has,
extensively.

The failure mode is the one this codebase keeps hitting: **it does not error.** `db push`
prints a warning list, waits for a `y` (which a non-interactive or CI invocation may
supply), and proceeds.

---

## Proposed measures, in dependency order

### 1. Make the destructive path impossible to reach by accident (immediate)

- **Rename the script.** `nest/package.json` has a `db:push` script that runs
  `prisma db push`. Either remove it or rename it to `db:push:DESTRUCTIVE` and require an
  explicit confirmation flag. A memorable script name is a loaded gun.
- **Never `db push` against a database with unmodelled tables.** Before any push, compare
  DB tables against schema models and refuse if unknown tables hold rows. This is a
  scriptable guard (proposed below).

### 2. Bring the ten unmodelled tables under management (the real fix)

Three options; I recommend **(c)**:

| Option | What it means | Trade-off |
|---|---|---|
| (a) Model them properly in `schema.prisma` | Full ORM access, appears in diffs | Significant typing work; risk of getting column types subtly wrong on live tables |
| (b) Add `@@ignore` / mark as unmanaged | Prisma stops proposing to drop them | Documented for tables with no unique identifier; not a general escape hatch |
| **(c) Extract the live DDL into SQL, version it, and **separate** Prisma-managed from raw-managed** | `SHOW CREATE TABLE` → checked-in `.sql`; a documented, tested path for raw-managed tables | Requires agreeing that two management regimes coexist — which is the truth today |

**Recommendation: (c), then (a) for `strategy_signal_queue` specifically** — it is on the
trade execution path, so it deserves a real model and a real migration.

### 3. Adopt a migrations baseline so drift becomes visible

`prisma migrate diff` can generate a baseline from the current database **without touching
it**. Once a baseline exists, `migrate status` reports drift, and drift becomes a thing you
can *see* instead of a thing you discover by almost deleting 195,000 rows.

This is the single highest-value change: it converts an invisible condition into a
reported one.

### 4. A build-time or preflight guard (fits the existing enforcement pattern)

This repo already enforces its pipelines with
`nest/scripts/validate-pipeline-contracts.cjs` in `prebuild`, and the instruction files
describe the philosophy precisely: *"an invariant nothing checks is a comment"* and
*"zero-tolerance with an explicit whitelist whose stale entries FAIL the build"*.

A `validate-schema-safety.cjs` in the same spirit would:

1. Read `schema.prisma` models and `@@map` names.
2. Read live DB tables.
3. Fail if any DB table with **rows > 0** is absent from the schema, unless listed in an
   explicit `RAW_MANAGED_TABLES` allowlist **with a reason and an owning module**.

That last clause matters: the allowlist entry is the documentation. An entry that goes
stale (table dropped, or rows permanently zero) should fail the build, exactly like the
existing stale-whitelist rule.

⚠️ **Caveat to decide:** this needs a database connection, so it can only run where one is
available. It should therefore be a **preflight/dev task, not part of `prebuild`** — a
build that requires a live DB is a build nobody can run offline. Suggested home: a
`db:check` script plus a line in the pre-push routine.

### 5. Back up before any schema-changing command (belt and braces)

The existing Google Drive backup manifest exists for a reason. Make the destructive path
*say what it will destroy* and require an explicit acknowledgement of the table names,
rather than a bare `y`. Prisma does list them, but the list is long and scrolls — a
guard that requires typing the count or the highest-row table name would force reading it.

---

## What I am NOT recommending

- **Do not run `db push --accept-data-loss`** to "clear" the drift. It would drop the four
  live tables and the six backups, and it resolves nothing — the schema would drift again
  the next time a raw table is added.
- **Do not delete the backup tables** until the timestamp repair is confirmed complete.
  They are the rollback path for #750.
- **Do not attempt a full `schema.prisma` rewrite in one pass.** 111 models against 121
  live tables, with column-level drift on both sides (e.g. `trade.exitPriceRaw`,
  `trade.pnlRaw`, `symbol_route.provider` are in the DB but not the schema). Getting this
  wrong on a live database is worse than the current state, which at least *works*.

---

## Immediate safety state

While this is unresolved, the rules are:

1. **Never run `prisma db push`** in this repo. Add columns with targeted `ALTER TABLE`,
   then `npx prisma generate`.
2. **Stop the API before `npm run build`** in `nest/` — `prebuild` runs
   `prisma generate`, which fails with `EPERM` while the API holds the query-engine DLL.
3. **Treat the ten unmodelled tables as production data.** They are not junk.
