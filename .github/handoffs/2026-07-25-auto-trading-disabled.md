---
date: 2026-07-25
area: trading
type: bugfix
---

## What Changed

Disabled 15 auto-mode trading strategies that were placing rogue trades every 2-minute tick. All had `minComposite=3` (effectively "trade on any score"). The automation loop still runs 24/7 for scoring, but no trades auto-execute. Semi-auto strategies still queue for manual confirmation. `AUTO_START_AUTOMATION` remains `true` — the loop auto-starts, it just doesn't auto-trade.

## Files Changed

- `nest/.env` — `AUTO_START_AUTOMATION` unchanged (still `true`)
- DB: `UPDATE trading_strategy SET active = 0 WHERE mode = 'auto' AND active = 1` — 15 rows

**Disabled strategies (all `minComposite=3`):**
- 11 "TEST" strategies: EURUSD, GBPUSD, USDCAD, USDJPY, AUDUSD, NZDUSD, USDCHF, UK100, US30, XAUUSD, SP500
- 4 "Cross" strategies: EUR/CHF, AUD/JPY, GBP/JPY, EUR/JPY

**Still active (semi-auto — safe, require manual confirmation):**
- Default EURUSD, MT5 Technical Core EURUSD, GBPUSD Session, EURUSD Session, CAD Sniper USDCAD, Gold Scalp

## Root Cause Analysis

The rogue trades came from `trading_strategy` table records — NOT from hardcoded code. The `dispatchTrade()` method in `automation-loop.service.ts` checks `strategy.mode === 'auto'` before executing. The 15 strategies had `mode='auto'` and `minComposite=3` (an absurdly low threshold). Any score above 3 triggered a BUY order.

**The scoring threshold system has 3 layers:**
1. Global signal labels: `ENTRY_THRESHOLD=40`, `HOLD_FLOOR=20` in protocol-gating.service.ts
2. Per-protocol style defaults: scalp=75, speed=80, day=65, swing=55, pos=45
3. Per-strategy `tradeThreshold`/`minComposite` from `scoring_strategy` table

The diagram `scoring-gating` was also fixed to reflect this 3-layer architecture (see handoff `2026-07-25-diagram-fixes.md`).

## QA Test Entry

- **area:** Trading / Automation
- **name:** Verify loop scores but does not auto-trade
- **procedure:** Check `/api/automation/status` — `loopEnabled: true`, tickCount incrementing. Check NestJS logs — no "MT5 order:" lines. Verify `GET /api/trading/strategies` — zero `active=true AND mode=auto` strategies.
- **expected:** Loop runs. Scores produced. Zero auto-executed trades. Semi-auto strategies queue in pendingActions.

## Architecture Framework Entry

- **section:** trading
- **summary:** Auto-trading disabled: 15 trading_strategy rows set active=0. Loop auto-starts and scores 24/7. Trade execution requires: (1) strategy.mode='auto', (2) brokerState.tradingEnabled=true, (3) score >= strategy.tradeThreshold. Currently only (2) and (3) can be true, but (1) is false for all strategies — no auto-execution possible. To re-enable: set a specific strategy's active=1 and mode=auto in the DB.
