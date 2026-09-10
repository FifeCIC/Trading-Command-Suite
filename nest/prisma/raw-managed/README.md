# Raw-managed tables

These tables are **managed outside Prisma** — created with raw SQL and accessed via
`$queryRawUnsafe` / `$executeRawUnsafe`. They deliberately have no model in
`schema.prisma`, so Prisma treats them as unmanaged.

## ⚠️ Why this folder exists

`prisma db push` is a declarative diff with **destructive defaults**: any database table
with no matching model is classified as garbage and dropped, after a warning and a `y`.
On 2026-09-10 a routine `db push` proposed dropping these tables **plus** six populated
backup tables:

| Table | Rows | Written by |
|---|---|---|
| `strategy_signal_queue` | 1 | `automation-loop.service.ts`, `signal-queue.service.ts` — **the trade execution queue** |
| `paper_trade` | 44 | `automation-loop.service.ts`, `automation.controller.ts` |
| `signal_outcome_log` | 1,370 | `signal-outcome.service.ts` |
| `signal_outcome_meta` | 4,586 | `signal-outcome.service.ts` |

None of them had a `CREATE TABLE` anywhere in the repo — they existed **only in the running
database**. So they were simultaneously:

- **unreproducible** — a fresh database would be missing them, and nothing would say so; and
- **one command from deletion** — invisible to Prisma, and Prisma's default is to drop.

The `.sql` files here are the reproduction path. They are captured from the live database
and include a `DROP TABLE IF EXISTS` so they are safely re-runnable.

## Rules

1. **Never run `prisma db push`** in this repo. `npm run db:push` is deliberately blocked
   and explains why.
2. **Adding a raw-managed table?** Add it here as `.sql` **and** declare it in
   `nest/scripts/validate-schema-safety.cjs` → `RAW_MANAGED_TABLES`, with a reason and an
   owning module. An undeclared non-empty table **fails** `npm run db:check`.
3. **Changing one?** Re-capture its `.sql` in the same commit, or the file stops being the
   reproduction path.
4. **Never delete the `*_backup_*_20260910` tables** until the #750 timestamp repair is
   confirmed complete. They are the rollback path.

## Where these belong long-term

`strategy_signal_queue` is on the **money path** (it is the queue the automation loop
executes from). It deserves a real Prisma model and a real migration rather than living
outside the ORM. The others are lower risk but the same drift will recur for each subsystem
that adds a table this way.

Tracked in `docs/schema-drift-control.md`.

## Verifying

```bash
npm --prefix nest run db:check
```

Passes when every non-empty, unmodelled table is declared. Fails, naming the table and its
row count, when one is not.
