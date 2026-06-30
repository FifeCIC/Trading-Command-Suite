# Social Networks — Specific Profile Tracking vs. General Mentions

Status: discussion
Created: 2026-06-30

## Current State
- Shows thousands of mentions for each stock
- Unclear if this is demo data or real
- No evidence of social media data in a download queue
- General mention counts may not be useful

## The Real Intention
Your original idea was to follow **specific profiles and channels**, not do general mention counting. The value is:
1. Add specific social network usernames/profiles to track
2. Process their trading tips into structured data
3. Score on that data (sentiment, conviction, accuracy)
4. Track how accurate they are over time
5. Weight their influence based on historical accuracy

This is fundamentally different from "10,000 mentions of TSLA today."

## Discussion Points

### 1. Demo Data Check
- [ ] Verify if current social data is demo/simulated
- [ ] If demo, remove and show "No tracked profiles configured"

### 2. Profile Management
Build tools for:
- [ ] Adding specific social profiles (Twitter/X handles, Reddit users, YouTube channels)
- [ ] Categorizing profiles (technical analyst, macro commentator, insider, meme)
- [ ] Setting alert thresholds (only notify if this profile posts about my symbols)

### 3. Tip Extraction & Scoring
- Extract trading-related statements from posts
- Structure them: symbol, direction, conviction, timeframe
- Compare against actual market outcomes
- Build accuracy scores per profile
- Use these as inputs to a social-sentiment directive

### 4. Long-Term Accuracy Tracking
This is your "knowledge to plan" — knowing which voices are reliable:
- Track every call a profile makes
- Measure: win rate, average return, max drawdown, consistency
- Display: accuracy chart, recent calls table, conviction-adjusted score

## Questions For You

1. **Demo data**: Should I check the backend to confirm if social data is real or simulated?

2. **Profile scope**: Twitter/X only, or Reddit, YouTube, StockTwits, Discord too? Which first?

3. **Automated vs. manual**: Should the system auto-extract trading tips from posts, or do you want to manually flag/categorize them?

4. **Privacy/rate limits**: Are you comfortable with the app making API calls to social platforms on your behalf?
