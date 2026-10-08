## ❌ RETRACTED — this is a FALSE POSITIVE. The flat bars are the FEED, not fabrication. Closing.

I filed this from a measurement that **could never have distinguished the two things it claimed to separate**, and
the decisive test — which I should have run first — falsifies it in one call.

### The test I should have started with: ask the feed

`GET :5001/candles?symbol=VIX&timeframe=1m&limit=12` (broker 3, VIX's only route):

```
13:05  16.74 16.74 16.74 16.74  vol 1
13:06  16.74 16.74 16.74 16.74  vol 1
13:13  16.79 16.79 16.79 16.79  vol 1
13:14  16.79 16.79 16.79 16.79  vol 1
13:15  16.79 16.79 16.79 16.79  vol 1
```

**Bar-for-bar identical to the rows I called fabricated** — same timestamps, same prices, same `volume`, including
the exact "consecutive identical closes" run I cited as the longest (99 minutes at `16.25`). The database is
storing what the bridge serves.

### The comparison that settles it, at scale

| | total 1m bars | flat | **flat %** | distinct closes |
|---|---|---|---|---|
| **Bridge** VIX | 1,000 | 787 | **78.7%** | 30 |
| **Bridge** XAUUSD | 1,000 | 0 | **0%** | 875 |
| **Database** VIX | 15,041 | 10,947 | **72.8%** | 124 |

⚠️ **The database is 6 points LESS flat than the feed.** There is no extra writer, no synthesis, and nothing to
trace. The "second fabricating source" does not exist.

### Why the original measurement was wrong — the part worth keeping

**"Flat" is not a synonym for "fabricated", and I used it as one.** The finding rested on comparing flat
*proportions* across instruments:

- **XAUUSD** moves thousands of ticks a day. **VIX** moved **~60 cents across the entire fortnight**, on a
  **0.01 tick**. 124 distinct closes over 15,041 minutes is not a stuck feed — it is a price that revisits the
  same cent, on an instrument whose tick is that cent.
- So the statistic I chose was **guaranteed** to differ between VIX and gold whether or not anything was wrong.
  It could not have failed to "find" this. A measurement that cannot come out the other way is not evidence.

⚠️ **#1068's proof was different in kind and remains sound**: it compared the database against the bridge and
found the bridge served **nothing** for those timestamps. That is a *contradiction*. Mine found a *difference in
volatility* and read it as a contradiction. The distinction is now the rule: **compare the store against the
SOURCE, never against another instrument's shape.**

### What is genuinely true, and is NOT a defect

- VIX 1m bars carry **~79% flat minutes** and a **~1 cent tick**. That is the instrument.
- Its bars span ~24h, not the 13:30–20:00 UTC cash-index session — consistent with VIX as a **CFD on Pepperstone**
  (route: `symbol_route.brokerId = 3`, `brokerSymbol 'VIX'`, note *"Pepperstone-only … absent from :5000 (#772)"*),
  which trades a longer day than the cash index. Not a fault.

⚠️ **For the VIX protocol work this is good news:** the bars are trustworthy, so nothing here blocks a VIX
strategy. The real constraint on a 1-minute VIX protocol is the opposite of a bug — **most minutes do not move**,
so a 1m VIX strategy has few distinguishable entries. That is a strategy question, not a data one, and this issue
is not the place for it.

### Filed / fixed

- **#1084 — CLOSED as a false positive.** No code change was made for it, so there is nothing to revert.
- **#1068 — unaffected.** Its block is deleted and guarded (9 tests pass); that finding stands on its own evidence.
- The lesson is recorded here rather than in the register, because it is a measurement error, not a decision.

**Apologies for the noise — this one cost a triage pass and should have been caught by asking the bridge first.**
