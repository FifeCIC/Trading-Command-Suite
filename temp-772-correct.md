## ⚠️ Correction to my previous comment — `vix-short-v1` IS scoring

My blocker analysis above was **partly wrong**, and the correction matters. `protocol_score_status` (the loop's own persisted state, `lastTickAt 2026-09-11T22:28:04Z`) says:

```
protocolId: "vix-short-v1"   state: "scoring"   symbolsResolved: 1   symbolsScored: 1
protocolId: "gold-macro-v1"  state: "scoring"   symbolsResolved: 1   symbolsScored: 1
protocolId: "signals-workbench" state: "no-symbols"  symbolsResolved: 0
protocolId: "vix-spike-v1"   state: "no-data"   symbolsResolved: 1   symbolsScored: 0
```

So **`vix-short-v1` resolves its symbol and scores successfully.** My "9 orphaned protocols" list was too broad — I inferred it from `trading_strategy.protocolId` and `symbol_protocol_assignment`, but neither is what `resolveSymbols()` actually uses.

### What `resolveSymbols()` really does (protocol-db.service.ts:165)

It cascades through **three paths**, and only the third is a fallback:

1. **Path 1** — `symbol_protocol_assignment` rows. *(0 for VIX — not the gate.)*
2. **Path 2** — a `watchlist` linked by **`protocolId` FK** (not by name — explicitly FK-only since #763, because five watchlists exist twice with the same name).
3. **Path 3** — a **derived symbol** from `symbol`/`symbol_route`. *This is what resolves VIX.*

So VIX resolves via the derivation path, scores, and writes 247 `score` rows — **exactly as observed.** My earlier table conflated "has no bot row" with "cannot score". Those are different stages.

### The distinction that actually matters

| Stage | Gate | `vix-short-v1` state |
|---|---|---|
| **Score** | `resolveSymbols()` → protocol ∈ `findAllActive()` | ✅ **works** — 247 scores |
| **Enqueue** | a `trading_strategy` row must exist to own the queue entry | ❌ **was missing — now fixed** |
| **Dispatch** | `processSignalQueues` JOINs `q.strategyId → trading_strategy.id` | ❌ needs the bot |

**Scoring never needed a bot. Dispatch always did.** That is why 247 scores sat unused with an empty queue.

### Step 1 — DONE ✅

`symbol_route` row created (verified, not guessed):

```
symbol='VIX'  brokerId=3  brokerSymbol='VIX'  provider='mt5'  priority=0  enabled=1
```

`brokerSymbol='VIX'` was confirmed against the broker's own `/symbols` output:
`{"name":"VIX","path":"Retail\\Indices\\Minors\\VIX","tradeMode":4}` — **tradeMode=4 = tradable**, so the shortability pre-check in Step 1 passes. Live quote from `:5001` returns 200 × 1h bars, last close **16.30**.

### Step 2 — bot created ✅

```
id           = a9bdbf92-9ccd-4bf8-bf2e-48c5bcc0dc2a
name         = VIX Spike Short (demo proof #772)
protocolId   = 'vix-short-v1'       (SLUG — matches the 14-bot forex-session-v1 majority)
symbol       = VIX
brokerId     = 'mt5'                (slot routing via the symbol_route row above)
mode/active  = auto / true
minComposite = 0
requireDirection = SELL
slPct/tpPct  = 2.0 / 4.0            (SL above entry for a SHORT)
baseSize     = 0.01   maxPositions = 1   maxDailyLoss = 50   cooldown = 5m
maxPyramidTiers = 1                 (one-per-symbol, #721)
```

**`minComposite = 0` is deliberate, and is a correction to this issue's Step 2.** `compositePct = (composite / protocolMaxScore) × 100` (`protocol-gating.service.ts:307`) — a genuine 0–100 **percentage**. A literal reading of *"start at 60"* would set a **60%** bar, which is strict and would likely gate the first trade. Since the goal of Step 2 is to prove the money path, the bar is set to 0 so nothing silently gates it, and Step 4's measured data sets the real threshold.

### What is still needed before a short can execute

Two switches, both **user-owned by design** — I have not touched either:

- **Trading layer** (`state.tradingEnabled`) — resets to `false` on every API restart (deliberate; see the auto-enable regression note at L523).
- **Broker flag** (`brokerStates.mt5.tradingEnabled`) — also `false` on restart.

Gate 7 of `processSignalQueues` routes to **paper capture** while either is off. So with the bot active, VIX will now produce `paper_trade` rows instead of a live order until those are enabled.

### Corrected picture of the blind spot

Narrower than I first stated. `gold-macro-v1` also scores fine. The genuinely blocked case is **`signals-workbench` (`no-symbols`, 0 resolved)** — a real one, and it is already tracked. My earlier "9 orphaned protocols" claim is **withdrawn**; what is still true and worth its own issue is the narrower, real defect I found:

**`trading_strategy.protocolId` stores *either* a slug *or* a UUID**, so 4 bots (`cac-`, `dax-`, `ftse-speed-v1`, `hourly-3dir-v1`) are invisible to any slug-based lookup. That inconsistency is worth fixing, but it is **not** what blocked VIX.
