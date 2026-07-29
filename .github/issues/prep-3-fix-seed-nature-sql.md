## Problem

`prisma/seed_nature.sql` classifies directive natures using `WHERE type IN ('rsi-oversold', 'macd-crossover', ...)`. But the `type` column in the `Directive` table stores the directive's CATEGORY (e.g. "Technical Analysis", "Other", "Risk & Structural") — NOT its ID. Every `WHERE type IN (...)` clause silently matches nothing. This file has been non-functional since it was written.

Discovered 2026-07-28. Documented in the file header.

## Task

Fix the SQL to use `id` instead of `type`, add `readiness` column updates, and ensure it works for both fresh installs and existing databases.

## Steps

- [ ] Change all `WHERE type IN (...)` to `WHERE id IN (...)` — this is the core fix
- [ ] Verify each directive ID in the lists actually exists (audit against live registry)
- [ ] Add `readiness` UPDATE statements: set default `'alpha'` for all, then promote known-ready directives
- [ ] The `AND (nature IS NULL OR nature = 'neutral')` clause remains — handles both fresh seeds (neutral default) and legacy NULLs
- [ ] Test on fresh install: `prisma db seed` → run SQL → verify natures and readiness correct
- [ ] Test on existing DB: run SQL → verify no duplicates, no data loss

## Acceptance

- [ ] SQL uses `WHERE id IN (...)` not `WHERE type IN (...)`
- [ ] All directive IDs in the SQL match actual registered directive IDs
- [ ] `readiness` column populated with sensible defaults
- [ ] SQL is idempotent (safe to run multiple times)
- [ ] Tested on both fresh install and existing database

## Related

- #516 (Layer A: Readiness Tiers)
- Prep #2: Add readiness field to IDirective
