# Handoff: META.Stack Explorer Page (Phase 1)

**Agent:** DeepSeek V4 Pro
**Date:** 2026-07-22
**Issue:** New feature — META.Stack Explorer interactive pipeline visualization

## What was built

A new interactive page at `/development/meta-stack-explorer` ("META.Stack Explorer") in the Development nav area.

### Concept
Shows the full META.Stack scoring pipeline end-to-end with live data flowing through 6 stages:
Market Data → Protocol → Directives → Group Scores → Risk Gate → Composite

### Page structure
- **Controls bar**: SymbolAutocomplete + Protocol dropdown + Run button
- **Pipeline flow**: 6 horizontally-connected animated cards, each showing:
  - Live value from the scoring run (composite, directive count, etc.)
  - Expandable technical detail: class name, method, DB table, columns, live example value
  - Stage-specific drilldowns (per-directive scores for Directives stage, risk chain for Risk Gate, raw/max/pct for Groups)
- **Signal banner**: Final composite/100 with signal badge, risk multiplier, rarity, weight strategy
- **Sub-score bars**: Animated horizontal bars for Technical/Sentiment/Risk
- **Empty state**: Prompt to run the pipeline

### Technical details displayed per stage
| Stage | Class | Method | DB Table |
|-------|-------|--------|----------|
| Market Data | MarketDataService | getBars(symbolId, "1d", 200) | market_bar |
| Protocol | ProtocolDbService | findBySlug(protocolId) | scoring_strategy |
| Directives | DirectivesService | runAll(input, directiveFilter) | directive, score_snapshot |
| Group Scores | ProtocolGatingService | scoreWithGating() | score_snapshot |
| Risk Gate | RiskGatingEngine | apply(baseScore, riskDirectives) | N/A (computation) |
| Composite | ProtocolGatingService | signal assignment | score_snapshot |

### Animations
- Stage cards: fade + slide up on mount (staggered 60ms)
- Connector arrows: pulsing left-right motion
- Signal banner: scale-up fade-in
- Sub-score bars: width animation from 0 to actual %
- Expandable sections: height + opacity transitions via AnimatePresence

### Data source
Uses existing `POST /api/scoring/gated/batch` — no new backend endpoints needed.
The gated batch response already contains: breakouts, riskGate chain, subScores, subRawTotals, subMaxTotals, meta.

### Files
| New | Modified |
|-----|----------|
| `src/pages/MetaStackExplorerPage.jsx` | `src/core/nav-tree.js` |
| `src/pages/meta-stack-explorer.css` | `src/core/view-routes.jsx` |

### Phase 2 ideas
- Directive on/off toggles to see score changes in real time
- Compare two protocols side by side
- Animated particle flow between stages
- Save/share pipeline run snapshots
- Protocol editor integration (modify weights, see live impact)
