## Objective

Get the **USDJPY** trading META.Stack working end-to-end on MetaQuotes-Demo. An active trading strategy exists (`Tokyo USDJPY Session`, protocol `forex-session-v1`, mode=semi-auto) but is stuck in `pending_bars` — data is not accumulating. Fix the data path, then switch to auto.

## Broker context

- Active broker: MetaQuotes-Demo (connected)
- USDJPY is **tradeable** on MetaQuotes-Demo (tradeMode=4)
- Symptom: `dataStatus=pending_bars`, reason `Waiting for first bars (5m–1h)`

## Tasks (in order)

### Step 1 — Diagnose bar accumulation (blocking)
- [ ] Investigate why `forex-session-v1` (USDJPY, 5m–1h) is not receiving bars while `eurusd-macro-v1` (EURUSD) is `ready`
- [ ] Check bridge candle endpoint: `GET /api/providers/mt5/candles?symbol=USDJPY&timeframe=m5`
- [ ] Verify bar count in DB / market-data bar cache for USDJPY
- [ ] Fix the data accumulation path (timeframe mapping, symbol registration, or bar fetch interval)

### Step 2 — Protocol
- [ ] Review `forex-session-v1` applicability to USDJPY (session-based mean reversion)
- [ ] Optionally review `usdjpy-risk-v1` (6 dirs) as an alternative/addition
- [ ] Confirm protocol readiness

### Step 3 — Scoring Strategy
- [ ] Ensure scoring strategy links the chosen protocol to a USDJPY watchlist, discoverable by the loop

### Step 4 — Trading Strategy
- [ ] Once data is `ready`, set mode=auto (demo — allow trading freely)
- [ ] Confirm `lastEvaluatedAt` updates and a real signal is produced

## Acceptance
- [ ] USDJPY dataStatus = `ready` (bars accumulating)
- [ ] Strategy in auto mode
- [ ] Automation scores and can execute USDJPY on MetaQuotes-Demo
