## Objective

Complete the trading META.Stack for **USDCAD** on MetaQuotes-Demo. Inactive/demo strategies exist (`USDCAD Forex Session`, `Forex Session USDCAD (Demo)`, `Forex CAD Scalp (Demo)`); the active one is now live in auto mode.

## Broker context

- Active broker: MetaQuotes-Demo (connected)
- USDCAD is **tradeable** on MetaQuotes-Demo (tradeMode=4)
- Protocols available: `forex-session-v1`, `usdcad-oil-v1`, `mt5-technical-core-v1`

## Tasks (in order)

### Step 1 — Protocol
- [ ] Review existing protocols suitable for USDCAD (now using `forex-session-v1`; `usdcad-oil-v1` 6 dirs is an oil-correlation alternative)
- [ ] Decide: reuse one or build a dedicated USDCAD protocol
- [ ] Confirm protocol readiness (all directives READY)

### Step 2 — Scoring Strategy
- [ ] Ensure a scoring strategy links the chosen protocol to the `default` (or a USDCAD) watchlist
- [ ] Verify it is discoverable by the automation loop

### Step 3 — Trading Strategy (activate the stack)
- [ ] Activate / create trading strategy: symbol=USDCAD, broker=mt5, mode=auto
- [ ] Set risk params (baseSize, slPct, tpPct, cooldownMinutes, maxPositions)
- [ ] Confirm data becomes `ready` (bars > required minimum)
- [ ] Confirm `lastEvaluatedAt` updates and a real signal is produced

## Acceptance
- [ ] USDCAD META.Stack fully wired and active (all 3 layers)
- [ ] Strategy in auto mode, data `ready`
- [ ] Automation scores and can execute USDCAD on MetaQuotes-Demo
