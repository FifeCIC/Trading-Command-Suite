## Source

`/scoring/strategy-ladders`

## Problem — Needs Discussion + Rebuild

This view has multiple issues:

### 1. Confused purpose
Scoring Strategies decide which symbols scored high enough and passed all gates to be a "signal." This view shows 8 scoring strategies but they display wrong watchlists:
- "US Indices" (should be SPY+QQQ) shows a long unrelated watchlist
- "Forex Pairs" shows APPL, JOBY, HOOD etc. — completely wrong symbols

### 2. Proposed redesign
- **Rename** to "Strategies Ladder"
- **Single ladder** with all active scoring strategies factored in
- **Two display modes:**
  - ALL scored symbols (every symbol that was scored)
  - Signals only (highest scoring, passed gates)
- Configuration controls how many symbols each scoring strategy can promote

### 3. Market area coverage
The user wants GitHub issues created for each of the 8 market areas, covering:
- Protocol creation
- Scoring strategy creation
- Trading strategy creation

Some areas may already be covered — audit existing coverage first.

## Expected

1. Discussion to clarify the ladder design
2. Full rebuild implementing the clarified design
3. Create sub-issues for each uncovered market area

## Element

Current view: `/scoring/strategy-ladders`
