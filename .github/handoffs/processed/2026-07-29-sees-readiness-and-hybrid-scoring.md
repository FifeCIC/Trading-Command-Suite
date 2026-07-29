# Handoff — 2026-07-29 — SEES Architecture: Readiness Tiers & Hybrid Scoring

## Summary

Multi-hour architectural discussion about quality control, honesty in scoring, and the gap between what the system claims to do vs what it actually does with real data. Resulted in a three-layer improvement plan captured as GitHub issues and policy documents.

## Key Decisions

1. **Readiness Tier System** (ALPHA → BRAVO → READY): Every component declares its readiness. Weakest-link rule enforced — one alpha directive poisons the entire chain upward. See `docs/readiness-tiers.md`.

2. **Capability Contracts**: Strategies refuse to activate when data requirements can't be met. PENDING state for "waiting for data" vs BLOCKED for "can never work." See `docs/readiness-tiers.md` § Pending State.

3. **Hybrid Base+Bonus Scoring**: Directives produce BASE (continuous, always changing) + BONUS (threshold-gated, creates ladder separation). Uncapped maxScores per directive, tunable per protocol. See `docs/sees-hybrid-scoring.md`.

## Files Created

| File | Purpose |
|------|---------|
| `docs/sees-hybrid-scoring.md` | Complete explanation of base+bonus scoring with examples |
| `docs/readiness-tiers.md` | Full readiness policy: tiers, weakest-link rule, enforcement, pending state, UI filters |
| `.github/issues/layer-a-readiness-tiers.md` | Issue body for #516 |
| `.github/issues/layer-b-capability-contracts.md` | Issue body for #517 |
| `.github/issues/layer-c-hybrid-scoring.md` | Issue body for #518 |

## Files Modified

| File | Change |
|------|--------|
| `src/data/strategy-library.js` | Updated status field docs to map to readiness tiers |

## GitHub Issues Created

| Issue | Title |
|-------|-------|
| [#516](https://github.com/FifeCIC/Trading-Command-Suite/issues/516) | Layer A: Directive Readiness Tiers — Stop the Pretending |
| [#517](https://github.com/FifeCIC/Trading-Command-Suite/issues/517) | Layer B: Capability Contracts & Activation Gates — Refuse to Pretend |
| [#518](https://github.com/FifeCIC/Trading-Command-Suite/issues/518) | Layer C: Hybrid Base+Bonus Scoring — Scores That Move With the Market |

## Preparation Issues (2026-07-29)

Before work begins on the three layers, 5 preparation tasks identified:

| Issue | Title |
|-------|-------|
| [#520](https://github.com/FifeCIC/Trading-Command-Suite/issues/520) | Prep #1: Audit all 104 directives for readiness classification |
| [#521](https://github.com/FifeCIC/Trading-Command-Suite/issues/521) | Prep #2: Add readiness field to IDirective interface |
| [#522](https://github.com/FifeCIC/Trading-Command-Suite/issues/522) | Prep #3: Fix seed_nature.sql — type column mismatch bug |
| [#523](https://github.com/FifeCIC/Trading-Command-Suite/issues/523) | Prep #4: Exclude ALPHA directives from scoring composite |
| [#524](https://github.com/FifeCIC/Trading-Command-Suite/issues/524) | Prep #5: Add /api/market-data/capabilities endpoint |

**Recommended execution order**: #520 (audit) → #521 (add field) → #522 (fix SQL) are independent and can run in sequence in one session. #523 (exclude from composite) depends on #521. #524 (capabilities endpoint) is independent.

## Related Prior Work

- `docs/sees-strategy-architecture.md` — SEES Strategy = Watchlist + Protocol (existing)
- `docs/sees-strategy-concept.md` — Live Ordering Stack concept (existing)
- `src/data/strategy-library.js` — Strategy definitions with 5-step wiring guide (added 2026-07-28)

## Next Steps (For Librarian)

- Link issues #516, #517, #518 as related/dependent
- Update Architecture Framework page with readiness tier concept
- Update QA Testing page to reference readiness tiers as testing priority queue
- Update Capability Map to show feature readiness as heatmap (green→red)

## Design Principles Established

1. **No pretending**: If a directive returns mock data, it must be VISIBLE to the user as mock.
2. **Weakest link**: Quality cascades upward. A protocol is only as ready as its least-ready directive.
3. **Scores must move**: Every tick of market data should produce a visible score change somewhere.
4. **Thresholds create separation**: Rare conditions get bonuses that push symbols up the ladder.
5. **Per-protocol tuning**: The same directive can have different weight in different protocols.
