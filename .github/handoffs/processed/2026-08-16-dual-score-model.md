---
date: 2026-08-16
area: scoring
type: feature
---

## What Changed

Replaced the single additive composite with a dual-score model: **Opportunity** (additive "everything counts" screening rank) and **Signal** (directional conviction only, drives BUY/HOLD/SELL). This eliminates the "42% BUY noise floor" where always-on gates and neutral conditions inflated directional conviction.

## Files Changed

- nest/src/modules/scoring/protocol-gating.service.ts — gates veto Signal; Signal = Σ directional-only; Opportunity = Σ all; thresholds percentage-based (HOLD_FLOOR/ENTRY_THRESHOLD removed)
- nest/src/modules/scoring/score-history.service.ts — score breakdown persists `rawComposite`, `rawMax`, `opportunityScore`, `opportunityMax`, `signal`
- src/core/score-display.js — `buildScoreDisplay()` output-establishment layer (single place UI reads score display)
- src/components/SignalBadge.jsx — renders signal / PAUSED / market-closed states
- src/pages/SymbolsLadderPage.jsx — Score: Signal / Opportunity columns + Screen Options raw/percent/both toggle
- docs/scoring-architecture.md — design doc

## Capability Map Entry

- **name:** Dual-score model (Opportunity vs Signal)
- **persistence:** stored (score breakdown JSON)
- **uiSurfaces:** 2 (Symbols Ladder, Protocol Trail)
- **pipeline:** scoring
- **completion:** complete

## QA Test Entry

- **area:** Scoring
- **name:** Signal excludes neutral/gate noise
- **procedure:** Open Symbols Ladder on xau-speed-v1; compare Signal vs Opportunity columns for a symbol with flat momentum.
- **expected:** Signal shows low/no directional conviction while Opportunity still ranks the symbol; a closed market shows the "Market closed / frozen" pill with Signal 0.

## Architecture Framework Entry

- **section:** scoring
- **summary:** Dual-score model — Opportunity (additive screening rank) and Signal (directional conviction, gates veto it). UI reads both via `buildScoreDisplay()` output-establishment layer. Known follow-up: stable directional denominator if the dynamic one wobbles.
