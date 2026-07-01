# Signals Workbench — Signal System Design

Status: discussion
Created: 2026-06-29

## Current State
- Signals Workbench page is a skeleton/placeholder
- Original concept: strong SEES scores behind signals with expiry based on scoring strategy
- Not yet built

## Discussion Points

### 1. Signal Generation
How signals should work:
- SEES scoring run produces scores per symbol per strategy
- Scores above threshold become "signals" with an expiry
- Expiry based on: scoring strategy timeframe (e.g., daily score = 24h expiry)

### 2. Two Levels of Signal Detail
- **Scoring Strategy Signal**: Based purely on directive scores → a single number
- **Trading Strategy Signal**: Scoring + additional rules (position size, risk gates, market conditions, correlation checks)
- User chooses which level they want to see

### 3. Signal Re-Check on Accept
When a user clicks to accept/act on a signal:
- Should the symbol be re-scored immediately?
- This ensures the signal is still valid at the moment of action
- Trade-off: latency vs. accuracy

### 4. Storage
Are we already storing scoring runs to support signal generation?
- Score history exists (score-history.service.ts)
- But there's no signal storage/queue yet
- Need: signal table with status (pending/accepted/expired/rejected)

### 5. Relationship to Automation
Signals are the bridge between scoring and automated trading:
- Scoring → Signals → Automation Rules → Trade Execution
- The Automation area should consume signals, not raw scores

## Actions
- [ ] Design signal data model
- [ ] Build signal generation pipeline from scoring runs
- [ ] Implement signal expiry logic
- [ ] Build Signals Workbench UI
- [ ] Integrate with Automation area
