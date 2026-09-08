---
date: 2026-09-08
area: risk
type: bugfix
---

## What Changed

Fixed Stop Guardian position-side asymmetry: it averaged raw, long-biased stop-directive
scores (including Chandelier Exit) into one "confidence" for both BUY and SELL positions,
so a strong downtrend artificially suppressed stop adjustments on shorts. The three stop
directives now emit symmetric bullish/bearish evidence and the guardian aggregates
side-aligned directional evidence (bullish helps BUY, bearish helps SELL; opposing evidence
reduces confidence; missing/neutral directives are "no evidence", never a neutral 50).

## Files Changed

- nest/src/modules/automation/stop-guardian.service.ts — side-aware confidence aggregation (replaces raw-average + 55% threshold on mixed units)
- nest/src/modules/directives/implementations/chandelier-exit.directive.ts — added symmetric short exit (long stop + short stop); v1.2.0
- nest/src/modules/directives/implementations/mt5-indicators.directives.ts — SuperTrend + ATR Trailing Stop now symmetric (mirrored bullish/bearish branches); both v1.1.0
- nest/src/modules/directives/implementations/stop-directives.spec.ts — NEW mirror tests (mirrored series → mirrored signalClass, equal magnitude)
- nest/src/modules/automation/stop-guardian.service.spec.ts — NEW side-aware confidence test (bullish evidence → BUY 78, SELL 0)

## Why (theory)

A trailing-stop manager must ask "is the trend moving in THIS position's favour?" — not
"how bullish is the market?". Feeding long-only evidence into both sides inverted the
short-side answer: a healthy short (falling price) produced bearish, low-magnitude stop
signals, while a losing short (rising price) produced high bullish "confidence". This is
the same "direction vs magnitude" contract the META.Stack correctness review (MST-002)
requires: a directive emits evidence strength (score) plus explicit direction
(signalClass), and the consumer nets them by side. Not tracked in the MST ledger as a
separate finding — added as MST-012.

## Capability Map Entry

- **name:** Stop Guardian side-symmetric stop confidence
- **persistence:** ephemeral
- **uiSurfaces:** 0
- **pipeline:** trading
- **completion:** complete

## QA Test Entry

- **area:** Risk / Stop Guardian
- **name:** Side-symmetric stop confidence
- **procedure:** Run `npm --prefix nest test -- --runInBand stop-directives.spec.ts stop-guardian.service.spec.ts`
- **expected:** 5 tests pass, including mirror tests (mirrored price series → mirrored signalClass with equal score) and side-aware confidence (bullish evidence → BUY 78, SELL 0)

## Architecture Framework Entry

- **section:** risk
- **summary:** Stop Guardian now computes side-aware stop confidence — only directional evidence aligned with the position side (bullish for BUY, bearish for SELL) counts; opposing evidence reduces it; missing/neutral directives are treated as no evidence. Stop directives (chandelier-exit, atr-trailing-stop, supertrend) emit symmetric bullish/bearish branches. Files: stop-guardian.service.ts, chandelier-exit.directive.ts, mt5-indicators.directives.ts.
