## Objective

Establish a complete trading META.Stack for **NZDUSD** on MetaQuotes-Demo (the only working broker). Full chain: Protocol → Scoring Strategy → Trading Strategy.

## Broker context

- Active broker: MetaQuotes-Demo (connected, balance $1,368)
- NZDUSD is **tradeable** on MetaQuotes-Demo (tradeMode=4)
- No NZDUSD trading strategy exists yet — full stack needed.

## Tasks (in order)

### Step 1 — Protocol
- [ ] Review existing protocols suitable for NZDUSD (candidates: `forex-session-v1`, `mt5-technical-core-v1`, `dxy-sensitivity-v1`, `commodity-pairs-v1`)
- [ ] Decide: reuse an existing protocol or create a NZDUSD-specific one
- [ ] If new: define directive groups (technical / sentiment / risk), direction mode, recommended timeframe
- [ ] Confirm protocol readiness (all directives READY, no ALPHA)

### Step 2 — Scoring Strategy (watchlist + protocol pair)
- [ ] Create scoring strategy linking the protocol to a watchlist containing NZDUSD
- [ ] Set weight strategy (group-weighted or maxscore-weighted)
- [ ] Confirm the pair is discoverable by the automation loop

### Step 3 — Trading Strategy (execution)
- [ ] Create trading strategy: symbol=NZDUSD, broker=mt5, protocolId=<chosen>
- [ ] Set risk params (baseSize, slPct, tpPct, cooldownMinutes, maxPositions)
- [ ] Set mode=auto (demo account — allow trading freely)
- [ ] Confirm data becomes `ready` (bars accumulating > required minimum)
- [ ] Confirm `lastEvaluatedAt` updates and a real signal is produced

## Acceptance
- [ ] NZDUSD META.Stack fully wired (all 3 layers)
- [ ] Strategy in auto mode, data `ready`
- [ ] Automation produces live scores and, when threshold met, executes on MetaQuotes-Demo
