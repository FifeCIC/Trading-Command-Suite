## Scope
End-to-end audit of the **trade execution pipeline** Ôö£├ÂÔö£├ºÔö£├é from META.Stack scoring Ôö£├ÂÔö£├æÔö£├Ñ strategy decision Ôö£├ÂÔö£├æÔö£├Ñ broker order Ôö£├ÂÔö£├æÔö£├Ñ database record Ôö£├ÂÔö£├æÔö£├Ñ position monitoring. The goal is to establish a single, verifiable pathway where every trade is traceable back to a scoring run, a strategy decision, a protocol, and a directive breakdown.

## Current State (Broken)

### Two separate pipelines exist:

**Pipeline A Ôö£├ÂÔö£├ºÔö£├é Legacy / Direct MT5:**
- Positions are placed on MT5 (visible via bridge `/positions`)
- Comments like `"TCS TEST - AUDUSD Trading 18"` suggest TCS placed them
- But no Trade/Position/Order record exists in the database
- These trades are untraceable Ôö£├ÂÔö£├ºÔö£├é no scoring data, no strategy ID, no directive breakdown linked

**Pipeline B Ôö£├ÂÔö£├ºÔö£├é META.Stack Automation Loop:**
- Scores symbols every 2 minutes via protocol directives
- Produces SCORED/SKIP decisions (currently NOT executing Ôö£├ÂÔö£├ºÔö£├é all skip due to risk config)
- Has `placeOrder()` code that calls `tradeRecorder.record()` Ôö£├ÂÔö£├ºÔö£├é but this recorder:
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
| 5 | MT5 returns other fields (magic, swap, openTime, comment) Ôö£├ÂÔö£├ºÔö£├é none stored | Lost broker metadata |
| 6 | No foreign key from Trade Ôö£├ÂÔö£├æÔö£├Ñ ScoringStrategy | Cannot trace trade back to scoring decision |
| 7 | No link from Trade Ôö£├ÂÔö£├æÔö£├Ñ Score records or directive breakdown | Cannot analyze which directives drove the trade |
| 8 | Audit log (`auditLog.logOrderResult`) is in-memory only | Lost on restart |
| 9 | Current MT5 positions have no DB counterpart | Portfolio page shows Trading212 data, not MT5 |
| 10 | Legacy pathway may still place orders outside automation loop | Phantom trades |

## Testing Plan

After the current sprint, conduct a step-by-step walkthrough of the entire trade lifecycle:

### Phase 1: Architecture Review
- [x] Map all code paths that can place an MT5 order (grep for `placeOrder`, `bridgePost`, `sendOrder`)
- [x] Identify if any legacy/direct order placement exists outside `automation-loop.service.ts`
- [x] Reference applicable diagrams: META.Stack architecture, Automation Loop flow, Protocol ├ö├Ñ├å Strategy ├ö├Ñ├å Broker chain
- [x] Document the intended single pathway

### Phase 2: Database Schema
- [x] Add `ticket` (Int), `sl` (Float), `tp` (Float), `magic` (Int), `swap` (Float), `brokerComment` (String) to Trade model
- [x] Add `ticket` to Position model (already has ticket field)
- [x] Add FK from Trade ├ö├Ñ├å ScoringStrategy (scoringStrategyId exists, now populated by automation loop)
- [x] Ensure Trade can link back to Score records (via timestamp + strategyId + symbol)
- [x] Run Prisma migration ├ö├Ñ├å deferred to #472 (nullable columns, non-breaking)

### Phase 3: Data Capture
- [x] Update `tradeRecorder.record()` to pass all MT5 fields
- [x] Persist audit log to DB (decision_log + automation_event tables capture decisions per tick)
- [ ] On automation loop startup, sync existing MT5 positions into Trade/Position tables (BLOCKED: MT5 bridge not operational ÔåÆ #472)
- [ ] Store directive breakdown alongside trade record (not yet implemented ÔåÆ #472)

### Phase 4: UI Verification — 1 done, 4 blocked (bridge order placement broken → #470)
- [x] Verify `/trading/positions` shows MT5 positions with ticket, SL, TP, PnL — confirmed: 5 MT5 positions render with SL/TP/PnL, ticket badge added to card display
- [ ] Verify `/trading/trade-history` shows closed trades with entry/exit prices (BLOCKED: 0 trade records — order placement fails, so no trades exist to verify)
- [ ] Verify each trade row links to its scoring run and strategy (BLOCKED: no trade records)
- [ ] Verify `/scoring/scoring-runs` can be filtered to show trades from that run (BLOCKED: no trade records)
- [ ] Verify portfolio P&L matches MT5 account P&L (BLOCKED: portfolio returns T212 only, MT5 positions not aggregated)

### Phase 5: End-to-End Test ├ö├Ñ├å TRACKED IN #471
- [ ] Configure one strategy with proper SL/TP/risk settings
- [ ] Let automation loop score and execute
- [ ] Verify: Score record exists ÔåÆ Decision log shows EXECUTED ÔåÆ Trade record exists with ticket ÔåÆ MT5 position matches ÔåÆ Portfolio reflects position
- [ ] Close position manually ÔåÆ Verify Trade record updates with exitPrice and PnL
- [ ] Repeat for BUY and SELL

### Phase 6: Cleanup — 1 done, 2 need verification → #472
- [x] Remove or deprecate any legacy order pathways (legacy POST /api/providers/mt5/order now @deprecated; frontend rerouted to /api/trading/mt5/order)
- [ ] Ensure only META.Stack automation loop places orders (needs bridge order fix first → #472)
- [ ] Remove any references to "Bot Rules" pathways that bypass scoring (ÔåÆ #472)

## Success Criteria
- Every open MT5 position has a corresponding Trade record with ticket
- Every Trade record links to a ScoringStrategy and can be traced to a scoring run
- Portfolio page shows MT5 positions (not just Trading212)
- Closing a position updates the Trade record with exit price and realized PnL
- No phantom trades Ôö£├ÂÔö£├ºÔö£├é every order is traceable end-to-end

## Estimated Sub-Issues
~50 issues across schema, backend, frontend, and testing phases.



