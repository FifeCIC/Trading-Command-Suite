## Pre-close check — the routing defect is FIXED and verified live; one criterion split out and this closes

### Acceptance criteria

- [x] **Measure whether `VIX` and `GER40` have quotes at all** — **they DO.** Measured 2026-10-07 against
      both bridges:

      | symbol | :5000 (broker 2) | :5001 (broker 3) | `symbol_route` |
      |---|---|---|---|
      | VIX   | **404 Not Found** | `bid 16.79 / ask 16.96` | broker **3** |
      | GER40 | **404 Not Found** | `bid 25146.3 / ask 25147.2` | broker **3** |

      So the issue's own fork resolves to **"if yes — this is a defect, not a deactivation"**. Both
      symbols were quoting the whole time; **the app was asking the wrong bridge.**
- [x] **Take the branch the measurement supports** — the fix is `mt5-trading.routed-reads.spec.ts`
      (*"a SYMBOL read must ask the broker that SERVES it"*): `placeOrder()` already resolved `route!.url`,
      but every READ used the bare `bridgeUrl` getter, i.e. the primary. `getSymbolInfo`, `getQuote` and
      `getCandles` now resolve through the router.
- [x] **The outcome is visible** — measured live, 2026-10-07:
      `Cannot evaluate the per-symbol cap` appears **0 times** in `nest/logs/tcs-2026-10-07.log`,
      against **23 (VIX) and 15 (GER40)** on 2026-09-23. And both symbols **EXECUTED** today
      (`decision_log`: VIX ×1, GER40 ×1).
- [ ] **Boundary: quote present but stale ≠ quote absent** — ⚠️ **CANNOT BE MET IN THE APP, and the reason is
      measured, not assumed.** Split to **#1085**: the bridge's `quote.timestamp` is the **answer** time, not
      a trade time (VIX: asked `13:26:19.7`, timestamp `13:26:21`, answered `13:26:21.7`; same shape for
      XAUUSD). With no last-trade time in the payload, a frozen quote is indistinguishable from a live one,
      so `estimatePositionMargin` can only test `price > 0` — **an absent quote refuses, a stale one is
      silently used**. The fix is a bridge-contract change; a client-side heuristic over a self-reported
      timestamp would be a check that always passes.
- [x] **Canary in both directions** — `npx jest src/modules/trading/mt5-trading.routed-reads.spec.ts` →
      **6 passed**. It asserts the **fetched URL**, not that a method was called (a "fetch happened" test
      would pass against the broken code), and it canaries the other direction too: an **unrouted** symbol
      still uses the primary, a route to a **non-MT5** broker falls back rather than throwing, and a
      **missing router** degrades instead of failing. A guard that only proved the routed case would pass
      if the primary were dropped entirely.

### Not done by this closure

Nothing was executed by writing this comment — the fix and its guard landed earlier; this is the
verification against the issue's own acceptance criteria plus the live re-measurement.

⚠️ **One thing this closure does NOT claim.** VIX still has **11 `BLOCKED` decisions today**, and they are a
**different gate** — `Portfolio at risk 18.1% exceeds risk.maxPortfolioRisk 15%`, naming the accountable
positions (AMZN, AVGO). That is the portfolio gate doing its job, not a quote fault, and it is unaffected by
this issue.

**Extracted:** #1085 (the bridge quote has no trade time → stale ≠ absent cannot be rendered).
