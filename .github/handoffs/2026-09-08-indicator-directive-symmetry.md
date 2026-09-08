---
date: 2026-09-08
area: scoring
type: bugfix
---

## What Changed

Fixed three registered directives flagged in the issue #731 audit (first directive-sweep batch):
- `stochastic` — clamped total to `maxScore` (was reaching 115/100) and added the missing
  symmetric overbought/bearish branch (was oversold/bullish-only despite a `neutral` bias).
- `vwap` — now emits `signalClass` (was always dropping to neutral, stripping its score from
  the Signal) and scores below-VWAP as a symmetric bearish signal (was a 25→10 "reduced long"
  floor). `directionBias` corrected to `neutral` (two-sided).
- `donchian-breakout` — channel now computed from PRIOR bars (was including the active candle,
  making the breakout branch unreachable) and emits symmetric bearish breakdown evidence.

Each carries a mirror test: an inverted price series produces the mirrored `signalClass` with
equal magnitude.

## Files Changed

- nest/src/modules/directives/implementations/stochastic.directive.ts — clamp + bearish symmetry; v2.1.0
- nest/src/modules/directives/implementations/vwap.directive.ts — signalClass + symmetric bearish; directionBias neutral; v1.2.0
- nest/src/modules/directives/implementations/mt5-indicators.directives.ts — Donchian prior-bar channel + symmetry; v1.1.0
- nest/src/modules/directives/implementations/indicator-symmetry.spec.ts — NEW mirror/regression tests

## Why (theory)

These are three instances of one root cause from the META.Stack correctness review: a
directive must emit evidence strength (score) separately from direction (signalClass), and
the two sides must be symmetric so a mirrored market produces a mirrored action. Mixing
"how far from VWAP" with "above = good" is what produced the dropped signalClass and the
25-point bearish floor; including the active candle in a channel is what made the breakout
condition unreachable. Fixing the contract once per directive (rather than special-casing
scores at aggregation) keeps the canonical evaluator correct.

## Capability Map Entry

- **name:** Symmetric indicator directives (stochastic / vwap / donchian)
- **persistence:** ephemeral
- **uiSurfaces:** 0
- **pipeline:** scoring
- **completion:** complete

## QA Test Entry

- **area:** Scoring / Directives
- **name:** Indicator side-symmetry mirror tests
- **procedure:** Run `npm --prefix nest test -- --runInBand indicator-symmetry.spec.ts`
- **expected:** 4 tests pass — mirrored price series → mirrored signalClass with equal magnitude; stochastic never exceeds maxScore

## Architecture Framework Entry

- **section:** directives
- **summary:** stochastic, vwap, and donchian-breakout now emit symmetric bullish/bearish evidence with signalClass set; donchian measures breakouts against prior bars. Covered by mirror tests. Files: stochastic.directive.ts, vwap.directive.ts, mt5-indicators.directives.ts.
