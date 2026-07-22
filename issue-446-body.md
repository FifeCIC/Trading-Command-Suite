## Scope
End-to-end audit of the **trade execution pipeline** ├ö├ç├Â from META.Stack scoring ├ö├Ñ├å strategy decision ├ö├Ñ├å broker order ├ö├Ñ├å database record ├ö├Ñ├å position monitoring. The goal is to establish a single, verifiable pathway where every trade is traceable back to a scoring run, a strategy decision, a protocol, and a directive breakdown.

## Current State (Broken)

### Two separate pipelines exist:

**Pipeline A ├ö├ç├Â Legacy / Direct MT5:**
- Positions are placed on MT5 (visible via bridge `/positions`)
- Comments like `"TCS TEST - AUDUSD Trading 18"` suggest TCS placed them
- But no Trade/Position/Order record exists in the database
- These trades are untraceable ├ö├ç├Â no scoring data, no strategy ID, no directive breakdown linked

**Pipeline B ├ö├ç├Â META.Stack Automation Loop:**
- Scores symbols every 2 minutes via protocol directives
- Produces SCORED/SKIP decisions (currently NOT executing ├ö├ç├Â all skip due to risk config)
- Has `placeOrder()` code that calls `tradeRecorder.record()` ├ö├ç├Â but this recorder:
  - Doesn't store the MT5 ticket
  - Doesn't store stop-loss or take-profit prices
  - Sets PnL to 0 (no mark-to-market tracking)
  - Has never successfully recorded a trade (0 rows in Trade table)

### Specific gaps identified:

| # | Gap | Impact |
|---|-----|--------|
| 1 | `Trade` model missing `ticket` field | Cannot reconcile DB with MT5 positions |
| 2 | `Trade` model missing `sl`/`tp` fields | Cannot verify risk management |
| 3 | `Position` model missing `ticket` field | Cannot match DB position to broker |
| 4 | `tradeRecorder.record()` doesn't pass ticket/sl/tp | Lost at point of creation |
| 5 | MT5 returns other fields (magic, swap, openTime, comment) ├ö├ç├Â none stored | Lost broker metadata |
| 6 | No foreign key from Trade ├ö├Ñ├å ScoringStrategy | Cannot trace trade back to scoring decision |
| 7 | No link from Trade ├ö├Ñ├å Score records or directive breakdown | Cannot analyze which directives drove the trade |
| 8 | Audit log (`auditLog.logOrderResult`) is in-memory only | Lost on restart |
| 9 | Current MT5 positions have no DB counterpart | Portfolio page shows Trading212 data, not MT5 |
| 10 | Legacy pathway may still place orders outside automation loop | Phantom trades |

## Testing Plan

After the current sprint, conduct a step-by-step walkthrough of the entire trade lifecycle:

### Phase 1: Architecture Review
- [x] Map all code paths that can place an MT5 order (grep for `placeOrder`, `bridgePost`, `sendOrder`)
- [x] Identify if any legacy/direct order placement exists outside `automation-loop.service.ts`
- [x] Reference applicable diagrams: META.Stack architecture, Automation Loop flow, Protocol ÔåÆ Strategy ÔåÆ Broker chain
- [x] Document the intended single pathway

### Phase 2: Database Schema
- [x] Add `ticket` (Int), `sl` (Float), `tp` (Float), `magic` (Int), `swap` (Float), `brokerComment` (String) to Trade model
- [x] Add `ticket` to Position model (already has ticket field)
- [x] Add FK from Trade ÔåÆ ScoringStrategy (scoringStrategyId exists, now populated by automation loop)
- [x] Ensure Trade can link back to Score records (via timestamp + strategyId + symbol)
- [x] Run Prisma migration ÔåÆ deferred to #472 (nullable columns, non-breaking)

### Phase 3: Data Capture
- [x] Update `tradeRecorder.record()` to pass all MT5 fields
- [x] Persist audit log to DB (decision_log + automation_event tables capture decisions per tick)
- [ ] On automation loop startup, sync existing MT5 positions into Trade/Position tables (BLOCKED: MT5 bridge not operational → #472)
- [ ] Store directive breakdown alongside trade record (not yet implemented → #472)

### Phase 4: UI Verification — BLOCKED (MT5 bridge not operational) → #470
- [ ] Verify `/trading/positions` shows MT5 positions with ticket, SL, TP, PnL
- [ ] Verify `/trading/trade-history` shows closed trades with entry/exit prices
- [ ] Verify each trade row links to its scoring run and strategy
- [ ] Verify `/scoring/scoring-runs` can be filtered to show trades from that run
- [ ] Verify portfolio P&L matches MT5 account P&L

### Phase 5: End-to-End Test ÔåÆ TRACKED IN #471
- [ ] Configure one strategy with proper SL/TP/risk settings
- [ ] Let automation loop score and execute
- [ ] Verify: Score record exists → Decision log shows EXECUTED → Trade record exists with ticket → MT5 position matches → Portfolio reflects position
- [ ] Close position manually → Verify Trade record updates with exitPrice and PnL
- [ ] Repeat for BUY and SELL

### Phase 6: Cleanup — partially done, remainder → #472
- [x] Remove or deprecate any legacy order pathways found in Phase 1 (legacy `POST /api/providers/mt5/order` now has @deprecated; frontend pages rerouted to `/api/trading/mt5/order`)
- [ ] Ensure only META.Stack automation loop places orders (needs bridge verification → #472)
- [ ] Remove any references to "Bot Rules" pathways that bypass scoring (→ #472)

## Success Criteria
- Every open MT5 position has a corresponding Trade record with ticket
- Every Trade record links to a ScoringStrategy and can be traced to a scoring run
- Portfolio page shows MT5 positions (not just Trading212)
- Closing a position updates the Trade record with exit price and realized PnL
- No phantom trades ├ö├ç├Â every order is traceable end-to-end

## Estimated Sub-Issues
~50 issues across schema, backend, frontend, and testing phases.


