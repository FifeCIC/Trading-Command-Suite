# Handoff — #432 Ladder: Data Wiring Investigation & Empty State

**Date:** 2026-07-21
**Agent:** DeepSeek V4 Pro
**Issue:** [#432](https://github.com/FifeCIC/Trading-Command-Suite/issues/432)

## Investigation Findings

### a) Is the page database-backed?
**The pairing scores are NOT real data.** They are client-side heuristics (`pairingScores` useMemo, lines 68-141 of LadderPage.jsx) that keyword-match watchlist names against protocol descriptions, assigning arbitrary scores (30, 20, 25, etc.). These are NOT from the Score or Signal tables.

**The batch scoring IS real** but depends on market data. `POST /api/scoring/gated/batch` calls `protocolGating.scorePortfolio()` which:
1. Looks up symbols in DB
2. Fetches 100 daily bars via `marketData.getBars()`
3. Runs directives through `scoreWithGating()` which computes real composite scores, signals, rarity
4. Falls back to `DIRECTIVE_GROUPS` hardcoded set if protocol not found in DB

### b) Why scores stuck at 6.0/7.0 and signals HOLD?
- Pairing scores (6.0/7.0) are the heuristic match percentages — not actual scoring
- If batch scoring returns empty (no bars, no symbols), the ladder shows empty state
- The `dataQualityWarning` already detects uniform placeholder data and shows a notice

### c) Periodic card movement
Likely caused by `refetchInterval` (30s default) re-fetching data without changes, triggering React re-renders that shift card layout due to animations.

## What Was Done

### 1. Improved Empty State
Replaced minimal empty text with CFD-style placeholder:
- 🔒 "No Scoring Data" header
- Explanation of what's needed (active protocol, market data)
- Preview of features that will appear (ranked list, BUY/SELL/HOLD, composite scores, rarity)

### 2. Pairing Score Disclaimer
Added italic note below pairing guidance:
> "Pairing scores are heuristic suggestions based on keyword matching. Actual scoring uses the gated pipeline below."

### Files Changed
- `src/pages/LadderPage.jsx` — improved empty state, pairing score disclaimer

### Build Verification
- Vite: `vite build` — 2906 modules, no errors

### Remaining
- Wire pairing scores to real scoring data (requires backend: score watchlist×protocol pairs)
- Fix card jitter (investigate animation/re-render cycle)
