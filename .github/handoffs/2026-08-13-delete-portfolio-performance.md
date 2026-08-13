---
date: 2026-08-13
area: scoring
type: bugfix
---

## What Changed

Deleted the `portfolio-performance` directive entirely. It was rubbish: misnamed ("portfolio" but computed symbol price momentum only), had an inverted drawdown bonus, sat in the wrong "risk" group, and was a beta stub. Removed from all 33 protocols, the stub class, module registration, group definitions, suitability registry, controller maps, and the database.

## Files Changed

- nest/src/modules/scoring/protocols-seed-data.ts — removed "portfolio-performance" from all protocol risk groups (via scripts/remove-seed-directive.cjs)
- nest/src/modules/directives/implementations/placeholder-directives.stub.ts — deleted PortfolioPerformanceDirective class
- nest/src/modules/directives/directives.module.ts — removed import/provider/constructor/register
- nest/src/modules/directives/directive-groups.ts — removed from 3 group lists
- nest/src/modules/directives/directive-suitability.registry.ts — removed entry
- nest/src/modules/directives/directives.controller.ts — removed from category + STUB_IDS maps
- nest/scripts/delete-directive.cjs — NEW cleanup tool: deletes directive from DB (directive, global_setting, protocol_directive_entry)
- nest/scripts/remove-seed-directive.cjs — NEW cleanup tool: mechanically removes directive id from seed data

## Result

xau-speed-v1 risk group now: liquidity-check, vix-regime. Registry maxScore 1,460 → 1,370 (−90). DB rows for portfolio-performance: 0.

## Capability Map Entry

- **name:** Directive deletion cleanup tooling
- **persistence:** stored
- **uiSurfaces:** 0
- **pipeline:** scoring
- **completion:** complete

## QA Test Entry

- **area:** Scoring
- **name:** Deleted directive absent from scoring and registry
- **procedure:** GET /api/scoring/breakdown/XAUUSD?protocol=xau-speed-v1 and check risk group; GET /api/directives and confirm portfolio-performance absent.
- **expected:** portfolio-performance no longer appears anywhere.

## Architecture Framework Entry

- **section:** scoring
- **summary:** portfolio-performance directive deleted (rubbish stub). New cleanup tooling: scripts/delete-directive.cjs (DB) + scripts/remove-seed-directive.cjs (seed data). Readiness review tracked in /memories/repo/directive-audit-progress.md.
