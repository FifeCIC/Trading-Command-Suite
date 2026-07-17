## META.Stack Context Update (2026-07-17)

Significant overlap with existing infrastructure since this issue was created.

### What Already Exists
- **News sentiment directive** (news-sentiment) — already uses bar data, no Finnhub call needed during scoring
- **InvestigationService** — Finnhub multi-source deep dive with 20 news articles, sentiment scoring, social buzz, analyst targets
- **ResearchImportService** — scheduled imports for social sentiment (every 6h), insider data, company metrics
- **SocialMention model** — stores social media sentiment snapshots (Reddit + Twitter) from Finnhub
- **AI infrastructure** — DeepSeek integration for signal analysis, trade explanations, news sentiment, with cost tracking at /lab/ai-costs
- **AI Log Viewer** at /status/ai-logs — browse AI request/response logs with cost summaries
- **vix-regime directive** — already exists in the directive registry, scores VIX regime awareness
- **Decoder service** — POST /api/decoder/parse with pattern-based AI analysis (sentiment scoring, symbol extraction, key date detection). No external API dependency.

### Implementation Guidance
- Don't create a new DB schema for news events — use the existing SocialMention model or extend it
- Don't create a new AI sentiment pipeline — use the existing DeepSeek integration or the Decoder service
- The vix-regime directive is already in the scoring pipeline. If this needs enhanced VIX-specific scoring, extend the existing directive rather than creating a separate service
- The "historical VIX correlation" concept aligns with the existing Correlation Service (live 90d correlations)
- News ingestion should use the existing import pipeline (ResearchImportService), not a new scheduled job
- The visual news feed described can use existing dashboard cards — Dashboard already has News & Sentiment card with Finnhub/FMP status dots
