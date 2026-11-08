# repairs — dated records of SQL repairs already applied to this database

**These are a RECORD, not a mechanism.** Nothing reads them, nothing runs them. They exist so a
repair that changed live data can be read back and understood, which is why they are kept verbatim
rather than tidied.

| Group | Files |
|---|---|
| Data repair, 2026-09-10 | `add-max-hold-hours-773`, `add-provider-routing`, `cleanup-oil`, `consolidate-crypto`, `consolidate-watchlists`, `fix-symbol-tickers`, `prune-future-orphans-780`, `resolve-us30`, `set-max-hold-hours-773`, `wire-china50-canonical`, `wire-hint-dependent-protocols` |
| Data repair, 2026-09-23 | `fix-exchange-label-959` |
| Data repair, 2026-11-05 | `wire-inactive-hint-protocols` |

## Why they are here and not in `nest/prisma/`

⚠️ **Measured 2026-11-07 — these 13 files sat at `nest/` ROOT, beside `package.json`, and that
location put them OUTSIDE BOTH DDL GATES.**

`validate-collation-consistency.cjs` scans `nest/prisma/**` and `validate-local-time-sources.cjs`
scans `prisma/**` + `src/**`. A `.sql` file one directory higher was never opened by either. Moving
them in to `nest/prisma/` (as part of the repository-layout tidy-up) made them visible for the first
time, and they immediately produced:

- **1** `CREATE TABLE` with no `ENGINE=` — `prune-future-orphans-780.sql`
- **19** `CURRENT_TIMESTAMP` / `NOW()` uses — in `add-provider-routing` (5), `consolidate-crypto`
  (6), `fix-symbol-tickers` (3), `cleanup-oil` (2), `resolve-us30` (2), `consolidate-watchlists` (1)

**That is the finding, and it is worth more than the tidy-up:** a file's *location* decided whether
it was validated. The 23 SQL files at `nest/prisma/` root pass both gates because they were written
under them; these 13 never were.

## ⚠️ They are excluded from both gates, deliberately, and that is a temporary state

Both validators skip `prisma/repairs/` with a comment naming this file. The reason is that these are
**records of statements that already ran**, and rewriting a record so it would pass a gate for future
DDL is falsifying the record, not fixing it.

**They must not be re-run as they stand.** If one needs to be re-run, convert its clock first:
`CURRENT_TIMESTAMP` → `UTC_TIMESTAMP()` for a value, `DEFAULT CURRENT_TIMESTAMP` →
`DEFAULT (UTC_TIMESTAMP(n))` for a default (see `.github/instructions/meta-stack-contracts` and
#844 — the app is UTC-only, so a repair script that writes local time writes wrong data).

**Retiring or converting this set is tracked work, not a drive-by.** Until it is done, treat every
file here as history: readable, not runnable.

## Why `wire-inactive-hint-protocols.sql` matters most

It was edited on **2026-11-05**, not September, so it may still be live tooling rather than history.
It is the first candidate for conversion. Until then it is in the same excluded folder as the rest,
which is stated here rather than assumed.
