# Live Ordering Stack — Watchlist + Protocol Pairing Enhancement

Status: discussion
Created: 2026-06-29

## Current State
- The Live Ordering Stack has Watchlist and Protocol dropdown menus
- Users select both blindly — there's no guidance on which watchlists match which protocols
- There's no metadata linking watchlist symbol requirements to protocol directive requirements

## Discussion Points

### 1. Pairing Metadata
What metadata exists or should exist to enable smart pairing:
- Watchlists have: symbols (tickers, types, exchanges)
- Protocols have: directive groups (Technical, Sentiment, Risk), tradingStyle, recommendedTimeframe, avgHoldTime, idealFor
- Scoring Strategies could be the link: a stored pairing of watchlist + protocol with metadata

### 2. Built-in Scoring Strategies
Proposal: Pre-built, disabled-by-default Scoring Strategies that auto-enable when requirements are met:
- All symbols in the watchlist match the strategy's hard-coded parameters
- The protocol is a built-in one (not user-created)
- Example: "S&P 500 Momentum" strategy requires all symbols be US stocks with options data

### 3. Smart Menu Filtering
When user selects one menu, the other menu filters to only show compatible items:
- Select protocol → only compatible watchlists shown
- Select watchlist → only compatible protocols shown
- Toggle to enable/disable this enforcement
- Incompatible items greyed out (not hidden) when toggle is off

### 4. Agentic AI Guidance
Using DeepSeek API (or similar) to:
- Suggest pairings based on watchlist composition and protocol metadata
- Review user selections and provide confidence score
- Generate custom protocol recommendations for a given watchlist
- Check current DeepSeek API integration status

### 5. Two-Mode UX
- **Guided Mode**: Built-in features + AI approval/suggestion guide the user
- **Expert Mode**: Full flexibility, user designs everything without guidance
- This dual approach supports both novice and expert traders

## Actions
- [ ] Audit existing watchlist + protocol metadata
- [ ] Design ScoringStrategy storage (DB table)
- [ ] Check DeepSeek API integration status
- [ ] Prototype smart filtering in the Live Ordering Stack UI
- [ ] Create built-in Scoring Strategies concept
