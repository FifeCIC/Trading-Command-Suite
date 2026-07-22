# Handoff: Execution Queue → Unified Automation Hub (#457)

**Date:** 2026-06-21
**Issue:** [#457](https://github.com/FifeCIC/Trading-Command-Suite/issues/457)
**Files changed:**
- `nest/src/modules/automation/automation.controller.ts` — new `GET /api/automation/events` endpoint
- `src/pages/ExecutionQueuePage.jsx` — dual-tab redesign (Live Events + Protocol Queue)
- `src/pages/execution-queue.css` — new styles for tabs, event rows, type badges

## What changed

1. **Backend — `GET /api/automation/events?limit=50&type=automation|decision`**
   - Queries the existing `AutomationEvent` and `DecisionLog` Prisma models (already populated by the automation loop)
   - Returns a unified, time-sorted event stream with type badges (`automation` or `decision`), status, symbol, detail, durationMs, composite
   - Limit capped at 200, defaults to 50
   - `try/catch` guards against tables not existing yet

2. **Frontend — Execution Queue page redesigned**
   - Two tabs: **⟳ Live Events** (default) and **🏗 Protocol Queue** (legacy)
   - Live Events tab polls `/api/automation/events` every 3s
   - Shows event stats bar (Automation count, Decision count, Total)
   - Each event row: type badge (Tick/Decision), elapsed time, symbol chip, task name, detail, status badge, duration, composite score
   - Protocol Queue tab retains the existing ProtocolRun job view
   - `STATUS_COLORS` extended for automation statuses (EXECUTED, FAILED, SCORED, SKIP, BLOCKED)
   - Empty states: "No events yet" vs "Queue is empty"

3. **CSS** — added tab bar styles, event row layout, type badge colors, keyframe spinner

## What was NOT done (Phases 2-3 remain for future)

- No new `ScheduledEvent` Prisma model — instead wired existing `AutomationEvent` + `DecisionLog` tables which already capture the unified activity
- No per-cron-job enable/disable in the UI
- No alerting integration for task failures
- No next-run scheduling display (the infrastructure for this exists in `CronMeta` model)

## Verification

- NestJS `tsc` build: clean
- Vite build: 2909 modules, clean
- Services restarted: MT5 Bridge (5000), NestJS (3201), Vite (5173) all online
