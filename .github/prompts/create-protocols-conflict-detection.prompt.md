# Create Protocols — Conflict Detection & Strategy Details Enhancement

Status: discussion
Created: 2026-06-29

## Current State
- The Create Protocols (Strategy Builder) page allows selecting directives and setting weights
- No validation for conflicting directives
- Strategy Details section has basic fields (name, description, goals, symbol focus)

## Discussion Points

### 1. Directive Conflict Detection
Do any directives conflict with each other?
- Example: "Momentum ROC" (momentum-based) + "Mean Reversion" (counter-trend) — opposing signals
- Example: "Session Open Effect" (short-term) + "Position Concentration" (portfolio-level) — different scopes
- Need: a conflict matrix or rule engine that warns when conflicting directives are selected
- Should this be a soft warning or hard block?

### 2. Strategy Details → Directive Filtering
The Strategy Details section could drive directive recommendations:
- User selects intended trade type (CFD, Stocks, Forex, Crypto, Options)
- User selects watchlist to pair with
- User specifies time horizon (scalp, day, swing, position)
- Based on these selections, highlight applicable directives
- Agentic AI could review and suggest adjustments before saving

### 3. Watchlist Selection in Builder
Should the watchlist be selected here in the strategy builder?
- Currently watchlist+protocol pairing happens on Live Ordering Stack
- If watchlist is selected here, it becomes part of the Scoring Strategy definition
- Pro: One place to define everything
- Con: Reduces flexibility (can't re-pair without editing the strategy)

### 4. AI Revision Before Save
Use agentic AI to:
- Review directive selections for completeness
- Check weight distribution (are any directives over/under-weighted?)
- Compare against similar strategies
- Suggest missing directives based on trading style

## Actions
- [ ] Research directive conflict detection
- [ ] Add trade type/timeframe/watchlist fields to Strategy Details
- [ ] Build directive filtering based on strategy metadata
- [ ] Integrate AI revision step
- [ ] Test in parts — each feature independently
