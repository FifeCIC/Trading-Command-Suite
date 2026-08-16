## Context

From the screener design discussion (2026-08-16). The first catalyst sources are **news** and **earnings**. These are the natural home for the two mock stubs flagged in #626 (`news-sentiment-positive`, `earnings-proximity`).

Rather than delete them, **rehome them as catalyst directives** — attention signals that feed the screener, not scoring signals inside active protocols. The #626 rule still holds: they must never ship as constant mocks.

## Goal

Wire real news + earnings feeds into the screener, emitting `ScreenerHit`s.

## Scope

- News adapter + earnings adapter following the existing `IProviderAdapter` pattern.
- Map each feed into `ScreenerHit` with `source = news | earnings`.
- Rehome `news-sentiment-positive` and `earnings-proximity` as the first catalyst directives (emit catalyst strength, not a directional score).
- Remove them from any active scoring protocol group (they must not add constant points — see #638's no-constant-floors rule).

## Out of scope

- Suitability filter / attention rank (already separate issues).
- Promote-to-protocol handoff (separate Phase 3 issue).
- Social / Discord / email (Phase 5).

## Acceptance criteria

- News and earnings events produce `ScreenerHit`s from real data.
- No directive returns a constant mock score in an active protocol.
- `news-sentiment-positive` / `earnings-proximity` no longer contribute to protocol composites.
- Each hit carries a `rawPayloadRef` so "why did this surface?" is auditable.

## Dependencies

- #626 (current stubs), #638 (no constant floors).
- Phase 2 ScreenerHit contract.
