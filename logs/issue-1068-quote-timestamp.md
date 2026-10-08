## Same class, second instance — the QUOTE path fabricates its timestamp too

Measured 2026-10-07 while investigating why the A/B runner reported `composite=0`.

### Instance 1 — the bridge

`scripts/mt5-bridge/mt5_bridge_v2.py`, the `/quote` handler:

```python
return json_response(self, {'symbol': symbol, 'bid': tick.bid, 'ask': tick.ask,
                            'last': tick.last or tick.bid,
                            'timestamp': utc_now_iso()})   # ← generated at REQUEST time
```

It reads MT5's last tick — but stamps it with **the moment we asked**, not the moment the tick occurred.

### Instance 2 — the app, on top of it

`nest/src/modules/scoring/quote.gateway.ts`, `pollAndEmit()`:

```ts
const tick: QuoteTick = {
  symbol, bid, ask, mid, spread,
  timestamp: new Date().toISOString(),   // ← generated at EMIT time
};
```

So the fabrication is **layered**: the bridge manufactures freshness, and the gateway manufactures it again
before emitting to the client.

### Why it matters — and the measurement that found it

Chasing `composite=0` in the A/B runner, I concluded from a live-looking quote that the market was **open**.
It was shut:

| | |
|---|---|
| `GET :5000/quote?symbol=XAUUSD` | `bid 4169.30`, `timestamp 2026-10-06T20:45:54Z` ← looks live |
| The same bar's close | **4169.30** — identical, i.e. a **frozen tick re-stamped** |
| `marketbar` newest 1m bar | **19:59Z**, 47 minutes earlier |

**A quote endpoint that manufactures its own freshness cannot be used as evidence of a live market** — and
anything that reads that timestamp to decide "is this feed live?" gets a **yes** for a dead feed.

### ⚠️ What is currently mitigating it, so this is not overstated

The freshness gate that would have been fooled is largely **bypassed** by the venue gate: `getVenueStandby()`
decides "can this market produce a score right now?" from the **market calendar**, not from a quote
timestamp — and `protocol-gating.venue-standby.spec.ts` names the exact failure this prevents:

> *"If this regresses, closed markets resume producing fresh scores and cards — silently, because **a stale
> quote keeps the freshness check green**."*

So the mitigation exists **elsewhere**, by design. What remains is the general hazard: any *new* consumer of
`quote.timestamp` inherits a field that is always "now".

### Not established

- Which consumers read `quote.timestamp` for a freshness decision, if any — **not enumerated**. If none do,
  this is a latent hazard rather than an active defect, and should be recorded as such rather than fixed urgently.
- Whether MT5 exposes the tick time per symbol here (`tick.time`) — **not checked**. If it does, the honest
  value is available and the fix is one field.

### Relationship to this issue

Not the same code path as the synthetic-bar loop, but the **same defect**: *a plausible value is
manufactured where an absent one should be reported*, so a dead feed reads as live. Recording it here so the
class has one home rather than two.
