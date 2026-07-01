# VIX Trading Strategy — Discussion Prompt

**Created**: 2026-06-30
**Status**: Discussion
**Related**: `archived/VIX.md`, `archived/VIX-REGIME-DIRECTIVE.md`

---

## Context

VIX (CBOE Volatility Index) is a unique instrument that measures implied volatility of S&P 500 options. It's inversely correlated with SPX/SPY and spikes during market stress. User is keen to trade VIX alongside other instruments and wants a dedicated system within the Trading Command Suite.

## Key Questions for Discussion

### 1. Scoring Protocols for VIX
What directives would apply to VIX specifically?
- **VIX Term Structure** (contango vs backwardation) — are we in a normal or stressed regime?
- **VIX/SPX Correlation Deviation** — when the inverse correlation breaks, what does it signal?
- **VIX Spike Detection** — percentage moves above a rolling baseline
- **VIX Futures Curve** — contango percentage, roll yield calculation
- **Market Breadth / Put-Call Ratio** — options market sentiment
- **Event Proximity** — FOMC, CPI, NFP dates affecting VIX expectations

### 2. Data Sources
- VIX index data (CBOE) — available via Alpha Vantage? FRED?
- VIX futures data — term structure requires futures prices
- Options data — put/call ratios, skew
- Macro event calendar integration

### 3. Trading Implementation
- CFD trading via MT5 (VIX is available as VIX or VIX-USD on some brokers)
- Position sizing — VIX is highly volatile, requires specific risk management
- Mean-reversion tendencies — VIX historically reverts, but timing is critical
- Session-aware — VIX behaves differently during US vs Asian sessions

### 4. Integration with SEES
- Should VIX directives feed into the main scoring pipeline?
- Or should VIX have its own dedicated scoring stack?
- How do VIX signals interact with equity position signals?

### 5. Monitoring Dashboard
- Key factors affecting VIX: SPX level, VIX futures curve, macro events, market breadth
- Real-time VIX regime indicator (low vol / normal / stress / crash)
- Alert thresholds for VIX spike warnings

## Existing Resources
- `archived/VIX.md` — detailed VIX strategy document (event-based, correlation analysis, phased implementation)
- `archived/VIX-REGIME-DIRECTIVE.md` — VIX regime classification directive

## Suggested Next Steps
1. Review existing VIX archived docs and assess what's still relevant
2. Define core VIX supporting directives with the aim of creating one or more VIX focused protocols
3. Determine data source availability (VIX index, futures term structure)
4. Design the VIX monitoring dashboard view
5. Integrate VIX alerts into the Alert Center
