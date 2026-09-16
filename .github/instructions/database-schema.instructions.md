---
description: "MANDATORY before any database schema change. This repo has 13 tables managed outside Prisma (including the trade execution queue) and NO migration history, so `prisma db push` will silently DROP live data. Read before adding/changing a table or column."
applyTo: "nest/**"
---

# Database Schema Changes — Read Before Touching the Schema

**Status:** 🛑 `prisma db push` is unsafe in this repo. It will destroy live data.
**Issue:** #769 · **Detail:** `docs/schema-drift-control.md` · **Guard:** `npm --prefix nest run db:check`

---

## The 30-second version

```powershell
# ✅ To add a column:
ALTER TABLE <table> ADD COLUMN ...     # targeted, non-destructive
npx prisma generate                    # tell the client about it

# ✅ To add a table that Prisma manages:
#    edit schema.prisma, then see "Adding a table" below

# 🛑 NEVER:
prisma db push                         # DROPS every table with no schema model
```

---

## Why — the trap, in full

`prisma db push` is a **declarative diff with destructive defaults**. It treats
`schema.prisma` as the complete truth about the database, so **any table with no model in
`schema.prisma` is classified as garbage and dropped**. Prisma prints a warning list, waits
for a `y`, and proceeds.

That is correct behaviour for a database whose schema is only ever changed through Prisma.
It is dangerous here because this repo's faster-moving subsystems create tables with **raw
SQL** and access them with `$queryRawUnsafe` / `$executeRawUnsafe`.

### Four live tables have no model — and no `CREATE TABLE` anywhere in the repo

| Table | Written by | What it is |
|---|---|---|
| `strategy_signal_queue` | `automation-loop.service.ts`, `signal-queue.service.ts` | **The trade execution queue.** On the money path. |
| `paper_trade` | `automation-loop.service.ts`, `automation.controller.ts` | Paper-trading ledger |
| `signal_outcome_log` | `signal-outcome.service.ts` | One row per persisted signal |
| `signal_outcome_meta` | `signal-outcome.service.ts` | Blocker / conflict / warning entries |

