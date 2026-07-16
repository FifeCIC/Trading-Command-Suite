---
date: 2026-07-16
area: data
type: feature
---

## What Changed

Implemented #356 Data Quick Wins: added scheduled daily cron for directive outcome pruning and MT5 adapter order persistence. Quick Win 1 (decision log persistence) was already implemented in AutomationLoopService.persistDecisions().

## Files Changed

- `nest/src/modules/system/data-retention.service.ts` — Added @Cron(CronExpression.EVERY_DAY_AT_3AM) scheduled method that calls pruneDirectiveOutcomes() daily
- `nest/src/modules/providers/adapters/mt5.adapter.ts` — Added PrismaService injection; placeOrder() now writes every order attempt (success + failure) to the Order table with ticket, price, status, and filledAt

## Capability Map Entry

- **name:** Data Quick Wins — Scheduled Pruning & MT5 Order Recording
- **persistence:** stored
- **uiSurfaces:** 0
- **pipeline:** none
- **completion:** complete

## QA Test Entry

- **area:** Data
- **name:** Verify scheduled pruning and MT5 order recording
- **procedure:** 1) Check data-retention logs for scheduled prune at 3 AM. 2) Trigger a manual MT5 trade via dashboard or speed-scan; verify an Order row appears with correct symbol/side/quantity/status/provider.
- **expected:** Directive outcomes older than 30 days pruned daily in batches. All MT5 order attempts (success and failure) recorded in the Order table with provider='mt5'.

## Architecture Framework Entry

- **section:** data
- **summary:** DataRetentionService now has a scheduled @Cron trigger (3 AM daily) for directiveoutcome pruning. Mt5Adapter.placeOrder() persists every order attempt to the Order table (complements the AutomationLoopService.persistDecisions() which handles decision_log and cross-broker order recording). DecisionLog persistence was already operational via persistDecisions() → prisma.decisionLog.createMany().

## Notes

- Quick Win 1 (decision_log persistence) was already implemented prior to this change — the `persistDecisions` method writes to both `decision_log` and `order` tables
- The new adapter-level Order INSERT in placeOrder() captures orders from ALL callers (manual dashboard, speed-scan, strategy service), not just the automation loop
- Automation loop orders will now have TWO Order records: one from the adapter (raw execution, actual ticket/price) and one from persistDecisions (strategic context with strategyId). This is noted for future deduplication if needed
- ScheduleModule.forRoot() is already registered globally via SchedulerModule — no additional module imports needed
