## Objective

**Gold (XAUUSD) is already trading** in auto mode on 4 timeframes (Gold Scalp M5, Gold Day-Trade M15, Gold Swing 1H, Gold Position 4H — all `data=ready`, `mode=auto`). This issue tracks **review of the existing gold stack plus building additional approaches** to test against it.

## Broker context

- Active broker: MetaQuotes-Demo (connected)
- XAUUSD **tradeable** (tradeMode=4)
- Working auto strategies (all `ready`): Gold Scalp M5, Gold Day-Trade M15, Gold Swing 1H, Gold Position 4H
- Not ready: `Gold Scalp` tick (`xau-speed-v1`, pending_bars) — deferred, tracked separately
- Inactive: `Gold Trend Follow (Demo)` (`gold-macro-v1`)

## Tasks (in order)

### Step 1 — Protocol review / build more approaches
- [ ] Review the 4 working gold protocols (`xau-speed-m5/m15/1h/4h`, 16 dirs each)
- [ ] Review `gold-macro-v1` (13 dirs — trend following w/ DXY/macro correlation) — consider activating as a Position stack
- [ ] Review `dxy-sensitivity-v1` (14 dirs) as a gold-overlay approach
- [ ] If a genuinely new approach is warranted, build it (e.g. session-based gold: London/NY open bias)
- [ ] Confirm protocol readiness

### Step 2 — Scoring Strategy
- [ ] Ensure each gold protocol has a linked scoring strategy on the `default` watchlist (discoverable by the loop)

### Step 3 — Trading Strategy
- [ ] Activate additional gold trading strategies (symbol=XAUUSD, broker=mt5, mode=auto) for any new approach
- [ ] Keep the 4 working timeframes running
- [ ] Compare signals across approaches

## Acceptance
- [ ] Gold continues trading in auto mode across the working timeframes
- [ ] Whether to add `gold-macro-v1` Position and/or a new session-based approach is decided (build or reject with rationale)
- [ ] No regression to the existing working stacks
