# Sector Rotation — Data, Scoring & Protocol Stratification

Status: discussion
Created: 2026-06-30

## Current State
- Page doesn't appear to work — no meaningful data shown
- Offers minimum explanation and insight about symbols the user actually focuses on
- Should be supported by strong page caching

## Discussion Points

### 1. Sector Rotation Scoring Directive
Is there a scoring directive based on sector rotation? If so:
- [ ] What variations exist or could be created?
- [ ] How does it compare to other macro directives?
- [ ] Does it need specific data (sector ETF performance, relative strength)?

### 2. Protocol Stratification (New Idea)
You proposed: *"Protocols to be split into stages, with groups of directives requiring a certain score to get a pass."*

This is different from the current flat scoring model. Let's explore:
- A protocol could have multiple stages, each with a minimum score threshold
- Stage 1: Technical indicators must score ≥ 60
- Stage 2: Sentiment/fundamentals must score ≥ 50  
- Stage 3: Risk gates all pass
- A symbol only gets a final score if it passes all stages

Questions:
- Is this different from applying rules to a trading strategy, or is it a scoring strategy concern?
- Should this be a protocol-level configuration or a strategy-level override?
- How does this interact with the existing weight system?
- Could stages be reordered per strategy (e.g., risk-first for conservative, technical-first for aggressive)?

### 3. Approaches Not Yet Considered
What sector rotation approaches are we missing?
- [ ] Relative strength ranking across sectors
- [ ] Momentum-based sector switching
- [ ] Correlation-based sector hedging
- [ ] Macro-economic indicator overlay (interest rates, GDP, employment)
- [ ] Seasonal sector patterns
- [ ] ETF flow analysis

### 4. Page Performance
Sector rotation data changes slowly (daily/weekly). This is a prime candidate for caching:
- Cache sector performance data for 1 hour minimum
- Only refresh on market open/close events
- Pre-compute rankings server-side

## Questions For You

1. **Protocol stratification**: Is this a fundamental change to how scoring works, or an optional layer on top? Should it be a protocol feature, a strategy feature, or both?

2. **Sector rotation directive**: Should we build one? What data sources would it use?

3. **Page caching**: Would you accept a 1-hour stale cache for sector data, with manual refresh option?
