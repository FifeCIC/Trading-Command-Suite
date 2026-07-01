# RUI007 — Social Networks Sentiment Feed

**Agent:** react-ui-agent
**Area:** Research / Scoring
**Priority:** P2 — feeds social-buzz directive
**Depends on:** Finnhub news sentiment (already working), Reddit/Twitter API (optional)

## Current State
`SocialNetworksPage.jsx` exists as a mock placeholder.

## Task

### Phase 1: News-Only Sentiment (quick win)
Since Finnhub news API already works:
- Repurpose existing news sentiment data into a social-style feed
- Show recent articles with sentiment scores, engagement metrics
- Aggregate sentiment by symbol over time (24h, 7d, 30d)
- Show which symbols have unusual sentiment activity

### Phase 2: Social APIs (future)
- Reddit r/wallstreetbets, r/stocks mention tracking
- Twitter/X cashtag volume
- StockTwits trending

### Directive Integration
- Show real-time `social-buzz` directive score
- Sentiment timeline: sparkline of sentiment over time with event markers
- "Unusual activity" detection: highlight symbols with 3σ sentiment deviation

### UI Guidance

**Layout:** Card-based feed — each symbol gets a sentiment card

**Visual styling:**
- Cards arranged in a masonry-style grid using CSS columns
- Sentiment score: large animated number with color gradient (red → grey → green)
- Sentiment sparkline: `motion` animated path drawing effect
- "Unusual activity" cards: pulsing amber border via `box-shadow` animation
- Positive sentiment: subtle green glow on card. Negative: red glow

**Transitions:**
- Filter by symbol: cards `AnimatePresence` exit/enter with staggered delay
- Time range toggle (24h/7d/30d): sparkline smoothly morphs between ranges
- Card expansion: uses Container Queries for responsive internal layout

**Real-time feel:** Auto-refresh every 60s. New data slides in with a subtle "new" indicator dot.
