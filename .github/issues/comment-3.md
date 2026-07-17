## META.Stack Context Update (2026-07-17)

This issue proposes a new scoring directive + visual indicator. The SEES scoring engine and directive registry have matured significantly since this was written.

### What Already Exists
- **Directive Registry** — 99+ directives in the system, each with IDirective interface (score, directionBias, maxScore)
- **Protocol system** — 32 protocols, 111 directive groups, 542 directive entries. New directives should be registered in the PROTOCOL_REGISTRY
- **Directive scoring pipeline** — directives run through scoreWithGating() in ProtocolGatingService with multiplicative risk gating
- **MarketBar data** — OHLCV candle data available via MT5 bridge, used by all technical directives
- **BOS (Break of Structure)** / **entropy** / **Hurst** condition detectors already exist in the activation gate system

### Implementation Guidance
- A pullback/retracement directive should be implemented as a **new directive** in the NestJS directives module, not as frontend JavaScript
- Register it in PROTOCOL_REGISTRY with appropriate directive groups
- It will automatically be available to all protocols and the scoring pipeline
- The directive output (score, signal) will flow through the existing gatedScoreCache → TradingStrategy evaluation pipeline
- For the visual indicator part, consider whether the existing Chart/BacktestLab pages can display it, or if a new Lab visualization page is needed
- Swing high/low detection can use existing MarketBar data — no need for a separate candle data pipeline
- The directive can consume bar data already available through the data import pipeline

### Key Pattern
New trading logic = New **directive** (in NestJS), not new frontend code. The frontend just renders what the scoring pipeline produces.
