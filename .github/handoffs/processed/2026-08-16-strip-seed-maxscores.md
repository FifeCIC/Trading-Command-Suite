---
date: 2026-08-16
area: scoring
type: refactor
---

## What Changed

Removed the now-dead per-protocol `directiveMaxScores` overrides from `protocols-seed-data.ts` (124 blocks + the `SeedProtocolGroup` interface field). Since the 2026-08-13 single-source refactor, `seedProtocolsToDatabase` derives maxScore from the directive class, so these overrides were dead data that could silently drift from class values. Also removed the dead fallback in the seeder and pruned 5 orphaned `earnings-proximity` DB rows left by the #626 cleanup.

## Files Changed

- nest/src/modules/scoring/protocols-seed-data.ts — stripped 124 `directiveMaxScores` blocks + interface field; maxScore now class-derived everywhere
- nest/src/modules/scoring/protocol-db.service.ts — seed now `maxScore = directivesService.get(did)?.maxScore ?? 100` (removed `group.directiveMaxScores` fallback)
- nest/scripts/strip-seed-maxscores.cjs — one-off strip + safety cross-check (aborts if any seed id has no class)
- nest/scripts/verify-seed-maxscores.cjs — recurring QA: DB entry maxScore vs class maxScore
- nest/scripts/prune-orphan-entries.cjs — recurring QA: delete entries whose directiveId is not in any seed group

## Capability Map Entry

- **name:** Seed maxScore single-source enforcement
- **persistence:** stored
- **uiSurfaces:** 0
- **pipeline:** scoring
- **completion:** complete

## QA Test Entry

- **area:** Scoring / Protocols
- **name:** Seed data has no dead maxScore overrides
- **procedure:** `grep directiveMaxScores nest/src/modules/scoring/protocols-seed-data.ts` → 0 matches; then `POST /api/scoring/gated/protocols/seed` and run `node nest/scripts/verify-seed-maxscores.cjs`.
- **expected:** Grep returns nothing; verify script prints PASS with 0 mismatches.

## Architecture Framework Entry

- **section:** scoring
- **summary:** Protocol seed data no longer carries per-protocol directiveMaxScores — maxScore is single-sourced from the directive class during seeding. Verification + orphan-prune scripts keep seed data and live DB in lockstep.
