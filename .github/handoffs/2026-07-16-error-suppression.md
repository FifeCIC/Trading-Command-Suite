# Handoff — 2026-07-16 Session

## Completed: Duplicate Error Suppression (#378 remaining piece)

### What was implemented
Added per-symbol duplicate error suppression in the automation loop's watchlist scoring:

1. **Per-symbol try/catch** — Previously, any single symbol failure aborted the entire watchlist strategy. Now each symbol is independently error-handled.

2. **Cross-tick error dedup** — Uses a `suppressedErrors` Map tracking `{lastTick, count, firstSeenAt}` per error key (`strategyId:symbol:errorMessage`):
   - **First occurrence**: Logged normally with `logger.warn`
   - **Consecutive repeat** (same error next tick): Suppressed — only increments counter
   - **Reappears after gap**: Logs summary like `"×12 since 14:30:00, silenced for 300s"`
   - **Always pushes a FAILED decision** to `decision_log` for DB audit trail

3. **Startup crash fixed** — `bar-refresh.service.ts` had stale compiled JS; clean rebuild (409 files) resolved it.

### Files Changed
```
nest/src/modules/automation/automation-loop.service.ts   — per-symbol catch + error dedup map
```

### Build Status
- NestJS: ✅ Clean build (409 JS files)
- Vite: Not rebuilt (no frontend changes)

### DB Context (from other agent's changes)
The automation loop now has dual DB logging:
- `DecisionLog` table — one row per strategy eval per tick (`persistDecisions()`)
- `AutomationEvent` table — step-by-step audit trail via `AuditLogService`
- File-based `ScoringLogService` still active for scoring run summaries

### Suppressed error tracking
The `suppressedErrors` map is in-memory (resets on NestJS restart). For persistent cross-restart tracking, could be extended to query `automation_event` or `decision_log` tables on startup.
