# Discussion: News Dissipation Curves & Historical News Database

> **Status: IMPLEMENTED (2026-06-18)** — Q287 built the News Sentiment Data Pipeline: NewsArticle + NewsImportRun Prisma models, NewsImportService (Finnhub + dedup + category classification + cron every 6h), NewsIntelPage rebuilt with category tabs and import button. Q287b (pending migration) remains for some data sources.
>
> The exploration-phase design below is retained for reference. Current implementation lives in `nest/src/modules/news/`.

## Status: EXPLORATION — needs design before building

## Core Question
Can we quantify how long a news event's price effect lasts, by event type and symbol class?

## What We'd Need

### Historical News Database
- Event type: earnings beat/miss, Fed announcement, geopolitical, product launch, CEO tweet, regulatory, macro data release
- Symbol or asset class affected
- Date/time of event
- Price at event, +1h, +4h, +24h, +3d, +7d, +30d
- Volume during event
- Volatility during event
- Sentiment score at event time

### Dissipation Curve Model
For each event type × asset class, a curve showing:
- X-axis: time since event
- Y-axis: % of price effect remaining

Example (hypothetical):
```
NVDA Earnings Beat:
  t+0:   100% effect (full impact priced in)
  t+1d:   85% effect
  t+3d:   60% effect  
  t+7d:   35% effect
  t+30d:  10% effect (mostly dissipated)

FOMC Rate Decision (USD pairs):
  t+0:   100%
  t+1h:   95%
  t+1d:   70%
  t+3d:   40%
  t+7d:   25%
  t+30d:  15% (monetary policy has lasting effects)

Elon Musk DOGE Tweet:
  t+0:   100%
  t+1h:   50%
  t+1d:   20%
  t+3d:    5% (meme hype fades fast)
```

### How This Feeds SEES
When scoring a symbol, the `news-dissipation` directive:
1. Looks up: "Is there an active news event affecting this symbol?"
2. If yes: "How far are we on the dissipation curve?"
3. Outputs: "NVDA EPS beat 2 days ago. ~60% of effect remains. Score adjustment: +12 (from +20 at event). Predicted adjustment in 5 days: +4."

## Open Questions
1. Where does the historical data come from? Free sources (Yahoo Finance headlines, Finnhub news API) or paid (Bloomberg, Reuters)?
2. How do we handle overlapping events? "Earnings beat + sector rotation + macro data release" — compound effects?
3. Do dissipation curves differ by market regime? (Bear market events fade differently than bull market)
4. Is this a Q2 2026 feature or Q4? Depends on data availability.

## Recommendation
Start small: build for earnings events only (dates known in advance, clean before/after), using free data. If the model works for earnings, expand to other event types.

## Related
- Q215: Directive Accuracy Tracking (foundation data)
- SYMBOL-CALIBRATION.md (per-symbol adjustments)
- FLUFF-DETECTOR.md (news source reliability)
