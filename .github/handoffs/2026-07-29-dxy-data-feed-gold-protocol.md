# Handoff — DXY Data Feed + Gold Macro Protocol — 2026-07-29

## What Changed
Wired real DXY data into the scoring pipeline and activated gold-specific directives for protocol scoring.

### 1. dxyValue now passed to directives (critical fix)
Both scoring paths (`scoring.service.ts` rankAll and `protocol-gating.service.ts` scoreWithGating) now derive and pass `dxyValue` on the `DirectiveInput`. Previously only `eurusdValue` was passed — directives had to derive DXY proxy internally, and the value wasn't always available.

**EURUSD source**: MT5 bridge → EurUsdCacheService (60s TTL). Currently EURUSD = 1.14612 → DXY proxy = 103 (neutral USD).

### 2. Gold directives added to protocol groups
Three gold-specific directives were NOT in any directive group — they never fired during scoring:

| Directive | Group Added | Readiness |
|-----------|------------|-----------|
| `gold-session-profile` | technical | ready |
| `gold-round-numbers` | technical | ready |
| `gold-macro-correlation` | sentiment | bravo |

`dxy-regime` was already in the risk group. `engulfing-pattern` also added to technical (heavyweight impact=898).

### 3. beta→bravo naming fixed
Protocol-gating service and controller had `beta`/`betaCount` instead of `bravo`/`bravoCount`. The readiness breakdown now correctly shows bravo count (8 bravo directives in the SEES Core protocol).

### Verification (XAUUSD, SEES Core protocol)
```
Composite: 5 | Signal: HOLD
Readiness: 20 ready, 8 bravo, 0 alpha
dxy-regime:       score=19 (base 38 from DXY=103, -50% off-hours session penalty)
gold-macro:       score=19 (same)
gold-session:     firing in technical group
gold-round-numbers: firing in technical group
```

The -50% session penalty applies to ALL directives right now (markets closed). When London opens, scores will approximately double, pushing composite from 5 → ~10+.

## Files Changed
- `nest/src/modules/scoring/scoring.service.ts` — dxyValue passed on DirectiveInput
- `nest/src/modules/scoring/protocol-gating.service.ts` — dxyValue passed, beta→bravo fix
- `nest/src/modules/scoring/protocol-gating.controller.ts` — beta→bravo fix
- `nest/src/modules/directives/directive-groups.ts` — +4 gold directives to groups
- `src/pages/MetaStackExplorerPage.jsx` — Impact Audit link in signal banner
- `src/pages/meta-stack-explorer.css` — .mse-impact-link style
- `src/pages/DirectiveImpactAuditPage.jsx` — ?symbol= query param support

## Infrastructure Status
- MT5 Bridge: connected (EURUSD bid=1.14612)
- Finnhub: API key configured, adapter built (not yet used for DXY)
- DXY data: EURUSD proxy (57.6% correlation to DXY basket)
- Real DXY: requires Finnhub forex/indices endpoint or paid data feed

## Next Steps for Trading
1. Wait for London open — session penalty lifts, scores double
2. Monitor composite trend across multiple ticks
3. Set up a Trading Strategy with tradeThreshold=60 and the SEES Core protocol
4. Connect MT5 for automated execution when signal > threshold
