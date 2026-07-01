# GitHub Issue: Single-Symbol Speed Trading View

## Labels
enhancement, trading, speed-trading, ux, P2

## Why
The Speed Trading page (Q305) handles execution, but traders also need a dedicated single-symbol view optimised for speed trading — rapid timeframe switching, indicator overlays tuned for short timeframes, and a layout designed for split-second decisions. This is a potential offering to users once the plugin generates consistent profits.

## Vision
A dedicated view per symbol that combines:
- Speed-optimised chart (1s/5s/15s/30s/1m timeframes)
- Quick-access indicator panel (RSI, MACD, Volume, ATR — toggle on/off)
- Position and P&L in large, readable numbers
- One-click trade buttons (sized for touch/mouse)
- Session countdown timers (e.g., "US open in 4:32")
- Audio alerts for indicator crossovers (configurable)

## Proposed Layout
```
┌─ Symbol Header ──────────────────────────────────────────────┐
│ ⚡ NVDA  $142.50  ▲ +2.30 (1.64%)    US open in 4:32        │
├─ Chart ───────────────────────────┬─ Trade Panel ────────────┤
│                                   │                          │
│ [1s] [5s] [15s] [30s] [1m]       │ Position: 50 @ $142     │
│                                   │ P&L: +$12.50            │
│ Chart with:                       │                          │
│  - RSI overlay                    │ [BUY $500] [SELL]       │
│  - Volume bars                    │ [Close] [Reverse]       │
│  - Session markers                │                          │
│  - Current price line             │ SL: $141.50  TP: $144   │
│                                   │                          │
├─ Indicator Strip ─────────────────┴──────────────────────────┤
│ RSI: 42 ●  MACD: ▼  Vol: ████  ATR: 0.45  Spread: 0.02     │
└──────────────────────────────────────────────────────────────┘
```

## Features
1. **Timeframe shortcuts** — instant switching, chart updates without reload
2. **Indicator overlays** — RSI, MACD, Bollinger, Volume on the chart (toggleable)
3. **Audio alerts** — "RSI crossed 70", "MACD bearish crossover" (mutable)
4. **Session timers** — countdown to next market open
5. **Template saving** — save current indicator + timeframe setup as a named template
6. **Multi-chart** (future) — split view showing M1 + M5 + M15 simultaneously

## Integration
- Opens from: symbol detail page "Speed Trade" button, or SEES stack right-click
- Shares keyboard shortcut system with main Speed Trading page (Q305)
- Uses same safety features (lockout, pause, confirmations)

## Priority
P2 — marketable feature once core trading is profitable
