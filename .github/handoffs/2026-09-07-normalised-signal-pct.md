---
date: 2026-09-07
area: scoring
type: feature
---

## What Changed

#726 — `score_snapshot` now persists the normalised percentages alongside the raw composite: `signalPct` (pre-gate directional %, the "signal %" a user sees) and `opportunityPct` (additive screening %). Before this, neither was stored, so the ceiling distribution (#685) could not be queried.

## Files Changed

- nest/prisma/schema.prisma — `signalPct Float?` + `opportunityPct Float?` on ScoreSnapshot
- nest/src/modules/scoring/protocol-gating.service.ts — pass `compositePct` into `storeSnapshot` and write both fields on the snapshot row

## Capability Map Entry

- **name:** Normalised Signal % Persistence
- **persistence:** stored
- **uiSurfaces:** 0
- **pipeline:** scoring
- **completion:** complete

## QA Test Entry

- **area:** Scoring
- **name:** score_snapshot carries normalised signal %
- **procedure:** Trigger a scoring run, then `SELECT signalPct, opportunityPct FROM score_snapshot WHERE signalPct IS NOT NULL ORDER BY snappedAt DESC`
- **expected:** Rows show sane 0–100 values (e.g. vix-short-v1 ~87, forex-session-v1 20–48) even when `composite` is 0 (gated)

## Architecture Framework Entry

- **section:** scoring
- **summary:** Normalised Signal % Persistence — `score_snapshot.signalPct` (pre-gate directional %) and `opportunityPct` are now written by `storeSnapshot`, making the ceiling distribution (#685) and the #725 smart-gate ceiling reasoning queryable on a comparable 0–100 scale.
