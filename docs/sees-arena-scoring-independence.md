# SEES Arena & Scoring Independence

Status: discussion
Created: 2026-06-29

## Current State
- SEES Arena shows "Unavailable" — the `/api/scoring/arena` endpoint doesn't exist yet
- It was designed to show multiple SEES Live Ordering stacks side-by-side with horizontal scrolling
- Each stack represents a different Scoring Strategy (watchlist + protocol pair)

## Discussion Points

### 1. Arena Endpoint
The arena needs a dedicated backend endpoint that:
- Accepts multiple scoring strategy IDs
- Returns scored symbols for each strategy
- Supports adding/removing strategies without interrupting active scoring

### 2. Scoring Independence from UI
Critical question: Can scoring run without any SEES UI page loaded?
- **Live Ordering Stack**: Currently polls `/api/scoring/gated/batch` on demand — not independent
- **SEES Advanced**: Same — needs the page loaded
- **SEES Arena**: Same — needs the page loaded
- **Automation System**: Has a ScoringSchedulerService that CAN run independently (if SCORING_AUTO_RUN is enabled)

The goal: strengthen the Automation system so scoring and signal generation continue regardless of which page is loaded. The Arena is where the visual output of this system is observed.

### 3. Add Strategy Placeholder
At the end of the horizontal stack row, a "+" placeholder card should let users click to add another Scoring Strategy. This should:
- Add the strategy instantly without interrupting ongoing scoring
- Auto-start scoring for the new strategy
- Animate the stack into view

### 4. Side-by-Side Testing
Create a GitHub issue to run SEES Advanced and Live Ordering Stack side by side with the same Watchlist+Protocol pair. Scores should match. This validates the scoring pipeline.

## Actions
- [ ] Build `/api/scoring/arena` endpoint
- [ ] Enable SCORING_AUTO_RUN for background scoring
- [ ] Add "+" placeholder card to arena
- [ ] Create GitHub issue for side-by-side SEES test
