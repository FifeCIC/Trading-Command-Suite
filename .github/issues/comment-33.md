## META.Stack Context Update (2026-07-17)

This issue remains valid in concept, but should align with existing architecture.

### What Already Exists
- **MT5 Bridge** (scripts/mt5-bridge/mt5_bridge_v2.py, port 5000) — can fetch symbol info including swap rates via GET /symbol/:name/info
- **MarketContext service** — already has session-aware logic and swap charge awareness (the Market Context Live Checklist verifies swap charges against live data)
- **Position monitoring** — positions endpoint exposes swap data from MT5
- **Per-Broker P&L Dashboard** — shows MT5, Trading212, and ISA individually with Balance, Equity, Positions, P&L

### Implementation Guidance
- This should be a service within the existing **trading module** in NestJS, not a standalone tool
- MT5 bridge already provides swap data — read from there rather than a new integration
- The swap-to-profit ratio is a calculation that could live in the existing **Risk Service** or a new TradingService sub-module
- Trading212 swap data gap still exists (as noted in the issue) — the adapter would need extending when their API supports it
- For the frontend, consider an enhancement to the **Calculators** page (which already has Position Size, Profit/Loss, Risk/Reward calculators)
- The swap calendar (triple-swap aware) is calendar logic — the existing TimezoneService can provide session/day awareness
