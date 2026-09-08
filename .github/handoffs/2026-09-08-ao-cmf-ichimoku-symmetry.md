---
date: 2026-09-08
area: scoring
type: bugfix
---

## What Changed

Fixed the second directive-sweep batch from the issue #731 audit (all in
`mt5-indicators.directives.ts`):

- `awesome-oscillator` — replaced the inline AO computation (which read
  `fastSma[i] - slowSma[i]` — a 29-bar displacement misalignment, since the two
  SMA series are indexed to different bars) with the shared `awesomeOscillator`
  primitive, and added the missing symmetric bearish branches (was 75/70 bullish
  vs 10 bearish).
- `chaikin-mf` — replaced the inline loop (which summed `slice(i-period, i)`,
  excluding the current bar — an off-by-one candle index) with the shared
  `chaikinMoneyFlow` primitive, and made distribution symmetric (was 80/60
  bullish vs 10 bearish).
- `ichimoku-cloud` — applied the missing 26-bar forward displacement to the
  Senkou spans (the cloud was computed from the current bar, so "price above
  cloud" was meaningless); raised MIN to 78 bars and made below-cloud symmetric
  (was 65/80 bullish vs 10 bearish).

Each carries a mirror test: an inverted price series produces the mirrored
`signalClass` with equal magnitude.

## Files Changed

- nest/src/modules/directives/implementations/mt5-indicators.directives.ts — AO + CMF + Ichimoku fixes; AO/CMF now use shared primitives; all three symmetric; v1.1.0 each
- nest/src/modules/directives/implementations/indicator-symmetry.spec.ts — NEW mirror tests for AO/CMF/Ichimoku
- nest/src/modules/directives/implementations/stop-directives.spec.ts — corrected mirrorBars helper (high/low must swap on inversion)

## Why (theory)

Three more instances of the same root cause: indicator math must be aligned to
the correct bar index (fast vs slow SMA, current-bar inclusion, forward
displacement) and direction must be symmetric. The inline AO/CMF code duplicated
logic that already existed (incorrectly) in the shared primitives — using the
shared primitives removes the drift. The mirror test helper itself had to swap
high/low on inversion, otherwise it produced inverted candles that sign-sensitive
formulas (CMF) misread.

## Capability Map Entry

- **name:** Symmetric indicator directives (awesome-oscillator / chaikin-mf / ichimoku-cloud)
- **persistence:** ephemeral
- **uiSurfaces:** 0
- **pipeline:** scoring
- **completion:** complete

## QA Test Entry

- **area:** Scoring / Directives
- **name:** Indicator side-symmetry mirror tests (AO / CMF / Ichimoku)
- **procedure:** Run `npm --prefix nest test -- --runInBand indicator-symmetry.spec.ts`
- **expected:** 7 tests pass — mirrored series → mirrored signalClass with equal magnitude; AO uses aligned fast/slow SMA; CMF includes current bar; Ichimoku cloud is displaced

## Architecture Framework Entry

- **section:** directives
- **summary:** awesome-oscillator, chaikin-mf, and ichimoku-cloud now use aligned indicator math (shared primitives for AO/CMF, 26-bar displaced cloud for Ichimoku) and emit symmetric bullish/bearish evidence. Covered by mirror tests. File: mt5-indicators.directives.ts.
