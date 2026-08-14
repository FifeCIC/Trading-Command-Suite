---
date: 2026-08-14
area: scoring
type: bugfix
---

## What Changed

Deleted the `news-sentiment-positive` directive entirely. It was a mock-first stub: `calculate()` reads `bars[].sentiment` / `bars[].sentimentScore`, which nothing in the codebase ever writes onto bars (news is imported into the `NewsArticle` DB table, but never attached to bars). So it always returned a constant 45/100 "Mock-neutral score", dragging the composite toward neutral and inflating the denominator by 100 in 35 protocols.

Removed from all 35 protocols, the real class (`news-sentiment.directive.ts`), the stub duplicate in `placeholder-directives.stub.ts`, module registration, group definitions, suitability registry, controller maps, strategy seeds/prerequisites, frontend strategy-library, and the database.

## Files Changed

- nest/src/modules/directives/implementations/news-sentiment.directive.ts — DELETED
- nest/src/modules/directives/implementations/placeholder-directives.stub.ts — deleted stub class
- nest/src/modules/directives/directives.module.ts — removed import/provider/constructor/register
- nest/src/modules/directives/directive-groups.ts — removed from 3 group lists
- nest/src/modules/directives/directive-suitability.registry.ts — removed entry
- nest/src/modules/directives/directives.controller.ts — removed category + external-data + nature map entries
- nest/src/modules/scoring/protocols-seed-data.ts — removed from all 35 protocols (via scripts/remove-seed-directive.cjs)
- nest/src/modules/strategies/strategy-prerequisites.ts — removed from 1 requiredDirectives
- nest/src/modules/strategies/strategy-seeds.ts — removed from 2 strategy directiveIds
- src/data/strategy-library.js — removed 2 directiveMapping entries

## Result

`xau-speed-v1` sentiment group now contains only `gold-macro-correlation` + `gold-session-profile`. Registry maxScore 1,230 → 1,130 (−100); directive count 12 → 11. DB rows for news-sentiment-positive: 0.

`earnings-proximity` is the remaining mock-first stub tracked in GH #626.

## QA Test Entry

- **area:** Scoring
- **name:** Deleted directive absent from scoring and registry
- **procedure:** GET /api/scoring/breakdown/XAUUSD?protocol=xau-speed-v1 and check sentiment group; GET /api/directives and confirm news-sentiment-positive absent.
- **expected:** news-sentiment-positive no longer appears anywhere; sentiment group has only gold-macro-correlation + gold-session-profile.
