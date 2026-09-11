# Trading-Enabled Persistence — the silent throughput collapse

**Date:** 2026-09-10
**Area:** `nest/src/modules/automation/*`, `src/pages/ExecutionQueuePage.jsx`
**Impact:** CRITICAL — restored automated execution; corrected a misleading status surface

---

## The fault (measured, not theorised)

| Month | Real trades | Automated |
|---|---|---|
| 2026-07 | 107 | **94** |
| 2026-08 | 10 | 9 |
| 2026-09 | 9 | **1** |

Meanwhile `decision_log` stayed healthy at **215–1,581 decisions/day, every day**.
So scoring was never broken — **execution had silently stopped**. 91% of decisions
were `SCORED`; roughly one reached the broker in a week.

## Root cause

`brokerStates[brokerId].tradingEnabled` was **memory-only**. `initBrokerStates()`
hard-set it to `false` on every boot and **nothing ever restored it** —
`restoreLayerFlags()` persisted only `automation.protocolsEnabled` and
`automation.tradingEnabled`.

Gate 7 requires **both** flags:

```ts
if (!this.state.tradingEnabled || !this.state.brokerStates[b]?.tradingEnabled)  // → paper
```

So the layer flag reading `true` was **meaningless** — the broker flag vetoed every
dispatch. Live proof before the fix:

```
layers.tradingEnabled            = true     ← what the UI showed
brokerStates.mt5.tradingEnabled  = false    ← what actually gated execution
```

**Every backend restart silently disabled automated trading, and nothing turned it
back on.** The 104 historical `origin='strategy'` trades exist only from windows
where the process stayed up and someone re-enabled it by hand. Worse, `paper_trade`
only begins in September — so every blocked dispatch before that left **no record at
all**. The collapse was invisible in the data.

## The fix

1. **Persist the flag** as `global_setting['automation.brokerTrading.<brokerId>']`.
   Written by `persistBrokerTradingFlag()`, called from `POST /api/automation/config`
   and from `emergencyStop()` (so an operator stop survives a reboot and cannot be
   silently undone by one).
2. **Restore it at boot** via `restoreBrokerTradingFlags()`. Default stays **OFF** for
   any broker with no stored value — a fresh install still cannot trade without an
   explicit opt-in. Restoring only restates the user's own last choice.
3. **Name the flag that blocked**, in Gate 7's decision reason:
   `captured as paper — broker mt5 tradingEnabled=false (layer ON)` instead of the
   old catch-all `trading layer OFF`, which was wrong whenever the layer was on.
4. **Expose the effective state**: `status.execution.{willPlaceRealOrders, mode,
   layerTradingEnabled, brokerTradingEnabled}`, plus a boot-time `[TradingState]`
   log line, plus an ExecutionQueuePage chip showing `⚡ Real orders` vs `🧾 paper`.

## ⚠️ Ordering is load-bearing — read before moving this code

`restoreBrokerTradingFlags()` **must be the last word on the flag**, after both
`initBrokerStates()` *and* the mt5 auto-create block. Two earlier placements each
failed **silently while looking correct in the database**:

1. next to `restoreLayerFlags()` → the later `initBrokerStates()` clobbered it;
2. immediately after `initBrokerStates()` → at that point
   `getBrokerageAdapters()` is still empty, so the restore iterated an **empty map**
   and did nothing, and the mt5 auto-create then set it `false` afterwards.

Symptom of both: `global_setting` held `true`, the running flag stayed `false`, and
no error was logged. If you move this call, re-run the restart test below.

## Verification (both directions, after full restarts)

| Test | Result |
|---|---|
| Enable → restart | `restored to true from stored setting` · `mode='live'` · `willPlaceRealOrders=True` |
| Disable → restart | `brokerTradingEnabled {"mt5":false}` · `mode='paper (no broker enabled)'` |

Also verified: `POST /api/automation/config` persists; the boot log prints
`EFFECTIVE MODE = LIVE (real orders will be placed)` or `PAPER ONLY`.

## Still open (not fixed here — separate defects)

- `composite 0 < minComposite 55/60` ×45 — a **missing** score (lineage failure)
  reported as a weak score. Indistinguishable from a genuine low signal.
- `rejected` = 26 of 141 trades (~18%); 20 positions stuck `open`.
- Duplicate guard vs stale positions deadlock (15 blocks) — stale opens suppress
  real signals and nothing reconciles them.
- `Bridge unreachable (no response)` ×48 with no retry.
- Closed P&L −£59.56 across 95 closed trades.
- `AutoTrading disabled by client` ×54 — all dated **2026-09-08 only**, i.e. a
  terminal-side event on that day, not ongoing. Note the flag masked it: with the
  broker flag off, a disabled terminal produces quiet paper rows instead of loud
  failures.

## Lesson for the next agent

A boolean that gates money had **two** representations that could disagree, and the
readable one was not the enforcing one. When a status surface and an enforcement
mechanism are separate values, the status surface will eventually lie — and the
failure mode is silence, because the blocked path was quietly doing the *safe* thing.
