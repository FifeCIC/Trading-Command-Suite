# RUI015 — Exit Signals & Profit-Taking System

**Agent:** tcs-dev
**Area:** Scoring / Trading
**Priority:** P2 — fills major gap (SEES is entry-only)
**Depends on:** SEES scoring pipeline, existing directives

## Problem

SEES is heavily focused on entry signals. No directive explicitly says "exit now" or tracks "profit quality." Traders need to know when to take profit.

## Task

### Phase 1: Exit Urgency Column (Quick Win)
Add an "Exit Urgency" column alongside entry scores in SEES:
```
Symbol  Entry Score  Exit Urgency  Action
NVDA    82           LOW           Hold / Add
EURUSD  65           HIGH          Consider taking profit
XAUUSD  58           MEDIUM        Tighten stop
```

### Phase 2: Exit Directive Category
New directive category: `exit-timing`
- **momentum-exhaustion**: RSI > 70, volume declining while price rising, MACD shrinking
- **target-achieved**: Price at measured move target, ATR-based target, or round number
- **regime-shift**: Market entropy spike, Hurst exponent < 0.5, session ending
- **time-stop**: Position age exceeds optimal hold period

### Phase 3: Portfolio-Level Exits
- Total position exposure exceeds threshold → reduce
- Daily P&L target reached → close day
- Correlation spike between positions → reduce concentrated risk

### Phase 4: Dual-Mode Directives (Future)
Existing directives get optional `calculateExit()` method:
- `rsi-oversold.calculate()` → bullish entry score
- `rsi-oversold.calculateExit()` → "RSI no longer oversold — exit signal"

## Recommendation
Start with Phase 1 (simplest). Build 3 exit-focused directives. If concept proves valuable, expand.
