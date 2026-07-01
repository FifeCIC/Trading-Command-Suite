# Symbols Browser — New Top-Level "Symbols" Area

Status: discussion
Created: 2026-06-30

## Current State
- Table shows ticker + name (both showing the same ticker value — name should be company name)
- Sidebar is basic — no earnings dates, no enriched data
- No "research" aspect — it's a symbol list, not research

## Proposal: New "Symbols" Top-Level Area
Move symbols-browser out of Research into its own top-level navigation area. Pages that could fill it:

| Page | Purpose |
|---|---|
| **Symbols Browser** (primary) | Browse/search all symbols with enriched columns |
| **Symbol Detail** | Deep dive on a single symbol (already exists) |
| **Add Symbol** | Already exists |

## Enriched Columns
The table needs more columns to justify being a primary page:
- [ ] **Company Name** (currently same as ticker — needs DB enrichment)
- [ ] **Total Times Traded** — query from trade history
- [ ] **P&L** — total profit/loss across all trades for this symbol
- [ ] **Curated Forecast Price** — our average from multiple analyst sources
- [ ] **Sector** / **Industry** — already in some symbol data, needs surfacing
- [ ] **Last Score** — most recent SEES composite score
- [ ] **Earnings Date** (next upcoming)

## Backend Requirements
These columns push for backend improvements:
- Trade history aggregation by symbol
- Analyst forecast import + averaging formula
- Score history lookup (already exists — just needs joining)

## Sidebar Enhancement
When a symbol is selected:
- Company earnings date
- Recent news headlines
- Current score + trend sparkline
- Position status (do I hold this?)

## Questions For You

1. **New top-level area**: Worth it? What would you name it — "Symbols" or something else?

2. **Which columns first?** Company name + sector are quick wins. P&L and forecast need more backend work. Priority order?

3. **Forecast formula**: How should we calculate the "curated average"? Simple mean of all analyst targets? Weighted by source credibility? Exclude outliers?

4. **Symbols Browser vs. Active Symbols**: The watchlists area already has Active Symbols. How should they differ?
