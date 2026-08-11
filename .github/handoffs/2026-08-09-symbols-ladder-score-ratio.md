---
date: 2026-08-09
area: ui
type: feature
---

## What Changed

Symbols Ladder score column now displays raw score relative to protocol maximum (e.g. "1,878 / 1,000") with color classification based on the normalized percentage. Uses the protocol's `maxScore` from `GET /api/scoring/gated/protocols` — the same value shown on the Protocols Registry page under "Max Score".

## Files Changed

- src/pages/SymbolsLadderPage.jsx — protocolMap captures maxScore; display shows `score.toLocaleString() / max.toLocaleString()`; pct computed for color classification
- src/pages/protocols-ladder.css — added .pl-score-max for muted "/ maxScore" denominator

## Capability Map Entry

- **name:** Score-to-Max Ratio Display
- **persistence:** ephemeral
- **uiSurfaces:** 1
- **pipeline:** scoring
- **completion:** complete

## QA Test Entry

- **area:** UI / Scoring
- **name:** Symbols Ladder shows score/maxScore with protocol-specific denominator
- **procedure:** Navigate to /protocols/symbols-ladder. Compare maxScore denominator against /protocols/protocols-registry "Max Score" stat for the same protocol. Verify same value.
- **expected:** Each row shows raw score and the protocol's maxScore (e.g. "1,878 / 1,000"). Color + badge use pct = (score/max)*100 against 65/40 thresholds.

## Architecture Framework Entry

- **section:** routes
- **summary:** Symbols Ladder score displays raw directive sum against protocol maxScore (sum of directiveMaxScores). maxScore sourced from GET /api/scoring/gated/protocols — same endpoint as Protocols Registry "Max Score" stat. Color normalized via pct = Math.round((score/max)*100). Files: SymbolsLadderPage.jsx, protocols-ladder.css.
