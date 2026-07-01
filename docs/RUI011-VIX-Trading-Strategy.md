# RUI011 — VIX Trading Strategy & Scoring Protocols

**Agent:** tcs-dev
**Area:** Scoring / Trading
**Priority:** P2 — discussion & design phase
**Depends on:** archived/VIX.md, archived/VIX-REGIME-DIRECTIVE.md

## Context

VIX (CBOE Volatility Index) measures implied volatility of S&P 500 options. It's inversely correlated with SPX/SPY and spikes during market stress. User wants a dedicated VIX trading system alongside other instruments.

## Task

### Phase 1: Research & Design
- Review `archived/VIX.md` and `archived/VIX-REGIME-DIRECTIVE.md`
- Define 3–5 core VIX-specific directives for a VIX-focused protocol
- Determine data source availability (VIX index via Alpha Vantage/FRED, futures term structure)

### Phase 2: Directive Implementation
Candidate directives:
- **VIX Term Structure** — contango vs backwardation regime detection
- **VIX/SPX Correlation Deviation** — when inverse correlation breaks
- **VIX Spike Detection** — percentage moves above rolling baseline
- **Market Breadth / Put-Call Ratio** — options market sentiment
- **Event Proximity** — FOMC, CPI, NFP dates affecting VIX expectations

### Phase 3: Integration
- Should VIX directives feed main scoring pipeline or have dedicated stack?
- How do VIX signals interact with equity position signals?
- Design VIX monitoring dashboard view
- Integrate VIX alerts into Alert Center

### Phase 4: Trading
- CFD trading via MT5 (VIX available as VIX or VIX-USD)
- Position sizing for high volatility instrument
- Session-aware behavior (US vs Asian sessions)
