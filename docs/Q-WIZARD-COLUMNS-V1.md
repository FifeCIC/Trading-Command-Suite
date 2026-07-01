# Q-WIZARD-COLUMNS-V1 — Column-Based Adaptive Trading Wizard (3-Screen)

**Agent:** react-ui-agent
**Area:** Trading / UI
**Priority:** Medium — design phase
**Depends on:** Q-MULTISCREEN-V1, Strategy Wizard, SEES pipeline

## Objective

Design a 6-column wizard distributed across 3 physical 24" screens (2 columns per screen). Data flows left-to-right across the screens. Each column is a step in the trading lifecycle. The wizard adapts — dimming irrelevant columns based on earlier selections.

This is a guided, fixed-sequence view, distinct from the free-form multi-screen dashboard. The wizard pulls all primary tools into one cohesive flow.

## Background

Users currently navigate between 10+ isolated pages to complete the trading lifecycle. The wizard presents the steps in a fixed visual sequence, distributed across screens so the user can see the entire pipeline at once without scrolling or tab-switching.

## Screen Distribution (6 Columns × 3 Screens)

```
SCREEN 1 (left):       SCREEN 2 (center):      SCREEN 3 (right):
1. STRATEGY SELECTION   3. SEES RESULTS          5. PORTFOLIO & POSITIONS
2. AUTOMATION STATUS    4. TRADING ACTIVITY      6. SUMMARY & P&L
```

### Column Details
1. **Strategy Selection** — Choose SEES strategy, watchlist, risk profile
2. **Automation Status** — Loop on/off, MT5/T212 status, queue health
3. **SEES Results** — Ranked symbols with scores, directive breakdowns
4. **Trading Activity** — Open orders, pending confirmations, execution log
5. **Portfolio & Positions** — Current positions, balance, equity
6. **Summary & P&L** — Daily P&L, win rate, best/worst trades
