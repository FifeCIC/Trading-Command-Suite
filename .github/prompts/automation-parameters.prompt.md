# automation-parameters: Protocol, Strategy & Broker Pairing for Automated Trading

**Prompt ID:** automation-parameters
**Date:** 2026-06-26
**Status:** ready
**Depends on:** `unified-broker-interface.prompt.md`, `automation-timeline.prompt.md`

## Goal

Define how protocols, strategies, and brokers are paired for automated trading. Different protocols are designed for different timeframes, styles, and brokers — the automation parameters must respect these differences. This is the configuration layer that sits between the universal loop and individual strategies.

## Protocol → Broker Mapping

Not every protocol works on every broker:

| Protocol | Style | Best Broker(s) | Why |
|----------|-------|----------------|-----|
| `btc-scalp-v1` | Tick Scalp | MT5 | Crypto CFDs, no T212 crypto |
| `xau-speed-v1` | Tick Scalp | MT5 | Gold CFDs w/ tight spreads |
| `oil-speed-v1` | Tick Scalp | MT5 | Oil CFDs |
| `spy-speed-v1` | Tick Scalp | MT5 | Index CFDs |
| `qqq-speed-v1` | Tick Scalp | MT5 | Index CFDs |
| `dow-speed-v1` | Tick Scalp | MT5 | Index CFDs |
| `ftse-speed-v1` | Tick Scalp | MT5 | Index CFDs |
| `tsla-speed-v1` | Tick Scalp | MT5 | Single stock CFD |
| `doge-speed-v1` | Tick Scalp | MT5 | Crypto CFD |
| `china-speed-v1` | Tick Scalp | MT5 | Index CFDs |
| `forex-session-v1` | Session | MT5 | Forex pairs |
| `vix-spike-v1` | Mean Rev | MT5 | VIX CFDs |
| `spy-day-v1` | Day Trade | MT5, T212 | Both support SPY |
| `qqq-day-v1` | Day Trade | MT5, T212 | Both support QQQ |
| `leverage-v2` | Day/Scalp | T212, MT5 | Leveraged ETFs on T212, CFDs on MT5 |
| `momentum-stock-v1` | Day/Swing | T212 | Real stock positions |
| `pandemic-v1` | Event-Driven | T212 | Pharma stocks |
| `default` | Swing | Any | Universal fallback |

The strategy creation UI should filter protocol options based on the selected broker.

## Protocol → Automation Defaults

| Protocol | Score Interval | Trade Threshold | Max Hold | Cooldown | Auto Default |
|----------|---------------|-----------------|----------|----------|-------------|
| `btc-scalp-v1` | 30s | 70 | 5 min | 2 min | OFF |
| `xau-speed-v1` | 30s | 70 | 5 min | 2 min | OFF |
| `oil-speed-v1` | 30s | 70 | 5 min | 2 min | OFF |
| `spy-speed-v1` | 30s | 70 | 5 min | 2 min | OFF |
| `qqq-speed-v1` | 30s | 70 | 5 min | 2 min | OFF |
| `dow-speed-v1` | 1 min | 65 | 10 min | 3 min | OFF |
| `ftse-speed-v1` | 1 min | 65 | 10 min | 3 min | OFF |
| `tsla-speed-v1` | 30s | 70 | 5 min | 2 min | OFF |
| `doge-speed-v1` | 30s | 75 | 3 min | 2 min | OFF |
| `china-speed-v1` | 1 min | 65 | 10 min | 3 min | OFF |
| `forex-session-v1` | 2 min | 60 | 1 hour | 5 min | OFF |
| `vix-spike-v1` | 1 min | 65 | 30 min | 5 min | OFF |
| `spy-day-v1` | 5 min | 60 | 4 hours | 10 min | OFF |
| `qqq-day-v1` | 5 min | 60 | 4 hours | 10 min | OFF |
| `leverage-v2` | 1 min | 65 | 1 hour | 5 min | OFF |
| `momentum-stock-v1` | 5 min | 60 | 1 day | 15 min | OFF |
| `pandemic-v1` | 15 min | 55 | 3 days | 30 min | OFF |
| `default` | 15 min | 55 | 1 week | 30 min | OFF |

**All protocols default to OFF for auto-trading.** The user must explicitly enable.

## Configuration UI

On the Automation Dashboard, click [⚙ CONFIGURE] or expand a strategy card:

