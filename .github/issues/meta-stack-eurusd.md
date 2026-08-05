## Objective

**EURUSD is already trading** in auto mode (strategy `London EURUSD Macro`, protocol `eurusd-macro-v1`, data `ready`). This issue tracks **review of the existing stack plus building additional approaches** to strengthen/compare EURUSD trading — not a from-scratch build.

## Broker context

- Active broker: MetaQuotes-Demo (connected)
- EURUSD **tradeable** (tradeMode=4), data `ready` (201/35 bars)
- Existing active strategy: `London EURUSD Macro` (mode=auto)
- Existing inactive strategies: `Default EURUSD`, `MT5 Technical Core - EURUSD`, `EURUSD Session`, `Forex Session EURUSD (Demo)`, `Forex Session Scalp (Demo)`

## Tasks (in order)

### Step 1 — Protocol review / build more approaches
- [ ] Review `eurusd-macro-v1` (10 dirs — rate-differential / macro-driven)
- [ ] Review `forex-session-v1` (14 dirs — session mean reversion) as an alternate EURUSD approach
- [ ] Review `mt5-technical-core-v1` (30 dirs) as a technical alternative
- [ ] If a genuinely new approach is warranted (e.g. London-open breakout or volatility filter), build a new EURUSD protocol
- [ ] Confirm protocol readiness for whichever is used

### Step 2 — Scoring Strategy
- [ ] Ensure each protocol to be evaluated has a linked scoring strategy on the `default` watchlist (discoverable by the loop)

### Step 3 — Trading Strategy
- [ ] Activate an alternate EURUSD trading strategy (symbol=EURUSD, broker=mt5, mode=auto) if a new approach is added
- [ ] Keep the working `London EURUSD Macro` running
- [ ] Compare signals across approaches once multiple are live

## Acceptance
- [ ] EURUSD continues trading in auto mode
- [ ] At least one additional approach is either rejected with rationale or built and live
- [ ] No regression to the existing working stack
