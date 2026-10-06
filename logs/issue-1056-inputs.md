## The decline line now carries the consensus INPUTS — and it immediately showed the real pattern

**Still not closing.** FRA40 is not open (broker 3 holds only US500 and US30), so the one-line lookup still
waits. What changed is that the line is now *self-explanatory* instead of carrying a number nobody can check.

### Why the inputs had to be added — measured, not assumed

I tried to answer this issue by re-deriving the consensus from outside:

```
POST /api/directives/<atr-trailing-stop|supertrend|chandelier-exit|wick-filter>/test
  → signalClass + score, then alignedAvg − opposingAvg exactly as stop-guardian.service.ts:1330 does
```

**It reproduced 9 of 12 guarded positions — and the 3 failures are not consistent with each other.** `AMZN`
and `GOOGL` had *identical* directive output and live values of 55 and 0. Two reasons, both real:

| Cause | Guardian | `…/test` route |
|---|---|---|
| Bar source | 30 bars from the position's **own bridge** (`loadBars`, L1812) | DB bars (`marketData.getBars`) |
| Timing | value captured at its last tick | sampled minutes later |

⚠️ **So I am NOT claiming an explanation for FRA40 from that method** — the script's own guard refused to
let me: *"The model does NOT reproduce every position — do not use it to explain FRA40."* A derivation that
works on 9 of 12 cases is a guess with a good hit rate.

That is the argument for putting the inputs in the record, which is now done.

### Live within a minute of deploy (UTC; the log file is UTC)

```
20:05:51 DECLINED EURJPY broker=2 ticket=152730926765 side=BUY outcome=below-threshold consensus=0 sl=176.332 rec=176.332
         aligned=[chandelier-exit:55] opposing=[supertrend:55] neutral=[atr-trailing-stop,wick-filter]

20:06:21 DECLINED GOOGL broker=2 ticket=152731403544 side=BUY outcome=below-threshold consensus=0 sl=338.3 rec=338.3
         aligned=[none] opposing=[supertrend:55] neutral=[atr-trailing-stop,chandelier-exit,wick-filter]
```

### ⚠️ What that shows, and it is more useful than "consensus 0"

Two different ways to arrive at 0:

1. **Cancellation** — EURJPY: `chandelier-exit` bullish 55 aligned against `supertrend` bearish 55 → 55 − 55 = **0**
2. **No aligned evidence at all** — GOOGL / GBPCAD / EURCAD: `aligned=[none]`, one opposing directive → floored to **0** by `Math.max(0, …)`

**Every one of the four stop directives reports `neutral` most of the time** (`atr-trailing-stop` in all
four lines above; `wick-filter` always). The gate is `consensus >= 55`, so a position passes only when it has
**aligned evidence totalling ≥55 with nothing opposing** — which is why exactly 5 of 12 passed on the sample
I measured and 7 did not.

Whether that is calibrated correctly is **not something I am deciding here** — it is a maths question, and it
belongs behind an A/B copy, not an in-place edit.

### Gates for this change

| # | Gate | Observed |
|---|---|---|
| 1 | Structural | `tsc -p tsconfig.build.json --noEmit` exit 0 |
| 2 | Contract | `stop-guardian-decline-log` → **12 passed** (3 new); full guardian suite **52 passed** |
| 3 | State | guard present in the running build; `DECLINED` lines carry the breakdown within one tick of the restart |
| 4 | Behaviour | the two live lines above |

**Canary, both directions, against the real file:** dropped the breakdown from the line → `carries the
directive breakdown that produced the consensus` **FAILS** (1 failed, 11 passed, exit 1); restored → 12/12,
SHA-256 identical (`C03A14BD…9E0AFA`). The breakdown map is pruned beside the outcome map, and that is
asserted too — otherwise a closed position's inputs would be pinned in memory forever.

### What is still outstanding on this issue

**Only the FRA40 lookup**, and it now reads in one line:

```powershell
Select-String -Path nest\logs\tcs-*.log -Pattern "DECLINED.*FRA40"
```

If FRA40's next trade is declined, that line names `aligned=[…] opposing=[…] neutral=[…]` — i.e. which
directive decided it. If FRA40 never appears at all, the absence is now meaningful, because every position
that is evaluated and declined writes a line.
