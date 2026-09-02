# Strategy-owned protocol subscriptions — multi-protocol signal sources

A trading strategy should consume signals from multiple protocols. Approved design (2026-08-31): **strategy-owned subscriptions** via a join table — protocols stay shared signal sources; each strategy subscribes with a direction role.

## Part 1 — shipped (commit coming)

- [x] `strategy_protocol` table (strategyId, protocolId, role long|short|both, sortOrder) + Prisma `StrategyProtocol` model
- [x] Seeded from the legacy `protocolId`/`shortProtocolId` fields (one long row per strategy)
- [x] `GET /api/trading/strategies` now includes `protocols: [{ id, protocolId, role }]`
- [x] Trading Strategies sidebar shows "Protocols (signal sources)" list with direction chips

## Part 2 — loop consumes subscriptions

- [ ] Automation loop scores ALL subscribed protocols per strategy and takes the best actionable candidate per direction (reuse the best-of logic Signals v1 already has)
- [ ] Legacy `protocolId`/`shortProtocolId` become fallback-only, then deprecated
- [ ] Strategy Create/Edit UI: protocol multi-select with role tags
- [ ] Subscription CRUD endpoints (`POST/DELETE /api/trading/strategies/:id/protocols`)

## Acceptance

- [ ] A strategy subscribed to 3 protocols evaluates all 3 and trades the strongest actionable signal
- [ ] Sidebar/anywhere else in the app shows the same subscription list
- [ ] Removing a subscription stops that protocol feeding the strategy
