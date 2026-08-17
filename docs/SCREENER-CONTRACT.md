# Screener Contract — ScreenerHit + Watchlist Lifecycle

**Status:** Phase 2 — defined (schema + this doc). Ingestion and ranking are later phases.
**Related:** #645 (this contract), #646 (suitability filter), #647 (attention-weight ranking), #648 (news/earnings ingestion), #649 (promote-to-protocol handoff).

## Principle: attention ≠ conviction

SEES already has the right machinery — the dual-score model from #638 splits
**Opportunity** (screening/ranking) from **Signal** (timing). A screener is not a
new engine; it is a new *input surface* (catalysts) and a new *output destination*
(watchlist → protocol).

- The screener emits **attention**.
- Directional **conviction** happens later, after handover, via the existing scoring.

Consequences enforced by the contract:

1. **No market data** is required to create or filter a hit — a hit exists before any
   bars, quotes, or scores.
2. **No scores** live on a hit or watchlist item — attention weight is *computed* later
   and is always per-source.
3. **Source-agnostic** — news / earnings / social / email are pure adapters; the core
   shape below never changes.

## ScreenerHit — one normalised catalyst event

Prisma model: `ScreenerHit` (table `screener_hit`).

| Field | Type | Notes |
|-------|------|-------|
| `id` | UUID | primary key |
| `ticker` | varchar(20) | unresolved ticker (raw symbol string) |
| `symbolId` | varchar(36) \| null | resolved symbol FK — null until universe expansion |
| `source` | varchar(20) | enum: `news` \| `earnings` \| `social` \| `email` |
| `catalystType` | varchar(50) | free-form, e.g. `earnings-beat`, `news-mention`, `social-surge` |
| `catalystStrength` | float (0–100) | source-provided strength |
| `sourceReliability` | float (0–100) | per-source static weight, denormalised at ingest |
| `rawPayloadRef` | varchar(500) \| null | link/ref to the source payload for audit |
| `timestamp` | datetime | when the catalyst occurred |
| `createdAt` | datetime | when the hit was recorded |

A hit from **any** future source maps onto this shape with zero contract changes —
the source adapter fills `source`, `catalystType`, `catalystStrength`, and
`sourceReliability`; everything else is generic.

## Watchlist lifecycle

Prisma model: `WatchlistItem` (table `watchlist_item`). Distinct from the named
`Watchlist` list (which just holds `symbols`); a `WatchlistItem` is an individual
attention item that can belong to a list (`watchlistId`) or stand alone.

State machine:

```
new ──▶ watching ──▶ promoted ──▶ (done)
 │                      │
 └──────────────────────┴──▶ expired   (unused after N days — N TBD)
```

| Status | Meaning |
|--------|---------|
| `new` | surfaced by the screener, not yet reviewed |
| `watching` | accepted for monitoring |
| `promoted` | handed to a protocol's automation loop (`promotedTo` = protocol slug, `promotedAt` set) |
| `expired` | unused after N days (N TBD) |

Fields: `ticker`, `symbolId?`, `status`, `source?`, `screenerHitId?` (1:1 provenance
link), `promotedTo?`, `promotedAt?`, `expiresAt?`.

## Out of scope here (later phases)

- Suitability filter — #646 (static metadata join, no scoring).
- Attention-weight ranking — #647 (Phase 3, computed not stored).
- News/earnings ingestion adapters — #648 (Phase 3).
- Promote-to-protocol handoff — #649 (Phase 3).
- Social / Discord / email adapters — Phase 5.

## Storage

Tables are created idempotently at backend startup via `PrismaService.bootstrapSchema()`
(`CREATE TABLE IF NOT EXISTS`), matching the existing `scheduled_job` / `ab_test` pattern.
