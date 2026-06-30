# News Intel — AI Tracking, Position Indicators & Directive Scoring

Status: discussion
Created: 2026-06-30

## Current State
- Displays news entries with ratings (LOW, MEDIUM, HIGH)
- Unclear what determines the rating
- No position-aware indicators
- Unclear if data is stored sufficiently for scoring directives

## Clear Actions

### 1. Rating System Transparency
- [ ] If ratings come from AI, display "AI Rating" label + model info
- [ ] Add AI usage tracking: counter, log of AI calls
- [ ] Show confidence score alongside rating

### 2. Position-Aware Indicators
- [ ] Show a badge/icon on news entries for stocks the user holds positions in
- [ ] Priority sort: "My Positions" filter to surface relevant news first
- [ ] May need to open test positions to verify

### 3. Data Storage for Scoring
- [ ] Verify that news data is stored in a way a directive can score on
- [ ] Check: does `news-sentiment` directive have access to stored news data?
- [ ] Schema check: are sentiment scores, categories, and timestamps persisted?

## Discussion Points

### 1. AI Integration Tracking
You want tracking over AI use — a log + counter. This ties into the wider logging system discussion. Specific needs for news:
- Count AI rating calls per day
- Track which model was used
- Log input (article text) and output (rating + confidence)
- Cost tracking if using paid API

### 2. News as a Scoring Input
The `news-sentiment` directive needs:
- Stored news articles with sentiment scores
- Timestamp for temporal relevance decay
- Category tags for filtering (earnings, macro, company-specific)
- Source credibility weighting

## Questions For You

1. **Rating determination**: Is it currently AI-based, rule-based, or mock? Need to check the backend.

2. **AI provider**: DeepSeek API for news analysis? Or another provider? Need to confirm integration status.

3. **News sources**: Which providers are configured for news import? (Finnhub has news=true in capability map)
