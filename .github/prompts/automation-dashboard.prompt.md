# automation-dashboard: Multi-Broker Automation Command Center

**Prompt ID:** automation-dashboard
**Date:** 2026-06-26
**Status:** ready
**Depends on:** `unified-broker-interface.prompt.md`

## Goal

Create a single unified view that shows ALL automation activity across ALL connected brokers. Not a "Trading212 page" — the Automation Dashboard is the cockpit for the entire automated trading system. Trading212, MT5, Alpaca are just tabs within it.

## The Problem

Currently, information is scattered across 5+ pages with no connection between them:
- Portfolio page shows positions but no scores
- Speed Trading page has protocols and charts but no portfolio context
- SEES Live Stack shows scores but doesn't know what you hold
- MT5 Trading page is completely separate from Trading212
- No page shows what the automation IS DOING right now

## The Solution

`/trading/automation` — one page, everything connected.

```
┌──────────────────────────────────────────────────────────────────────────┐
│  AUTOMATION                              [⏸ PAUSE ALL] [⚡ RUN NOW]     │
│                                                                          │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │  BROKER BAR                                                      │    │
│  │  [● MT5: €12,847]  [● T212 Demo: £1,247]  [○ Alpaca: offline]   │    │
│  └─────────────────────────────────────────────────────────────────┘    │
│                                                                          │
├────────────────────────────┬────────────────────────────────────────────┤
│                            │                                            │
│  LIVE TIMELINE             │  ACTIVE STRATEGIES                         │
│  ┌──────────────────────┐  │  ┌──────────────────────────────────────┐  │
│  │ NOW ▸ MT5 scoring    │  │  │ ● momentum-stock-v1                  │  │
│  │       NVDA → 78 ↑    │  │  │   Broker: T212 | Symbols: 12         │  │
│  │       MSTR → 72 ↑    │  │  │   Mode: semi-auto | Last: 14:32      │  │
│  │       ...             │  │  │   ⏸ Cooldown 3m                     │  │
│  │ ───────────────────── │  │  │                                      │  │
│  │ NEXT ▸ T212 scoring   │  │  │ ● xau-speed-v1                       │  │
│  │       in 4m 32s       │  │  │   Broker: MT5 | Symbol: XAUUSD      │  │
│  │ ───────────────────── │  │  │   Mode: manual | Last: 14:29        │  │
│  │ 15:15 ▸ FOMC minutes  │  │  │   ✓ Ready                           │  │
│  │ 15:30 ▸ Oil inventories│  │  │                                      │  │
│  │ 16:00 ▸ Market close  │  │  │ ○ spy-day-v1                         │  │
│  │ Tomorrow ▸ AAPL earn. │  │  │   Broker: T212 | Paused             │  │
│  └──────────────────────┘  │  └──────────────────────────────────────┘  │
│                            │                                            │
│  PORTFOLIO SCORES          │  WHY PANEL                                │
│  ┌──────────────────────┐  │  ┌──────────────────────────────────────┐  │
│  │ T212 Demo       [▼]  │  │  │ NVDA scored 78 — BUY signal          │  │
│  │ ───────────────────── │  │  │                                      │  │
│  │ # NVDA   78 BUY  ↑   │  │  │ speed-momentum    ████████ 92        │  │
│  │ # MSTR   72 BUY  ↑   │  │  │ volume-confirm    ██████   72        │  │
│  │ # PLTR   65 BUY  ↑   │  │  │ rsi-oversold      ████████ 88        │  │
│  │   TSLA   55 HOLD →   │  │  │                                      │  │
│  │   AAPL   48 HOLD →   │  │  │ Risk Gate: ████ PASS (0.85×)        │  │
│  │   AMZN   42 HOLD →   │  │  │ Direction: BUY (bullish momentum)    │  │
│  │   GOOGL  38 HOLD →   │  │  │                                      │  │
│  └──────────────────────┘  │  │ Timeline check: ✓ No earnings        │  │
│                            │  │   within 48h. No FOMC today.         │  │
│  DECISION LOG              │  │                                      │  │
│  ┌──────────────────────┐  │  │ Strategy: momentum-stock-v1         │  │
│  │ 14:32  NVDA  SCORE   │  │  │ Action: QUEUED (awaiting confirm)   │  │
│  │        Composite:78  │  │  └──────────────────────────────────────┘  │
│  │        Signal:BUY    │  │                                            │
│  │        Action:QUEUED │  │  TRADE HISTORY                            │
│  │ ───────────────────── │  │  ┌──────────────────────────────────────┐  │
│  │ 14:28  NVDA  EXEC    │  │  │ 14:28 BUY NVDA @142.30 (T212)       │  │
│  │        Buy 5 @142.30 │  │  │       Score:78 Gate:pass             │  │
│  │        Strategy:mom  │  │  │ 14:15 SELL PLTR @22.15 (T212)       │  │
│  │ ───────────────────── │  │  │       Score:25 Gate:block           │  │
│  │ 14:15  PLTR  REJECT  │  │  │ 14:10 BUY EURUSD @1.0850 (MT5)     │  │
│  │        Gate:block    │  │  │       Score:88 Gate:boost            │  │
│  └──────────────────────┘  │  └──────────────────────────────────────┘  │
│                            │                                            │
└────────────────────────────┴────────────────────────────────────────────┘
```

## Key Panels

