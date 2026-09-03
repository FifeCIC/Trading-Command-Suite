# Trading Command Suite — User Guide

Comprehensive guide to the Trading Command Suite application.

---

## Overview

Trading Command Suite is a trading analysis platform combining a **NestJS backend** with real-time scoring directives and a **React PWA frontend** with dashboards and management tools.

### What It Does
- Scores symbols using 30+ technical directives (RSI, MACD, Bollinger, ADX, etc.)
- Ranks symbols by composite SEES score
- Manages symbols, watchlists, and data imports
- Monitors provider health and data freshness
- Provides architecture framework for system understanding

---

## Navigation

### Scoring Area
| View | Purpose |
|---|---|
| **Overview** | System-level scoring health: distribution, freshness, top symbols |
| **Directives** | Manage and view scoring directives |
| **Directive Status** | Implementation progress and weight distribution |
| **Configure Directives** | Adjust directive weights and thresholds |
| **Algorithm Lab** | Test directive combinations |
| **Create Strategies** | Build custom scoring strategies |
| **Manage Strategies** | Edit and activate strategies |
| **View Strategies** | Browse saved strategies |
| **Scoring Runs** | Historical scoring run logs |
| **Developer Mode** | Advanced scoring debugging |

### Data Area
| View | Purpose |
|---|---|
| **Symbols** | Browse and search all symbols |
| **Active Symbols** | Manage active/inactive symbols for scoring |
| **Import Jobs** | View and trigger data imports |
| **Provider Health** | Monitor API provider status |
| **API Endpoints** | Catalog of all backend endpoints |

### Trading Area
| View | Purpose |
|---|---|
| **SEES Live Stack** | Real-time ranked symbols with scores |
| **Manual Trading** | Trading platform integration |
| **Positions Monitor** | Active position tracking |
| **Trade Journal** | Record and review trades |

> ⚠️ **Navigation note (2026-09-03):** the app's navigation has grown well beyond the three areas
> listed above (12 areas / ~100 views now: Signals, Protocols, Trading Bots, Automation, Scoring,
> Data, Research, etc.). Use the in-app sidebar and the Architecture Framework page
> (`/builder/architecture-framework`) for the current structure. This section predates the current nav.

---

## Interpreting SEES Scores

### Score Range: 0–100
- **81–100**: Strong conviction — multiple directives aligned
- **61–80**: Entry zone — meets entry threshold (60)
- **41–60**: Watch zone — meets watch threshold (40)
- **21–40**: Defensive — limited conviction
- **0–20**: Avoid — bearish or no signal

### Signal Classes
- **Entry**: Score ≥ 60 — confident long
- **Watch**: Score 40–59 — monitor for improvement
- **Defensive**: Score < 40 — weak or bearish

### Freshness Status
- **Fresh**: Data updated within threshold (1h market hours)
- **Stale**: Data older than threshold
- **Missing**: No market data available
- **Deterministic**: Fallback mode — hash-based scores

---

## Architecture Framework

The Architecture Framework page provides system-level documentation:

- **Status snapshot**: Overall health and system mode
- **Decision workflow**: How architecture decisions are made
- **Contract register**: API contracts and service boundaries
- **Directive library catalog**: Complete directive inventory
- **Owner directory**: Component ownership matrix

---

## Provider Health

Monitor the status of data providers (10+ registered adapters as of 2026-09-03):

- **MT5**: live execution broker (healthy in local dev)
- **Alpaca**: market data + paper trading; becoming the **primary stock-trading broker** (epic #697)
- **Yahoo / Polygon / Finnhub / TwelveData / FMP / Binance / Capital.com / Interactive Brokers**: data + provider adapters
- **Trading 212**: development discontinued (issue #696) — retained in the registry only

Each provider shows: adapter type, credential status, health status, and latency. MT5 + Alpaca are
broker adapters; the rest are data providers.

---

## Modes

### Fallback Mode (default in local dev)
- `"mode":"fallback"` in `/api/health` = Redis/queue unavailable — this is NORMAL locally
- The MySQL database stays connected and the API works normally
- Do not restart NestJS to "fix" fallback mode

### Full Mode
- With MySQL connected and providers configured (MT5, Alpaca, etc.) scores come from real market data

---

## Keyboard Shortcuts

| Key | Action |
|---|---|
| `Ctrl+K` | Quick search |
| `F5` | Refresh current view |
| `Ctrl+Shift+D` | Toggle dev overlay |

---

## Troubleshooting

### "Could not reach the scoring pipeline"
The NestJS backend isn't running. Start with:
```bash
npm --prefix nest run start:dev
```

### Scores are all the same
You're in fallback mode. Seed market data or connect Alpaca for real scores.

### Database errors
Verify MySQL is running and `nest/.env` has the correct `DATABASE_URL`.
