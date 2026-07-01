# Chart Comparison & Analyse Symbol — Purpose Clarification

Status: discussion (reminder / clarification)
Created: 2026-06-30

## Chart Comparison (`/analysis/chart-comparison`)

### Primary Purpose
A/B protocol comparison on the same chart. You select a symbol and two protocols, and the page shows how each protocol scores the symbol side by side. This answers: "Which protocol gives me a better signal on NVDA right now?"

### Current State
- Uses MOCK data (`generateMockBars` function) — 100% simulated price data
- Compares "Protocol A — Trend Following" vs. "Protocol B — Mean Reversion" with hardcoded mock protocols
- Both protocols and price data are fake

### What It Should Be
- Real price data from the database (marketbar table)
- Real protocols from the API (your configured protocols)
- Side-by-side scoring results with directive breakdown
- Visual: two score lines overlaid on the same price chart

## Analyse Symbol (`/analysis/analyse-symbol`)

### Primary Purpose
A comprehensive single-symbol analysis tool. You search for a symbol, and it pulls everything available: scoring, indicators, fundamentals, news — delivering a mini-report. Think of it as: "Tell me everything about NVDA right now."

### Current State
- Fetches real symbol list from `/api/symbols`
- Fetches scoring data from `/api/scoring/ranked`
- Shows symbol detail + scoring results
- Purpose is clear but the page may be under-developed

### What It Could Be
- Full report: price, score, indicators, support/resistance, news sentiment, upcoming events, forecast
- "One page to understand a symbol completely"
- This is the logical endpoint of the entire Analysis area

## Questions For You

1. **Chart Comparison**: Do you still want A/B protocol comparison, or has that concept been replaced by the multi-stack arena view?

2. **Analyse Symbol**: Is the "comprehensive report" vision correct? If so, this page becomes the summary of everything the Analysis area can do.

3. **Mock data removal**: Both Chart Comparison and Pattern Scanner use mock data. Should I create a single task to audit and remove ALL mock data across the Analysis area?
