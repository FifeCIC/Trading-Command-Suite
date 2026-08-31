---
date: 2026-08-31
area: trading
type: feature
---

## What Changed

Strategy-owned protocol subscriptions (Part 1 of #712) — the data foundation for one trading strategy consuming signals from multiple protocols:

- New `strategy_protocol` table (strategyId, protocolId, role `long|short|both`, sortOrder) + Prisma `StrategyProtocol` model with cascade relation from `TradingStrategy.protocols`.
- Seeded from the legacy `protocolId`/`shortProtocolId` fields (one `long` row per strategy; `short` rows where a shortProtocolId existed).
- `GET /api/trading/strategies` now returns `protocols: [{ id, protocolId, role }]` per strategy.
- Trading Strategies sidebar (`/trading/trading-strategies`) shows a **"Protocols (signal sources)"** list with direction chips; falls back to the legacy fields when no subscription rows exist. Also removed a duplicate "Protocol" section in the sidebar.

## Files Changed

- `nest/prisma/schema.prisma` — StrategyProtocol model; stale DEPRECATED comments on TradingStrategy corrected (canonical since 2026-08-27).
- `nest/src/modules/trading/trading-strategy.service.ts` — findAll includes + maps subscriptions.
- `src/pages/TradingStrategiesPage.jsx`, `src/pages/trading-strategies.css` — sidebar list.

## Capability Map Entry

- **name:** Strategy protocol subscriptions (multi-protocol signal sources)
- **persistence:** stored
- **uiSurfaces:** 1 (Trading Strategies sidebar)
- **pipeline:** trading
- **completion:** partial (Part 2 — loop consumption — pending, #712)

## QA Test Entry

- **area:** Trading
- **name:** Sidebar shows the strategy's protocol subscriptions
- **procedure:** Open /trading/trading-strategies → click any strategy row → sidebar lists protocols with role chips.
- **expected:** Each strategy shows its signal sources (seeded from legacy fields); subscription data matches the strategy_protocol table.

## Architecture Framework Entry

- **section:** routes
- **summary:** New table `strategy_protocol` (TradingStrategy 1─n StrategyProtocol n─1 Protocol). List API now exposes `protocols[]` per strategy. Loop still consumes legacy protocolId/shortProtocolId until Part 2 (#712).
