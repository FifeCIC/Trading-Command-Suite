# automation-parameters: Protocol & Strategy Pairing for Automated Trading

**Prompt ID:** automation-parameters
**Date:** 2026-06-25
**Status:** ready

## Goal

Define how protocols and strategies are paired for automated trading. Different protocols are designed for different timeframes and styles — the automation parameters must respect these differences. A 5s scalp protocol needs a different loop interval than a daily position protocol.

## Protocol → Automation Mapping

| Protocol | Style | Score Interval | Trade Threshold | Max Hold | Auto-Trade Default |
|----------|-------|---------------|-----------------|----------|-------------------|
| `btc-scalp-v1` | Tick Scalp | 30s | 70 | 5 min | OFF (high risk) |
| `xau-speed-v1` | Tick Scalp | 30s | 70 | 5 min | OFF |
| `oil-speed-v1` | Tick Scalp | 30s | 70 | 5 min | OFF |
| `spy-speed-v1` | Tick Scalp | 30s | 70 | 5 min | OFF |
| `qqq-speed-v1` | Tick Scalp | 30s | 70 | 5 min | OFF |
| `dow-speed-v1` | Tick Scalp | 1 min | 65 | 10 min | OFF |
| `ftse-speed-v1` | Tick Scalp | 1 min | 65 | 10 min | OFF |
| `tsla-speed-v1` | Tick Scalp | 30s | 70 | 5 min | OFF |
| `doge-speed-v1` | Tick Scalp | 30s | 75 | 3 min | OFF |
| `china-speed-v1` | Tick Scalp | 1 min | 65 | 10 min | OFF |
| `forex-session-v1` | Session | 2 min | 60 | 1 hour | OFF |
| `vix-spike-v1` | Mean Rev | 1 min | 65 | 30 min | OFF |
| `spy-day-v1` | Day Trade | 5 min | 60 | 4 hours | OFF |
| `qqq-day-v1` | Day Trade | 5 min | 60 | 4 hours | OFF |
| `leverage-v2` | Day Trade/Scalp | 1 min | 65 | 1 hour | OFF |
| `momentum-stock-v1` | Day Trade/Swing | 5 min | 60 | 1 day | OFF |
| `pandemic-v1` | Event-Driven | 15 min | 55 | 3 days | OFF |
| `default` | Swing | 15 min | 55 | 1 week | OFF |

Note: ALL protocols default to OFF for auto-trading. The user must explicitly enable each one.

## Configuration UI

On the Trading212 dashboard, the automation config panel:

```
┌──────────────────────────────────────────┐
│  Automation Configuration                │
│                                          │
│  Protocol: [default ▾]                   │
│  Strategy: [momentum-stock-v1 ▾]         │
│                                          │
│  Score Interval: [5 min ▾]              │
│    (Recommended: 5 min for this style)   │
│                                          │
│  Trade Threshold: [60 ▾]                 │
│    Composite must be ≥ threshold         │
│                                          │
│  ☐ Require confirmation before trade    │
│    (Queue action, wait for UI approval)  │
│                                          │
│  ☐ Enable automated trading             │
│    ⚠ Must be explicitly enabled          │
│                                          │
│  Max positions: [3]                      │
│  Max daily trades: [10]                  │
│  Max loss per trade: [$50]              │
└──────────────────────────────────────────┘
```

## Strategy Pairing Logic

When the user selects a protocol, the system suggests the best matching strategy:

```typescript
function suggestStrategy(protocolId: string): string {
  const style = PROTOCOL_REGISTRY[protocolId]?.tradingStyle;
  if (style?.includes('Scalp')) return 'scalp-strategy';
  if (style?.includes('Day Trade')) return 'day-trade-strategy';
  if (style?.includes('Swing') || style?.includes('Position')) return 'swing-strategy';
  if (style?.includes('Event')) return 'event-strategy';
  return 'default-strategy';
}
```

## Safety Limits (Per Protocol)

| Parameter | Scalp | Day Trade | Swing |
|-----------|-------|-----------|-------|
| Max position size (% of portfolio) | 1% | 2% | 5% |
| Max concurrent positions | 2 | 3 | 5 |
| Max daily trades | 20 | 10 | 3 |
| Stop loss (% of entry) | 0.5% | 2% | 5% |
| Take profit (% of entry) | 1% | 3% | 8% |

## Integration with Dashboard

The automation config is stored in the DB and survives restarts. On app startup, the loop reads the config and starts automatically if enabled. The dashboard shows the current config and allows live changes without restarting.

## Files

- `nest/src/modules/automation/automation-config.service.ts` — config CRUD
- Updates to `automation.service.ts` — respect per-protocol limits
- Frontend config panel in `Trading212DashboardPage.jsx`
