---
date: 2026-09-06
area: scoring
type: feature
---

## What Changed

#600 — protocol highest-ever composite is now a durable metric. Added `Protocol.highestScore` (FLOAT NULL) which survives `Score` pruning. `buildBestLadder` tracks the peak composite per protocol each run and atomically bumps the column only when the new score exceeds the stored value.

## Files Changed

- nest/prisma/schema.prisma — `highestScore Float?` on Protocol
- nest/src/modules/signals/signal-envelope.service.ts — `maxCompositeBySlug` tracking + `protocol.updateMany` bump-on-exceed in buildBestLadder

## Capability Map Entry

- **name:** Protocol Highest-Ever Score
- **persistence:** stored
- **uiSurfaces:** 0
- **pipeline:** scoring
- **completion:** complete

## QA Test Entry

- **area:** Scoring
- **name:** Highest-ever score persists and only bumps on exceed
- **procedure:** GET /api/signals/best, then `SELECT slug, highestScore FROM protocol`; manually set a higher peak and re-score
- **expected:** The column records the run's peak; a lower subsequent score never overwrites a higher stored peak

## Architecture Framework Entry

- **section:** scoring
- **summary:** Protocol Highest-Ever Score — `Protocol.highestScore` persists the peak composite across runs (survives Score pruning). Updated atomically in buildBestLadder only when exceeded. Foundation for #685 ceiling research and the #725 smart-gate `highestEver` term.
