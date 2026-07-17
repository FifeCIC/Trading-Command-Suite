---
date: 2026-07-16
area: scoring
type: enhancement
---

## What Changed

Resolved the competing weighting systems in META.Stack #5. Added `weightStrategy` field to `ScoringStrategy` model (DB + TypeScript interfaces) enabling users to choose between `group-weighted` and `maxscore-weighted` modes. Documented both systems clearly in source code. Implemented maxscore-weighted composite logic in `scoreWithGating()`.

## Files Changed

- nest/prisma/schema.prisma — `weightStrategy` column on ScoringStrategy (default: 'group-weighted')
- nest/src/modules/scoring/protocol-gating.service.ts — scoreWithGating() now accepts weightStrategy param, composite logic handles both modes, GatedScore.meta includes weightStrategy
- nest/src/modules/directives/directive-groups.ts — comprehensive JSDoc explaining both systems, how they interact, and when to use each
- nest/src/modules/automation/automation-loop.service.ts — ScoringStrategy interface + load path include weightStrategy, getGatedScore helper passes it through
- nest/src/modules/automation/automation.controller.ts — addScoringStrategy body type updated

## Capability Map Entry

- **name:** Weight Strategy Selection (group-weighted vs maxscore-weighted)
- **persistence:** stored
- **uiSurfaces:** 0
- **pipeline:** scoring
- **completion:** complete

## QA Test Entry

- **area:** Scoring
- **name:** Weight strategy selection produces different composites
- **procedure:** Call scoreWithGating() for same symbol+bars with both weight strategies. Verify maxscore-weighted composite differs from group-weighted when directive counts vary by group.
- **expected:** group-weighted gives more weight to Technical (0.40) regardless of how many sentiment directives fire. maxscore-weighted gives proportionally more weight to groups with higher maxScore directives, ignoring group weights.

## Architecture Framework Entry

- **section:** scoring
- **summary:** Weight Strategy — ScoringStrategy now has weightStrategy field (group-weighted | maxscore-weighted). Group-weighted uses group coefficients (Technical=0.40, Sentiment=0.35, Risk gating). Maxscore-weighted ignores group weights and computes composite from rawScore/maxScore ratio across all active directives. Both modes use risk gating identically. Documented in directive-groups.ts JSDoc with examples.
