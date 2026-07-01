# GitHub Issue: Fluff Detector — News Source Pattern Analysis

## The Problem
Financial media publishes with predictable patterns designed to influence, not inform. Monday optimism, Friday fear, coordinated narratives around events. Retail traders absorb this as signal when it's noise.

## What This Is
A system that analyzes news sources to expose patterns, not to censor them. Evidence-based transparency.

## Phase 1: Source Pattern Database
- Track publishing times per source (hour, day of week, day of month)
- Identify: "Source X publishes 73% of bearish articles on Fridays"
- Identify: "During FOMC week, Source Y doubles article output"
- Correlation analysis: does article sentiment predict next-day price movement? (Spoiler: likely not)

## Phase 2: Article Classification
- Headline sentiment scoring (existing `news-sentiment` directive foundation)
- Article-to-price correlation: "After Source Z says 'Crash Coming', SPX averages +0.3% next day"
- Pattern library: recurring narrative templates
- Named narrative detection: "This is a 'wall of worry' pattern — historically bullish"

## Phase 3: Fluff Score
Per article: 0-100 fluff rating
- High fluff: no new information, emotional language, timed for maximum attention, contradicts same source's last article
- Low fluff: contains new data, references specific events, measured language, consistent with prior reporting

## Phase 4: Public Evidence
- Dashboard page at `/research/fluff-detector`
- Source reliability scores over time
- "This Week in Financial Media" auto-generated summary
- Exportable evidence for public sharing (your website)
- Disclaimer: "Pattern analysis, not financial advice. Sources may still produce valuable content."

## Integration with Trading
- When news appears in SEES context, show source reliability
- "Article from Source X (reliability: 2/10, Friday panic pattern detected)"
- Weight news sentiment directive by source reliability
- Don't block — inform. The trader decides.

Labels: research, news, analysis, P2
