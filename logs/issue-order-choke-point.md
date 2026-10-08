## The gap, stated as a failure that already happened

The repo has a **bridge-level** order choke point and it works:

> `validate-bridge-order-choke-point.cjs` — *"EVERY order the MT5 bridge sends passes ONE gate (#1035)"*. It asserts `mt5.order_send()` appears **exactly once**, inside `order_send_checked()`, and **fails the build** if a new call site bypasses it.

**There is no equivalent at the application level.** Measured 2026-10-07: `dispatchSideTrade()`
(`ab-test.service.ts:407`) reaches `adapter.placeOrder()` by going

```
tradeMode check  →  adapterFactory.create(brokerId)  →  adapter.placeOrder(...)
```

**skipping the signal queue and the duplicate guard** — two of the four gates every other trade passes.
Nothing failed, nothing warned, and it ran live for two days.

Owner ruling, 2026-10-07:

> *"There should only be ONE pipeline from symbol registration to order closing… This requirement will not
> change unless I specifically state that we need another route to the point of order placement."*

## What this issue is

**The guard that makes that ruling enforceable.** A validator that FAILS THE BUILD when a new call site
reaches an order-placing adapter method without traversing the pipeline — the same shape as the bridge
choke point, one layer up.

The bridge guard's own reasoning is the argument for this one:

> *"A hand-maintained route allowlist drifts: a new endpoint is added, nobody adds it to the list, and the
> gap is silent. Keying on the thing every order route must do — send an order — makes the check
> impossible to forget."*

## Approach — key on the ACTION, not on a list of callers

Enumerate every method that ultimately places an order (`placeOrder` and any sibling on the adapter
interface), then assert that each call site is either:

1. **inside the pipeline** — reached from the queue/dispatch path where the duplicate guard has run; or
2. **declared** in a small, reasoned allowlist (the manual-trade endpoint is the likely legitimate
   exception), with the reason and the owning decision recorded beside it.

⚠️ An allowlist entry with no test proving the path is deliberate is how this becomes a decoration. Each
entry needs its reason the way `validate-schema-safety.cjs` requires one for an unmodelled table.

## ⚠️ What it would NOT have caught, stated so it is not oversold

A file-level text scan cannot see runtime order — it can see that a **call site exists outside the
pipeline**, which is the A/B case. It cannot see a path that *looks* pipeline-shaped but skips a gate
inside. So this is a **structural** guard, and it needs a behavioural sibling (or a canary) for the
runtime claim.

## Why this matters more than one defect

The owner names this as the project's biggest fear:

> *"This projects biggest fear is additional paths to trading that skips parts of the process we've
> designed."*

The pattern was not malice — it was an agent solving a local problem without walking the pipeline. A guard
that fires at build time converts *"remember the architecture"* (which failed) into **"you cannot forget
it"** (which is enforceable). This is the repo's own rule: **close the class, not the instance.**

## Related

- **#965 P0** — the live A/B path stops placing orders unless the pair holds two bound accounts, and then
  only through the pipeline. **This issue is the guard that keeps P0 true.**
- **#714** — Unified signal pipeline (the design this protects)
- **#1035** + `validate-bridge-order-choke-point.cjs` — the working precedent, one layer down
- **#1075 / #1077** — two directives that were silently inert; the same *"nothing failed, so nobody looked"* shape
