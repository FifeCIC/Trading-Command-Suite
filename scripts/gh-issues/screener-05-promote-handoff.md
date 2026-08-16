## Context

From the screener design discussion (2026-08-16). The final step of the pipeline: once a watchlist symbol **earns market data**, decide whether to promote it into a protocol's automation loop.

Opportunity score's job here is **"prioritize the watchlist," not "gate entry to it."** Suitability already gated entry (Phase 2). Opportunity now ranks candidates for promotion.

## Goal

Hand a suitable, high-attention watchlist symbol over to a protocol — deterministically and auditably.

## Scope

- For each watchlist symbol with fresh market data, run each active protocol's **Opportunity** score.
- Promote when: suitability passes AND Opportunity ≥ protocol threshold.
- Record the promotion decision (which protocol, which score, why) for audit.
- After promotion, the existing **Signal** score drives BUY/HOLD/SELL — the screener's job ends at promotion.

## Out of scope

- Suitability filter (Phase 2).
- Attention ranking (Phase 3).
- Signal / execution logic (already exists).
- Social / email sources (Phase 5).

## Acceptance criteria

- A watchlist symbol with no market data is never promoted (screener is pre-data).
- Promotion is scored and recorded, not manual.
- The automation loop consumes promoted symbols without new bespoke logic.
- "Unused after N days → expired" lifecycle is enforced.

## Dependencies

- Phase 2 watchlist lifecycle (`promoted`, `expired` states).
- Existing Opportunity score (#638).
