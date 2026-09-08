---
date: 2026-09-08
area: scoring
type: bugfix
---

## What Changed

Settled the raw-composite-vs-percentage classification bug (#738/#734). Server-side code no longer thresholds the unbounded raw composite score against 0-100 cutoffs — only the normalized 0-100 percentage (`normalizedScore`) or the server-owned signal is classified.

## Files Changed

- nest/src/modules/scheduler/trading-scheduler.service.ts — `generateSuggestions` now classifies on `r.normalizedScore` (0-100 %) instead of raw `r.score`; the suggestion `score` field also shows the percentage
- nest/src/modules/scoring/score-history.service.ts — `getRecentlyAnalysed` derives the entry/watch/defensive tier from `breakdown.signal` (server-owned BUY/SELL/HOLD) instead of thresholding raw `Score.value`

## Why (theory)

`rankAll()` and `SignalEnvelopeService` both produce an **unbounded raw composite** (`score` / `Score.value` — hundreds to thousands as the directive registry grows) alongside a **0-100 percentage** (`normalizedScore` / `signalPct`). Any threshold expressed on a 0-100 scale (65/40, 80/65, 60/40) must compare the percentage, never the raw sum. Thresholding the raw sum saturates every symbol to the top tier (e.g. ~100% "buy/strong" on a losing book). The rule is now encoded in a repo memory note and inline comments so it does not recur.

## Capability Map Entry

- **name:** Raw-vs-normalized score classification
- **persistence:** ephemeral
- **uiSurfaces:** 2
- **pipeline:** scoring
- **completion:** complete

## QA Test Entry

- **area:** Scoring
- **name:** Portfolio/suggestions no longer saturate to buy/strong
- **procedure:** Open the portfolio scores view and the scheduler suggestions; confirm no holding reads "buy/strong" purely from a large raw composite.
- **expected:** Holdings classify on the 0-100 percentage (e.g. a raw 4028/10000 ≈ 40% reads hold, not strong-buy); suggestions show TOP/WATCH/LOW from the percentage.

## Architecture Framework Entry

- **section:** directives
- **summary:** Raw composite (`score`/`Score.value`) is unbounded and display-only; classification against 0-100 thresholds uses `normalizedScore` or the server-owned signal. Fixed in trading-scheduler (generateSuggestions) and score-history (getRecentlyAnalysed). Deeper #734 (route portfolio/schedulers through ProtocolGatingService) remains open.