They exist **only in the running database**. A `db push` on 2026-09-10 would have dropped
these plus six populated backup tables (including `marketbar_ts_backup_20260910`, 195,391
rows — the rollback path for the #750 timestamp repair).

**There is also no migration history at all** — no `_prisma_migrations` table, no
`nest/prisma/migrations/`. Every schema change this repo has ever made was a direct
`db push`, so drift cannot be reconciled against anything. 121 live tables vs 111 models.

### The failure mode is the dangerous one

It does **not error**. It prints a list and asks for confirmation. An agent running
non-interactively, or a human holding Enter, deletes the execution queue and gets no
signal that anything went wrong. Same shape as the invariants in
`meta-stack-contracts.instructions.md`: *plausible, silent, wrong.*

---

## What to do instead

### Adding a column (the common case)

```powershell
$env:MYSQL_PWD='tradingcs_dev_2026'
& "C:\wamp64\bin\mysql\mysql9.1.0\bin\mysql.exe" -u tradingcs tradingcs -e `
  "ALTER TABLE protocol ADD COLUMN myColumn VARCHAR(50) NULL;"

# Then, with the API STOPPED (see gotcha below):
npm --prefix C:\wamp64\www\trading-command-suite\nest exec -- prisma generate
```

Also add the field to `schema.prisma` **in the same commit**, so the model matches reality.

### Adding a Prisma-managed table

1. Add the model to `nest/prisma/schema.prisma`.
2. Create the table with a targeted `CREATE TABLE` (copy the shape Prisma would generate, or
   let `prisma migrate diff` produce the SQL for you and review it before running).
3. `npx prisma generate`.

**Create the table yourself; never let `db push` decide the diff.** The whole problem is
that `db push` decides about tables you did not intend to change.

### Adding a raw-managed table (raw SQL + `$queryRawUnsafe`)

Allowed — it is how the automation queue works — but you MUST do both of these in the same
commit, or `npm run db:check` will fail the build:

1. Capture its DDL into `nest/prisma/raw-managed/<table>.sql`.
2. Declare it in `nest/scripts/validate-schema-safety.cjs` → `RAW_MANAGED_TABLES`, with a
   **reason** and an **owning module**.

An undeclared non-empty table is treated as a data-loss risk, because that is what it is.

---

## The guard

```powershell
npm --prefix C:\wamp64\www\trading-command-suite\nest run db:check
```

Compares live database tables against schema models. **Fails** on any non-empty table that
is unmodelled and undeclared, naming it and its row count. Empty unmodelled tables are
reported as harmless and do not fail — otherwise the check would be noisy enough to be
ignored, which is worse than not having it.

Run it **before** any schema work, and before closing a schema-touching issue.

`npm run db:push` is deliberately **blocked** and explains why. The escape hatch is
`db:unsafe-push-I-have-read-the-warning`, which runs the guard first.

### ⚠️ Adding an index? Two more guards, because `schema.prisma` is not the database

```powershell
npm --prefix C:\wamp64\www\trading-command-suite\nest run db:config-refs   # LIVE
node nest/scripts/validate-retention-columns.cjs                          # static, in prebuild
```

`db:check` compares **tables**. It does not compare **indexes**, and this repo has no migration
history — indexes are applied by hand with `ALTER TABLE` because `db push` is banned. So an
`@@index` line can exist in `schema.prisma` while the database has nothing, and every build stays
green.

That gap has teeth for one specific case: **any column used as a range predicate should LEAD an
index.** A column that merely appears in a composite index cannot serve `WHERE col < x` or
`SELECT MIN(col)`.

⚠️ **CORRECTION (2026-09-16).** An earlier version of this section claimed a missing index on
`directiveoutcome.createdAt` caused a 32-second scan of a 1,497 MB table and so a 504 on
`/api/system/health-dashboard`. **That is not supported.** The table is **1.10 MB / ~7,000 rows**;
`apiactivitylog` records exactly **one** 504 and the endpoint was healthy again six minutes later,
before the index was added. Two changes were made at once — add index + restart API — and the
credit went to the one with a story. See the full correction in
`change-completion.instructions.md` → Gate 3.

The rules below are still worth having on their own merits (they are cheap, and `schema.prisma`
is genuinely not the database here). What is withdrawn is the claim that they would have
prevented that outage.

`db:config-refs` closes that gap by checking the **live** database: every column a config file
names must exist, must be the leading column of a real index, and its predicate must answer within
budget. `validate-retention-columns.cjs` checks the same property statically from `schema.prisma`
so it runs in `prebuild` with no database. They are complementary — neither subsumes the other.

See `change-completion.instructions.md` → Gate 3 → *"a config that PARSES is not a config that
WORKS"* for why both exist and what was missing before them.

---

## ⚠️ Gotcha: `prisma generate` fails with EPERM while the API runs

`prebuild` runs `prisma generate`, which cannot replace
`node_modules/.prisma/client/query_engine-windows.dll.node` while the API holds it.

**Stop the API before `npm run build`** (or before `prisma generate`).

If a build fails after `rimraf dist`, `dist` is left **incomplete** — the API will then fail
to start with `Cannot find module './app.controller'`. Recover with:

```powershell
cd C:\wamp64\www\trading-command-suite\nest
npx rimraf dist; npx tsc -p tsconfig.build.json
```

---

## Rules

| | |
|---|---|
| 🛑 **Never** run `prisma db push` | It drops every unmodelled table. Issue #769. |
| 🛑 **Never** delete `*_backup_*_20260910` tables | They are the #750 timestamp-repair rollback path. |
| ✅ **Always** `ALTER TABLE` / targeted `CREATE TABLE` | Non-destructive and reviewable. |
| ✅ **Always** update `schema.prisma` in the same commit | Otherwise the model drifts from reality again. |
| ✅ **Always** run `db:check` before closing a schema-touching issue | It is the only thing standing between a routine push and data loss. |
| ✅ **Always** put `CREATE TABLE` in a migration/script, **never** in a service method | Repeated execution is a different bug. |
