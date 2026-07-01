# Earnings Calendar — Multi-Source, Confidence & Email Integration

Status: discussion
Created: 2026-06-30

## Current State
- Displays upcoming earnings dates
- No confidence indicators for expected direction
- No multi-source aggregation
- No integration with external analysis (Earnings Whispers emails)

## Discussion Points

### 1. Biggest Movement Indicators
How to identify which earnings could cause the biggest moves:
- Historical earnings surprise magnitude (beat/miss by how much?)
- Implied volatility before earnings
- Analyst revision dispersion (wide range = uncertainty = bigger move potential)
- Market cap weighting (large cap = broader impact)

### 2. Confidence in Direction
Building a confidence indicator for good/bad earnings:
- Analyst consensus vs. whisper number
- Recent earnings trend (beating or missing?)
- Sector peer performance (are peers beating?)
- Options market implied move

### 3. Multi-Source Aggregation: Earnings Whispers
You get Earnings Whispers emails with analysis paragraphs. The goal:
- Extract numbers from their text (EPS estimate, revenue estimate)
- Compare against consensus
- Track their accuracy over time (how often are they right?)
- Use their data in our scoring

### 4. Email → System Pipeline
What's the best way to get those emails into the system quickly?
- **Option A**: Forward to a dedicated email address → server parses it
- **Option B**: Manual copy-paste into a form
- **Option C**: Gmail API integration → auto-fetch from label/folder
- **Option D**: Browser extension to capture and send

## Questions For You

1. **Email integration**: Which option above feels most practical? Forward-to-parse is the most automated.

2. **Confidence indicator**: Do you want a simple binary (likely good / likely bad) or a graduated scale (0-100)?

3. **Source credibility tracking**: Should we build a general system for tracking any source's prediction accuracy (Earnings Whispers, analysts, social profiles)?
