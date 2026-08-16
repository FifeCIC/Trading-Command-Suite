---
date: 2026-08-16
area: scoring
type: docs
---

## What Changed

Designed the timeframe → directive-importance matrix that differentiates the five GOLD protocols (`xau-speed-v1` / `-m5` / `-m15` / `-1h` / `-4h`). Each of the 12 shared directives now has a per-band rank (H/M/L/drop), a per-band maxScore, RSI threshold deltas, and a risk-gate multiplier band. Produced a concrete per-protocol payload (`directiveMaxScores` + drop list + thresholds + riskGate) for the per-protocol config UI (#609).

## Files Changed

- `G:\My Drive\...\docs\theories\timeframe-directive-importance-matrix.md` — canonical design doc: matrix table, per-directive rationale, concrete per-protocol JSON payload, validation plan

## Capability Map Entry

- **name:** Timeframe → directive-importance matrix (design)
- **persistence:** config (spec — consumed by #609)
- **uiSurfaces:** 0
- **pipeline:** scoring
- **completion:** complete (design only; runtime wiring is #609)

## QA Test Entry

- **area:** Scoring / Protocols
- **name:** GOLD protocols have distinct maxScore ceilings
- **procedure:** Open the matrix doc and confirm the 5 protocols' directive totals are distinct (790 / 910 / 855 / 685 / 485) with different drop lists and risk-gate bands.
- **expected:** No two GOLD protocols share an identical maxScore total or directive set.

## Architecture Framework Entry

- **section:** directives
- **summary:** Timeframe-directive-importance matrix — per-band weight/maxScore/threshold for the 12 GOLD directives, mapping Tick→Position. Concrete per-protocol payload (directiveMaxScores + drops + RSI thresholds + risk-gate multipliers) awaits runtime wiring in #609. Design doc: Google Drive docs/theories/timeframe-directive-importance-matrix.md.
