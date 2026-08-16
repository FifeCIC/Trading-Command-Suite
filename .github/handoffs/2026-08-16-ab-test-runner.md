---
date: 2026-08-16
area: automation
type: feature
---

## What Changed

Added the A/B Test Runner (#482): an `AbTest` table referencing two MetaStack snapshots (control/variant), a `AbTestService` with lifecycle (create/start/stop/computeResults) enforcing the 1-active + max-4-symbol limits, four REST endpoints, and automation-loop integration that scores both snapshots per tick and dispatches side-tagged trades (`TCS AB-A` / `TCS AB-B` comments).

## Files Changed

- nest/prisma/schema.prisma — `AbTest` model mapped to `ab_test`
- nest/src/database/prisma.service.ts — `CREATE TABLE IF NOT EXISTS ab_test` bootstrap DDL
- nest/src/modules/automation/ab-test.service.ts — new `AbTestService` (lifecycle, limits, results aggregation from `Trade.abTestId`)
- nest/src/modules/automation/ab-test.controller.ts — new `AbTestController` (POST create/start/stop, GET results)
- nest/src/modules/automation/automation-loop.service.ts — `evaluateAbTest()` scores both snapshots per tick
- nest/src/modules/automation/automation.module.ts — registered + exported `AbTestService` + controller

## Capability Map Entry

- **name:** A/B Test Runner (MetaStack side-by-side)
- **persistence:** stored
- **uiSurfaces:** 0
- **pipeline:** trading
- **completion:** complete

## QA Test Entry

- **area:** Automation
- **name:** A/B test evaluates both stacks
- **procedure:** POST /api/automation/ab-tests with two snapshot ids + a symbol, POST /:id/start, POST /api/automation/run-now, then GET /:id/results
- **expected:** Tick returns two `ab-test:*` decisions (composite vs each stack's own tradeThreshold); results show per-side control/variant stats.

## Architecture Framework Entry

- **section:** routes
- **summary:** A/B Test Runner — `ab_test` table + `AbTestService` (1-active/4-symbol limits, results from `Trade.abTestId`) with endpoints under `/api/automation/ab-tests`; automation loop `evaluateAbTest()` scores both MetaStack snapshots via `protocolGating.scoreWithGating()` and dispatches side-tagged trades. Key files: `ab-test.service.ts`, `ab-test.controller.ts`, `automation-loop.service.ts`.
