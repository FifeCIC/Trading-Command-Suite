## Follow-up: the "13 unmappable rows" claim was WRONG — fixed, and all 13 attributed

The owner pressed the button and got **Recovered 0 of 60**. Chasing that found a real defect in *my* diagnosis from earlier today, not just a stale number.

### What was claimed vs what was measured

| Earlier claim (this issue) | Measured reality |
|---|---|
| "13 rows re-read but stay unattributed — their closing deals carry **no reason the app can map**" | ❌ **FALSE.** Every one of those 13 closes carried **reason 4 (SL)** in the terminal, with its exit price — plain as day. The resolution simply never reached those deals. |

### Root cause (measured, not deduced)

A repair re-derivation ran for each of the 13 and logged:

```
repair re-derivation — XAUUSD ticket=152733639383: deals=25 byPosition=0 candidates=0 exitDeals=0 dealReason=unset
```

`candidates=0` is the tell. For a row whose `brokerTicket` is an **ORDER** id, the only bridge to its position is the **opening deal** — and that deal was being **dropped by `getDeals`' `time >= since` filter**: `openedAt` is the app's *first-sighting* time, while the broker stamps the fill *earlier*. The closing deal (reason 4) sat in the same response, unreachable.

Two things made this fixable in one pass:
1. **Permanent repair re-derivation diagnostics** (`position-sync.service.ts`, allowClosed-only) — one log line per repair showing fetch counts + raw reason/comment. Added specifically because deduction had failed repeatedly.
2. A mirror script replicating the finaliser's resolution against the live terminals — which proved the deals *were* there and localised the loss to the window.

### The fix

- **`DEAL_LOOKBACK_GRACE_MS`** (2 days) applied to the `since` argument **only when the row carries a ticket** — exact ticket/position matching cannot be corrupted by extra deals, while the unticketed symbol-fallback keeps the narrow window (its `symbolFallbackSafe` lifecycle count depends on the returned set). Both halves are spec'd.
- The recovery note no longer asserts a cause it did not measure — the "no reason the app can map" wording is gone; it now states only that rows were re-processed and the gap remains.

### Verified live

| Measure | Before | After |
|---|---|---|
| `broker:unknown` rows | 60 | **47** |
| Total gaps | 171 | **158** |
| This press | recovered 0 of 60 | **recovered 13 of 60 — every served row attributed** |

The 13 now read `broker:sl` @ 4075.08 (volume-split P&L per #1014) and one `user:manual` — real exits, real prices.

### Guards

- Reap spec: ⭐ "looks BEFORE openedAt when a ticket exists" + "keeps the NARROW window when there is no ticket" (the repair pass *refuses* unticketed rows — observed in its own log line — so the narrow case is driven through the sync path).
- ⚠️ The first version of the grace case was **impossible to fail**: it asserted `openedAt - DEAL_LOOKBACK_GRACE_MS`, so zeroing the constant moved both sides of the equality. The canary caught it (M3 produced 1 failure where 2 were expected). Now asserted as a property (`window ≥ 1 day before sighting`).
- Canary is now **M1 + M2 + M3**, both directions, restore byte-for-byte: `CANARY PASS` · 13/13 + 10/10 restored.

### Residual (unchanged, and now honestly stated in the button's own note)

- **47** rows: all Pepperstone (broker-3) families — genuinely beyond that terminal's ~3-day deal history. The old manual ritual remains a last resort; the app now says so when pressed instead of implying a retry will help.
- **111** rows: no broker ticket at all — nothing to chase.

The earlier delivery comment's "honest state now" block is superseded by this one. Register row 72 updated with the correction, kept visible rather than silently edited.
