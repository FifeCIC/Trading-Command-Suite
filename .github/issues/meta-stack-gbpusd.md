## Objective

Complete the trading META.Stack for **GBPUSD** on MetaQuotes-Demo. Inactive/demo strategies exist (`GBPUSD Session`, `Forex Session GBPUSD (Demo)`, `Forex Cable Scalp (Demo)`); none are established as an active auto trading stack.

## Broker context

- Active broker: MetaQuotes-Demo (connected)
- GBPUSD is **tradeable** on MetaQuotes-Demo (tradeMode=4)
- Protocols available: `forex-session-v1`, `gbpusd-news-v1`, `mt5-technical-core-v1`

## Tasks (in order)

### Step 1 — Protocol
- [ ] Review existing protocols suitable for GBPUSD (`forex-session-v1` has 14 dirs; `gbpusd-news-v1` 7 dirs)
- [ ] Decide: reuse one, or build a dedicated GBPUSD protocol (e.g. news-sensitive cable approach)
- [ ] Confirm protocol readiness (all directives READY)

### Step 2 — Scoring Strategy
- [ ] Ensure a scoring strategy links the chosen protocol to the `default` (or a GBPUSD) watchlist
- [ ] Verify it is discoverable by the automation loop

### Step 3 — Trading Strategy (activate the stack)
- [ ] Activate / create trading strategy: symbol=GBPUSD, broker=mt5, mode=auto
- [ ] Set risk params (baseSize, slPct, tpPct, cooldownMinutes, maxPositions)
- [ ] Confirm data becomes `ready` (bars > required minimum)
- [ ] Confirm `lastEvaluatedAt` updates and a real signal is produced

## Acceptance
- [ ] GBPUSD META.Stack fully wired and active (all 3 layers)
- [ ] Strategy in auto mode, data `ready`
- [ ] Automation scores and can execute GBPUSD on MetaQuotes-Demo
