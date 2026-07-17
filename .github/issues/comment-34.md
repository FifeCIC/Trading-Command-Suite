## META.Stack Context Update (2026-07-17)

The gap analysis concept is still valid, but should leverage existing systems.

### What Already Exists
- **SessionOpenEffectDirective** — already has Monday gap-fill logic as a scoring signal
- **CryptoWeekendEffectDirective** — exists as a stub, could be implemented alongside this
- **MarketBar data** — historical candle data available from MT5 bridge for gap calculations
- **Activation gate system** — conditions can trigger/modify directive behavior based on day-of-week
- **TimelineService** — event-aware scheduling (FOMC, earnings, sessions, seasonality)
- **Risk Service** — drawdown alerts, position monitoring, 3-gate pipeline (threshold/scope/position)
- **Weekend Defense** concept (issue #35) should align with this — consider making these a single "Weekend Risk" module

### Implementation Guidance
- Weekend gap analysis should be a **directive** (e.g., weekend-gap-risk) that scores symbols based on historical gap magnitude
- Historical gap data can be computed from existing MarketBar data — no need for a separate gap database
- The existing activation gate system can conditionally boost/reduce the directive on Fridays
- The "exposure projection" described here fits the existing Risk Service pattern
- For the frontend, consider adding gap metrics to the existing Market Context page (which already has session strength, positions, timing)
- The existing Global Diversification System already aggregates cross-broker exposure — gap risk is a natural extension
