## Context

From the screener design discussion (2026-08-16). SEES already has the right machinery — the dual-score model from #638 splits **Opportunity** (screening/ranking) from **Signal** (timing). A stock screener is not a new engine; it is a new *input surface* (catalysts: news, earnings, social, email) and a new *output destination* (watchlist → protocol).

Core principle: **attention ≠ conviction**. The screener emits *attention*. Directional conviction happens later, after handover, via the existing scoring.

## Goal

Define the data contract and entities for a "screener hit" and the watchlist lifecycle — **source-agnostic from day one** so news / earnings / social / email are pure adapters later, with zero changes to filter, rank, or handoff logic.

## Scope

- **`ScreenerHit`** — one normalised catalyst event:
  - `ticker` (unresolved) + resolved `symbolId` (may be null until universe expansion)
  - `source` (enum: `news | earnings | social | email`)
  - `catalystType`, `catalystStrength` (0–100)
  - `sourceReliability` (per-source static weight)
  - `rawPayloadRef` (link to source payload for audit)
  - `timestamp`
- **Watchlist entity** with lifecycle: `new → watching → promoted → expired`.
  - `promoted` = handed to a protocol's automation loop (see the Phase 3 promote-to-protocol issue).
  - `expired` = unused after N days (TBD).
- **Attention weight** is *computed*, not stored, and is always per-source — the contract must not bake in any single source's assumptions.

## Out of scope

- Suitability filter (separate Phase 2 issue).
- Attention-weight ranking (Phase 3).
- News / earnings ingestion (Phase 3).
- Promote-to-protocol handoff (Phase 3).
- Social / Discord / email adapters (Phase 5).

## Acceptance criteria

- `ScreenerHit` and watchlist lifecycle are defined (Prisma schema + contract doc).
- A hit from any future source maps onto the same shape without contract changes.
- No market data is required to create or filter a hit (attention is pre-data).
- No constant / mock scores anywhere in the path.

## Dependencies

- Builds on the Opportunity/Signal split from #638.
- Rehomes the #626 stubs as catalyst signals (see the Phase 3 ingestion issue).
