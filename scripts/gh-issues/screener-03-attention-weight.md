## Context

From the screener design discussion (2026-08-16). Suitability is a **filter** (does it fit any protocol?); attention weight is the **rank** (which hits deserve a look first). The rank must be computable from the catalyst event alone — **no market data, no directives**.

## Goal

Rank watchlist candidates by a lightweight attention weight so the watchlist is an ordered queue, not a flat pile.

## Scope

- `attentionWeight = f(catalystStrength, sourceReliability, recency)`:
  - catalyst strength (news impact, earnings surprise magnitude)
  - source reliability (earnings calendar > news wire > social)
  - recency (a 6-hour-old catalyst outranks a 6-day-old one)
- All inputs come from the `ScreenerHit` itself.
- Explicitly **does not** use the Opportunity score here — Opportunity moves downstream to the promote-to-protocol handoff.

## Out of scope

- Suitability filter (Phase 2).
- Ingestion (Phase 3).
- Promotion / handoff (Phase 3).
- Social / email sources (Phase 5) — but the weight function must be source-agnostic so they slot in unchanged.

## Acceptance criteria

- Watchlist renders as a ranked list driven by attention weight.
- Changing the weight formula does not touch scoring or directive code.
- No market data is fetched to compute the rank.

## Dependencies

- Phase 2 ScreenerHit contract (source-agnostic `source` + `sourceReliability` fields).
