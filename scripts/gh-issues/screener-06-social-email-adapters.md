## Context

From the screener design discussion (2026-08-16). Social media, Discord, and email are additional **alertness** sources — bringing symbols to attention because others are giving them attention. They are deliberately deferred to Phase 5 and must be **thin adapters** with zero changes to filter / rank / handoff.

## Goal

Add social / Discord / email as catalyst sources emitting `ScreenerHit`s.

## Scope

- One adapter per source, following the `IProviderAdapter` pattern, emitting `source = social | email`.
- Rate limiting and dedup (the same catalyst across multiple channels → one hit).
- Audit trail: every hit carries `rawPayloadRef` and a "why did this surface?" reason.
- No changes to suitability filter, attention rank, or promotion handoff.

## Out of scope

- The Phase 2/3 pipeline (already built).
- Treating social volume as directional conviction — it is attention only.

## Acceptance criteria

- Social / Discord / email events produce `ScreenerHit`s on the same contract.
- Duplicate catalysts across channels are deduplicated.
- No modification to filter / rank / handoff logic was required to add these sources.
- Each surfaced hit is auditable.

## Dependencies

- Phase 2 ScreenerHit contract (source-agnostic).
- Phase 3 ingestion pattern (news / earnings adapters as the template).
