# GitHub Issue: Data & ML System — Self-Improving Scoring

## Vision
A self-improving scoring system where every directive's accuracy is measured against real price outcomes. Directives that correctly predict direction get more weight. Directives that consistently fail get dropped. Over time, strategies evolve based on evidence, not assumptions.

## Components

### 1. Complete Score Storage
Every scoring run persists ALL directive scores — not just the 5 weighted ones. The 66 "zero-weighted" directives are free research data. Currently discarded.

### 2. Outcome Tracking
After each score, track price movement at T+15m, T+1h, T+4h, T+24h. Compare direction predicted vs actual. Build accuracy profiles per directive per symbol per timeframe.

### 3. Discovery Engine
"Show me directives that would have predicted the last 10 big moves on NZDUSD." Auto-suggest directive combinations with proven track records.

### 4. Data Lifecycle
Automatic trimming (30-90 day raw data, aggregated summaries forever). Archive to Google Drive. ~660MB steady state regardless of runtime.

### 5. ML Readiness
All data structured for ML consumption. Aggregated features per directive per symbol. Market regime labels. Outcome labels. Ready for model training.

## Related Prompts
- Q214: Score Storage
- Q215: Directive Accuracy Tracking
- Q217: Data Gap Analysis
- Q219: Data Lifecycle Management

## Labels
enhancement, data, ml

## Priority
P1 — foundation for evidence-based strategy improvement