### 1. Broker Bar (top)
- Horizontal status bar showing ALL connected brokers
- Green dot = connected + has positions
- Yellow dot = connected but no positions / fallback mode
- Red dot = disconnected / error
- Shows: broker name, account equity, mode (live/demo/paper)
- Click a broker to filter the entire dashboard to that broker

### 2. Live Timeline (left-top)
- **NOW**: What's currently executing (scoring runs, strategy evaluations, order placements)
- **NEXT**: What's scheduled to run next with countdown
- **UPCOMING**: Key events from the timeline (earnings, economic releases, session opens/closes)
- **OPPORTUNITIES**: Protocol activation windows (e.g., "XAU London session opens in 23m")
- Items slide up as they complete; new items appear at the bottom
- Each item is clickable — clicking a running task shows its progress/details

### 3. Active Strategies (right-top)
- Card for each strategy across all brokers
- Shows: protocol, broker, symbols count, mode, last evaluation time, cooldown remaining
- Color-coded: green=active+ready, yellow=active+cooldown, gray=paused
- Click to expand — shows full config, recent evaluations, toggle active/pause
- "Add Strategy" button opens strategy creation modal

### 4. Portfolio Scores (left-middle)
- Tabbed by broker (MT5 | T212 Demo | T212 Live | Alpaca)
- All portfolio symbols ranked by composite score
- Signal badges: BUY (green), SELL (red), HOLD (gray), NO_DATA (dimmed)
- Click a symbol → populates the "Why" panel
- Auto-refreshes every N seconds (configurable per broker)

### 5. Why Panel (right-middle)
- When a scored symbol is clicked, shows the full directive breakdown
- Horizontal bar chart per directive with contribution %
- Risk gate status (pass/block/boost) with multiplier
- Timeline context: "No earnings in 48h. No FOMC today. Seasonality: bullish this hour (68%)."
- Strategy: which strategy would trade this, and what it's waiting for
- Action buttons: [Trade Now] [Add to Watchlist] [Ignore]

### 6. Decision Log (left-bottom)
- Every automation decision, chronologically
- SCORE events (composite calculated), EVALUATE events (strategy checked), EXECUTE events (trade placed), REJECT events (gate blocked)
- Color-coded rows, expandable for full detail
- Filter by broker, strategy, event type
- Auto-scrolls to latest

### 7. Trade History (right-bottom)
- All executed trades across all brokers
- Columns: time, symbol, side, quantity, price, broker, score that triggered it
- Links back to the strategy that executed it

## Automation Controls (top bar)

```
[⏸ PAUSE ALL] — stops all strategies across all brokers
[▶ RESUME ALL] — resumes all paused strategies
[⚡ RUN NOW] — triggers immediate scoring + evaluation cycle
[⚙ CONFIGURE] — opens automation configuration modal
[⏹ EMERGENCY STOP] — kills loop + attempts to close all positions
```

## Responsive Behavior

- On wide screens: 2-column layout as shown
- On narrow screens: single column, panels stack vertically
- Timeline collapses to a horizontal scrolling strip on mobile

## Data Flow

```
Browser ←→ GET /api/automation/status          (every 2s — timeline, strategies, broker status)
Browser ←→ GET /api/automation/portfolio-scores (every 30s or on-demand)
Browser ←→ GET /api/automation/decision-log     (every 5s)
Browser ←→ GET /api/automation/trade-history    (on-demand)
Browser ←→ GET /api/automation/timeline         (every 10s — upcoming events)
Browser  → POST /api/automation/toggle          (pause/resume)
Browser  → POST /api/automation/run-now         (trigger cycle)
Browser  → POST /api/automation/emergency-stop  (kill everything)
Browser  → POST /api/automation/confirm-action  (approve queued trade)
Browser  → POST /api/automation/reject-action   (reject queued trade)
```

## API Endpoints (all new)

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/automation/status` | Full dashboard state (strategies, brokers, loop status) |
| GET | `/api/automation/portfolio-scores` | Scored positions across all/selected brokers |
| GET | `/api/automation/decision-log` | Recent decisions with pagination |
| GET | `/api/automation/trade-history` | Recent trades across all brokers |
| GET | `/api/automation/timeline` | Upcoming events, scheduled runs, opportunities |
| POST | `/api/automation/toggle` | Pause/resume a strategy or all strategies |
| POST | `/api/automation/run-now` | Trigger immediate scoring + evaluation |
| POST | `/api/automation/emergency-stop` | Kill loop, attempt close all positions |
| POST | `/api/automation/confirm-action` | Approve a queued trade |
| POST | `/api/automation/reject-action` | Reject a queued trade |

## Files

- `src/pages/AutomationDashboardPage.jsx` — main page component
- `src/pages/AutomationDashboardPage.css` — styles
- `src/components/automation/BrokerBar.jsx`
- `src/components/automation/LiveTimeline.jsx`
- `src/components/automation/ActiveStrategies.jsx`
- `src/components/automation/PortfolioScores.jsx`
- `src/components/automation/WhyPanel.jsx`
- `src/components/automation/DecisionLog.jsx`
- `src/components/automation/TradeHistory.jsx`
- `nest/src/modules/automation/automation.controller.ts` — all endpoints above
- `nest/src/modules/automation/automation.service.ts` — state management
- `nest/src/modules/automation/automation.module.ts`
