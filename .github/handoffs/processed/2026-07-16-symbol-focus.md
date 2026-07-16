# Handoff — 2026-07-16 Session 3 (Symbol Focus Page)

## Completed: Single-Symbol Focus Page

### What was built
A new standalone page at `/symbol/:ticker` that shows the **full trading pipeline** for one ticker:

**Backend** (`GET /api/symbols/:ticker/focus`):
- Aggregates protocols, scoring strategies, trading strategies, recent decisions (decision_log), and trade outcomes (strategy_evaluation)
- Resolves watchlist JSON files to determine which scoring strategies include the symbol
- Returns protocol metadata from PROTOCOL_REGISTRY
- Only shows data if the symbol is included in active protocols/strategies

**Frontend** (`SymbolFocusPage.jsx`):
- Two-column layout: left = protocols + scoring strategies + trading strategies, right = live activity + trade outcomes
- 10-second polling for live updates with pulse indicator
- Each strategy shows mode badge (AUTO/SEMI/MANUAL), protocol, broker, thresholds
- Trading strategies show SL/TP, timeframe, base size
- Decision log shows color-coded decisions (SCORED/EXECUTED/FAILED/BLOCKED) with tick numbers
- Strategy evaluations show signals, rarity bands, trade tickets
- "Not scored" banner when symbol isn't in any active protocol

### Files Changed
```
nest/src/modules/symbols/symbols.service.ts    — getFocus() method
nest/src/modules/symbols/symbols.controller.ts — GET :ticker/focus endpoint
src/pages/SymbolFocusPage.jsx                  — NEW page component
src/pages/symbol-focus.css                     — NEW styles
src/App.jsx                                    — import + route
```

### Route
`/symbol/EURUSD` → SymbolFocusPage (standalone, no AppShell)

### Verified
- Backend endpoint returns live data for EURUSD: 3 protocols, 1 scoring strategy, 4+ trading strategies
- NestJS build: ✅
- Frontend build: ✅ (2870 modules, 94 entries estimated)
