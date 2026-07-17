# Agent Handoff — #288 Directive Stubbing Mechanism

**Date:** 2026-07-17
**Issue:** [#288](https://github.com/FifeCIC/Trading-Command-Suite/issues/288) — Stub or remove UNDERPERFORMING directives

---

## What was done

Added a DB-backed runtime stubbing mechanism for directives. When a directive's `active` flag is set to `false` in the database, it returns a zero-score stub result in the scoring pipeline instead of running its real calculation.

### Files changed

1. **`nest/src/modules/directives/directives.service.ts`**
   - Added `dbActiveStatuses: Map<string, boolean>` cache field
   - Added `refreshActiveStatuses()` async method — loads from DB, logs count
   - In `runAll()`: after protocol filter, before time-gate, added check:
     ```typescript
     if (this.dbActiveStatuses.has(id) && !this.dbActiveStatuses.get(id)) {
       results.set(id, { score: 0, confidence: 0, reason: `[STUBBED]...`, signalClass: 'neutral', ... });
       continue;
     }
     ```

2. **`nest/src/modules/directives/directives.module.ts`**
   - `onModuleInit()` — made `async`, added `await this.directivesService.refreshActiveStatuses()` at end

3. **`nest/src/modules/directives/directives.controller.ts`**
   - `list()` — `classification` and `performance` now check `dbActive` from DB:
     ```typescript
     classification: (!dbActive || isStub) ? 'stub' : (st?.count ? 'active' : 'untested')
     performance: (!dbActive || isStub) ? 'underperforming' : ...
     ```

### Directives stubbed

| Directive | maxScore | Priority | Issue |
|---|---|---|---|
| `support-resistance-levels` | 100 | 50 | 0% win rate (19 signals, SPY daily 730d) |
| `overhead-supply-pressure` | 100 | 50 | 0% win rate (44 signals) |
| `obv-divergence` | 120 | 86 | 40% win rate (21 signals, worse than random) |

### How to toggle

```bash
# Deactivate
curl -s -X PATCH http://localhost:3201/api/directives/<id> -H "Content-Type: application/json" -d @toggle_body.json
# where toggle_body.json = {"active":false}

# Reactivate
curl -s -X PATCH http://localhost:3201/api/directives/<id> -H "Content-Type: application/json" -d '{"active":true}'
```

### Verification

```bash
# API should show classification=stub, performance=underperforming, active=false
curl -s http://localhost:3201/api/directives | python -c "..." | grep -E "support-resistance|overhead-supply|obv-divergence"
```

### Caveats

- The cache loads at module init. Toggling via PATCH writes to DB but does NOT refresh the cache — a server restart is needed for runtime stubbing to take effect after toggle.
- The 3 directives were deactivated via PATCH API (which calls `upsertDirective()`). After next server restart, the `refreshActiveStatuses()` call will load them as inactive.
- Current running process (PID from tcs-launch) may not have the `runAll()` check yet — a `tcs-launch.ps1` restart will pick up the new dist.
