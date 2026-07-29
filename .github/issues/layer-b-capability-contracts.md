## Problem

Strategies and protocols activate without checking whether their data requirements can be met. The system silently runs with degraded/missing data, producing plausible-looking scores that are noise. The Gold Scalp protocol (`xau-speed-v1`) is a tick-scalp protocol designed for 5s-30s timeframes, but runs on 5m/1d bars without warning the user.

## Solution

A **capability contract** at activation time. Every component declares what it provides and what it needs. Activation = requirements ∩ capabilities.

```
Strategy activation request:
  symbol: XAUUSD
  protocol: xau-speed-v1
  broker: mt5

System checks:
  ✓ MT5 connected? Yes
  ✓ XAUUSD in symbol registry? Yes  
  ✗ Tick data available? NO — MT5 bridge doesn't stream ticks
  ✗ M1 bars available? NO — BarRefreshService doesn't fetch M1
  → Result: BLOCK. Reason: "xau-speed-v1 requires tick or M1 data.
    Available: 5m, 15m, 1h, 4h, 1d."
```

### Pending vs Blocked

- **BLOCKED**: Requirements can never be met with current setup (missing provider, unsupported symbol). Requires configuration change.
- **PENDING**: Requirements can be met but data hasn't accumulated yet. System auto-queues data fetching. Auto-activates when ready. Escalates to BLOCKED after 24h timeout.

## Component Declarations

| Component | Declares |
|-----------|----------|
| **Strategy** | timeframe, holdingPeriod, requiredDirectives, dataFeeds |
| **Protocol** | directiveGroups, directionMode, recommendedTimeframe, minBars |
| **Directive** | minBars, requiredDataFeeds (DXY, VIX, 10Y, news), readiness |
| **Data Pipeline** | availableTimeframes, barDepth, providerStatus |
| **Broker** | tradableSymbols, executionSpeed, spreadProfile |

## Tasks

### Phase 1 — Declaration Interface
- [ ] Add `requirements` block to Strategy library schema
- [ ] Add `requirements` block to Protocol config schema
- [ ] Add `requiredDataFeeds` to IDirective interface
- [ ] Add `capabilities` endpoint to BarRefreshService (available timeframes/depths)
- [ ] Add `capabilities` endpoint to Provider health (active feeds)

### Phase 2 — Activation Gate
- [ ] Build capability contract check: requirements ⊆ capabilities
- [ ] BLOCK activation with detailed reason when contract fails
- [ ] PENDING state with auto-queue for fetchable data
- [ ] Strategy status: RUNNING / PENDING / BLOCKED / DEGRADED

### Phase 3 — Runtime Monitoring
- [ ] Detect degradation during runtime (provider goes down, data feed stops)
- [ ] Surface degradation warning in UI (banner on strategy card)
- [ ] Pause strategy option when degraded

### Phase 4 — META.Stack Integration
- [ ] Explorer stage shows capability check pass/fail per requirement
- [ ] "Why can't I activate?" diagnostic view

## Docs

- `docs/readiness-tiers.md` — Readiness policy (Layer A)
- `docs/sees-hybrid-scoring.md` — Scoring architecture (Layer C)

## Related

- Layer A (#516): Directive Readiness Tiers
- Layer C: Hybrid Base+Bonus Scoring
