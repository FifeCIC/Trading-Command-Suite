# Handoff: Trade Pipeline Audit — Schema + Traceability (#446)

**Date:** 2026-07-22
**Issue:** [#446](https://github.com/FifeCIC/Trading-Command-Suite/issues/446)
**Files changed:**
- `nest/prisma/schema.prisma` — Trade model: added ticket, sl, tp, magic, swap, brokerComment
- `nest/src/modules/trading/trade-recorder.service.ts` — TradeRecord interface + record() writes all MT5 fields
- `nest/src/modules/trading/mt5-trading.service.ts` — placeOrder() passes MT5 fields to recorder
- `nest/src/modules/automation/automation-loop.service.ts` — dispatchOrder() passes ticket/sl/tp/comment
- `nest/src/modules/providers/mt5.controller.ts` — legacy endpoints now write Trade records
- `src/pages/Mt5TradingPage.jsx` — rerouted to proper endpoint
- `src/pages/UnifiedTradingPage.jsx` — rerouted to proper endpoint
- `src/pages/PositionsMonitorPage.jsx` — ticket badge on position cards
- `src/pages/positions-monitor.css` — ticket badge styling

## Architecture mapped (Phase 1)
8 code paths that can place MT5 orders identified. Legacy `POST /api/providers/mt5/order` was the primary bypass — now wired into traceability chain.

## Schema changes (Phase 2)
Trade model now has: ticket (Int?), sl (Float?), tp (Float?), magic (Int?), swap (Float?), brokerComment (String?). All nullable — non-breaking. Prisma client regenerated. `@@index([ticket])` added.

## Data capture (Phase 3)
Full chain: broker.placeOrder() → result with ticket → tradeRecorder.record() → Prisma Trade table. Automation loop + Mt5TradingService + legacy controller all pass MT5 fields.

## Remaining (Phases 4-6 → sub-issues #470, #471, #472)
Blocked by bridge order placement issue (documented in AGENT-ATTENTION.md). Positions readable, writes fail.
