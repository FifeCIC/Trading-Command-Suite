## Source

`/trading/strategies-index`

## Problem

Three related issues with the strategies index view:

### 1. Symbol/protocol mismatch not visible on cards
Example: "US SPY Speed" uses symbol SPX500, but MT5 doesn't list SPX500 (only SVIX, UVIX ETFs; SPX index is tradeMode=0 disabled). The strategy is permanently stuck in `pending_bars` with no visible indication on the card.

**Expected:** Display an indicator on the strategy card when a requirement isn't being met (e.g., symbol not available, protocol mismatch, broker constraint).

### 2. No "Faulty" filter
The filter bar currently shows: All | Active | Trading | Scoring

**Expected:** Add a "Faulty" filter that shows strategies with known issues (pending_bars, blocked, symbol mismatch, etc.).

### 3. No notification for blocked/pending strategies
The automation loop silently skips strategies stuck in `pending_bars` or `blocked`. There's no toast, Telegram, Discord, or email notification.

**Expected:** Add a `strategy-blocked` notification event type. Consider firing it ~1 minute after app load to give strategies time to initialize, then alert if any active trading strategy has unmet requirements.

## Elements

Strategy card (needs mismatch indicator):
```html
<div class="sl-card">
  US SPY Speed  Trading  SPX500  spy-day-v1  mt5
</div>
```

Filter bar (needs "Faulty" option):
```html
<div class="sl-filter-bar">
  All  Active  Trading  Scoring
</div>
```

## Technical Context

- `automation-loop.service.ts` already annotates each strategy with `dataStatus` (ready/pending_bars/blocked) during every tick
- `NotificationService` supports 4 channels: Windows toast, Telegram, Discord, email
- No existing event type covers blocked strategies — this is a gap
