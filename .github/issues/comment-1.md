## META.Stack Context Update (2026-07-17)

This issue was created before the META.Stack architecture was fully implemented. The system has evolved significantly — please read this before implementing.

### What Already Exists

The META.Stack pipeline (epic #398, now closed) provides a layered architecture:

```
Scoring Strategy Layer → Trading Strategy Layer → Execution
```

Existing APIs that serve this issue's AC:
- **GET /api/trading/strategies** — fetches all trading strategies with status, type, baseSize, stopLoss/takeProfit
- **GET /api/trading/strategy-comparison** — compares strategies by actual trade outcomes
- **GET /api/scoring/metastacks/ratings** — META.Stack rating data
- **GET /api/trading/strategy-comparison** — win rate, P&L, avg win/loss per strategy

Existing pages:
- **Trading Strategies** page at /trading/trading-strategies — lists all strategies with status, P&L, positions
- **Strategy Comparison** at /automation/strategies-compare — showdown table + live position cards
- **Multi-Strategy Compare** in the nav tree

### Implementation Guidance

When building this, **do NOT**:
- Create a new Zustand store for strategies (the data comes from APIs, not local state)
- Create new API endpoints for strategy metrics (use existing ones above)
- Build a standalone data pipeline (use the META.Stack scoring → execution pipeline)

**DO**:
- Build a pure UI component that queries existing APIs
- Use TanStack Query (already configured) for caching/polling
- Render strategy cards from GET /api/trading/strategies data
- Add strategy-by-strategy P&L from GET /api/trading/strategy-comparison
- If real-time updates are needed, poll existing endpoints (the automation loop already ticks every ~417ms)

### Notes
- "Status indicator" — strategies have status fields (auto/semi/manual) via the strategy model
- "Run duration" — strategies have createdAt/updatedAt timestamps
- "P/L" — available from strategy-comparison endpoint
- "Active trade count" — available from positions endpoints, cross-referenced by symbol

The existing Trading Strategies page (created in Sprint 2026-07-14) already shows much of this data. This issue should be scoped as a **dashboard/widget view** of the existing data, not a new data pipeline.
