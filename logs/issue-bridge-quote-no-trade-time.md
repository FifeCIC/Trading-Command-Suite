# The bridge's quote carries no trade time — so a STALE quote is indistinguishable from a live one

**Split out of #972** (criterion 3: *"quote present but stale is a DIFFERENT condition from quote absent. Both must not render the same"*), where it could not be satisfied — the block is in the bridge's payload, not in the routing the rest of #972 fixed.

---

## The measurement

Two consecutive quotes from `:5001`, each compared against its own request and response times:

| symbol | asked at | `quote.timestamp` | answered at |
|---|---|---|---|
| VIX | 13:26:19.7 | **13:26:21** | 13:26:21.7 |
| XAUUSD | 13:26:21.7 | **13:26:23** | 13:26:23.7 |

`quote.timestamp` tracks the **answer**, not a trade. It is set when the request is handled — the same
mechanism already recorded on **#1068**: the field is a `utc_now_iso()` stamp, so a quote that has not
moved in an hour reports itself as one second old.

## Why that matters — the failure direction is the dangerous one

`estimatePositionMargin()` (`nest/src/common/trading/position-margin.ts`) validates the price it is given:

```ts
if (!Number.isFinite(price) || price <= 0) {
  return { source: 'unavailable', reason: `price is ${price} (no quote for ${symbol})` };
}
```

So there are exactly two outcomes today, and the boundary between them does not exist:

| condition | today's outcome |
|---|---|
| quote **absent** | `unavailable` → the call refuses (*"price is 0 (no quote for VIX)"*) ✅ correct |
| quote **stale** | `price > 0` → **the estimate silently succeeds and sizes the position on the stale price** ⚠️ |

⚠️ **A missing quote is refused; a frozen one is trusted.** That is this repo's most expensive failure
signature — *plausible values, no error* — and it is the opposite of what the instinct behind the refusal
was protecting against.

## What the app cannot do about it, stated plainly

**There is no check the app can add that would work.** Staleness is a claim about a *mechanism* — "something
was supposed to update this and did not" — and answering it needs a **last-trade time**, which the payload
does not carry. Deriving freshness from anything else available would be a guess, and a guess in the sizing
path is worse than the current silence.

So this is a **bridge-contract change**, not an app fix:

1. `GET /quote` should return the broker's own last-tick time for the symbol (MT5 exposes it), **distinct
   from** the response time — e.g. `tickTime` alongside `timestamp`, so nothing reading `timestamp` today
   breaks.
2. Then `estimatePositionMargin` (or its caller) can refuse a quote older than a declared allowance, and
   the two conditions would finally render differently.

⚠️ **Until that exists, do not "fix" this by adding a client-side staleness heuristic.** A threshold
applied to a self-reported timestamp would always pass, which is a check that inspects nothing and reports
OK — worse than no check.

## Not in scope here

The rest of #972 — **the routing defect** (reads asking broker 2 while VIX and GER40 are routed to broker 3)
— is **fixed and guarded**, with 0 per-symbol-cap refusals on 2026-10-07 against 23 and 15 on 2026-09-23.
This issue is only the boundary that could not be met.

---

**Related:** #972 (routed reads — fixed) · #1068 (`utc_now_iso()` stamps) · #865 (the per-symbol cap) · #1035 (a bridge reporting success it did not have)