```
┌──────────────────────────────────────────────────┐
│  Strategy Configuration                          │
│                                                  │
│  Name: [Momentum Stocks v1______________]        │
│  Protocol: [momentum-stock-v1 ▾]                 │
│  Broker: [Trading212 Demo ▾]                     │
│  Symbol(s): [NVDA, MSTR, PLTR, TSLA, AAPL___]   │
│    💡 Use watchlist: [momentum-stocks ▾]         │
│                                                  │
│  ── Scoring ─────────────────────────────────── │
│  Score Interval: [5 min ▾]                       │
│    Recommended: 5 min for this protocol          │
│  Trade Threshold: [60 ▾]                         │
│    Composite must be ≥ threshold                 │
│                                                  │
│  ── Execution ────────────────────────────────── │
│  Mode: ○ Manual  ● Semi-Auto  ○ Auto             │
│    Manual: Log signals only                      │
│    Semi-Auto: Queue trades for confirmation       │
│    Auto: Execute immediately (with safeties)      │
│                                                  │
│  Base Size: [0.01 lots / 1 share ▾]              │
│  ☐ Use rarity-based sizing                       │
│  Max Size: [0.05 lots / 5 shares]                │
│                                                  │
│  ── Risk ─────────────────────────────────────── │
│  Stop Loss: [2.0]%                               │
│  Take Profit: [3.0]%                             │
│  Cooldown: [15] min between trades               │
│  Max Positions: [3]                              │
│  Max Daily Trades: [10]                          │
│  Max Loss Per Trade: [$50.00]                    │
│                                                  │
│  ── Timeline Awareness ───────────────────────── │
│  ☑ Pause during FOMC/NFP/CPI events              │
│  ☑ Gate symbols with earnings in [48] hours      │
│  ☑ Boost during active session windows           │
│  ☑ Use seasonality data (hour×day win rates)     │
│                                                  │
│  ── Status ───────────────────────────────────── │
│  ☐ Active (enable this strategy)                 │
│                                                  │
│  [Save] [Cancel] [Delete Strategy]               │
└──────────────────────────────────────────────────┘
```

## Safety Limits (Per Broker)

| Parameter | MT5 | Trading212 | Alpaca |
|-----------|-----|------------|--------|
| Max position size | 5% of equity | 10% of portfolio | 5% of equity |
| Max concurrent positions | 3 | 5 | 3 |
| Max daily trades | 10 | 5 | 10 |
| Min account equity | €500 | £100 | $500 |

## Timeline-Aware Parameters

The timeline adjusts these in real-time:

| Timeline Event | Effect | Duration |
|---------------|--------|----------|
| FOMC minutes | Risk multiplier 0.5×, all thresholds +10 | 2h window |
| NFP release | Risk multiplier 0.3×, all thresholds +15 | 1h window |
| CPI release | Risk multiplier 0.5×, all thresholds +10 | 1h window |
| Earnings (held symbol) | Block trading 48h before, resume 2h after | 50h window |
| Earnings (not held) | Boost score if protocol matches | Day of |
| Session open (matching protocol) | Boost multiplier 1.2× | First 2h |
| Seasonality bullish window | Reduce threshold by 5 | Active hour |
| Seasonality bearish window | Increase threshold by 10 | Active hour |

## Database Schema Additions

```prisma
model AutomationConfig {
  id              String   @id @default(uuid())
  
  // Per-broker settings
  brokerId        String
  enabled         Boolean  @default(false)
  tradingEnabled  Boolean  @default(false)
  scoreIntervalMs Int      @default(300000)
  tradeThreshold  Int      @default(65)
  requireConfirmation Boolean @default(true)
  
  // Timeline awareness
  pauseOnHighImpactEvents Boolean @default(true)
  earningsGateHours        Int     @default(48)
  useSeasonalityData       Boolean @default(true)
  boostSessionWindows      Boolean @default(true)
  
  // Limits
  maxDailyTrades   Int     @default(10)
  maxConcurrentPos Int     @default(3)
  maxLossPerTrade  Float   @default(50.0)
  
  updatedAt DateTime @updatedAt
}

// Add to TradingStrategy model:
// brokerId         String   @default("mt5")
// cooldownMinutes  Int      @default(5)
// maxPositions     Int      @default(3)
// maxDailyTrades   Int      @default(10)
// maxLossPerTrade  Float    @default(50.0)
// pauseOnEvents    Boolean  @default(true)
// earningsGateHours Int     @default(48)
// useSeasonality   Boolean  @default(true)
```

## Files

- `nest/src/modules/automation/automation-config.service.ts` — config CRUD
- `nest/src/modules/automation/automation-config.controller.ts` — or merged into automation.controller
- `nest/prisma/schema.prisma` — `AutomationConfig` model, `TradingStrategy` additions
- Frontend: strategy configuration modal/panel in `AutomationDashboardPage.jsx`
