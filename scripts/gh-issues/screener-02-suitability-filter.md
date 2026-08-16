## Context

From the screener design discussion (2026-08-16). The handover gate into a watchlist is **suitability only** — a cheap, static, structural check. It must NOT run the Opportunity score: Opportunity is conviction-adjacent and requires market data, which a freshly-surfaced symbol does not yet have.

## Goal

A suitability filter that answers one question: **"does this symbol structurally fit any protocol?"**

## Scope

- Join screener hits against existing protocol metadata only:
  - `directionMode` (LONG_ONLY / SHORT_ONLY / BOTH)
  - `symbolType` (stock / crypto / forex)
  - `intendedTimeframe`
  - asset class / liquidity tier (where derivable from metadata)
- Pure function — no directive evaluation, no market data, no bars.
- Output: the set of protocols each hit structurally fits.

## Out of scope

- Ranking hits (Phase 3 attention-weight).
- Running any scoring engine.
- Promoting to a protocol (Phase 3 handoff).

## Acceptance criteria

- Suitability can be evaluated for a symbol with zero market data.
- Filter uses only protocol/symbol metadata; no directive runs.
- Direction-mismatched symbols are excluded (e.g. a SHORT-only protocol rejects a symbol with no short suitability).

## Dependencies

- Phase 2 ScreenerHit contract + watchlist entity.
- Protocol metadata (`directionMode`, `symbolType`, `intendedTimeframe`) already exists — no schema change expected.
