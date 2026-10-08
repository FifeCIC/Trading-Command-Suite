## Re-measured 2026-10-08 — the capture is **16.9%**, not "a third", and 52% of closes carry no captured reason

The issue's premise holds and is **worse than stated**. Every figure below is a query against `trade` with
`pnlInvalid = 0`.

### 1. How far toward target do winners actually get?

| | winners (125) | losers (150) |
|---|---|---|
| avg price move `\|exit − entry\|` | **5.22** | **11.47** |
| avg declared distance | target **31.10** | stop **16.80** |
| **consumed** | **16.9% of target** | **49% of stop** |

⚠️ **The issue said "winners exit at a third of their target". The current figure is 16.9% — about one sixth.**
Either the measurement has moved the wrong way since 2026-09-2x or the earlier estimate was generous; either
way **16.9% is the number to work from.**

### 2. The declared asymmetry is real; the realised one is INVERTED

The configuration genuinely offers **1.85:1** in the book's favour — target 31.1 against stop 16.8.
The book realises **0.46:1 against it** — win 5.22 against loss 11.47.

**Break-even at these numbers needs a 68.7% win rate. The book runs 45.5%** (125 of 275).

⚠️ **So the defect is not only that winners leave early. It is that the two sides are asymmetric in the
OPPOSITE direction to the one declared** — losers travel more than twice as far as winners.

### 3. The target is essentially unreachable in practice

`closeReason` across every closed trade with a valid P&L:

| closeReason | n | avg pnl | total |
|---|---|---|---|
| `broker:terminal` | **93** | **+3.13** | **+291.16** |
| `system:time-stop` | 82 | −1.06 | −86.97 |
| `broker:unknown` | **50** | **−6.74** | **−337.03** |
| `broker:sl` | 37 | −16.06 | **−594.39** |
| *(null)* | 12 | +4.85 | +58.19 |
| **`broker:tp`** | **1** | +15.25 | +15.25 |

**`broker:tp` fired ONCE in 275 closes.** The declared target is not where winners end — which is why "winners
exit early" and "who closed it?" are the same question.

### 4. ⚠️ The blocker: 143 of 275 closes (52%) have NO captured reason

`broker:terminal` **93** + `broker:unknown` **50**. Those are 52% of all closes, and they contain **the entire
winning population** — `broker:terminal` averages **+3.13**, which is where the +5.22 winners live.

**The actor closing the winners is therefore NOT NAMED, and cannot be from this data.** #1059's definition of
done says exactly this: *"the actor closing winners is NAMED with `closeReason`/`stop_adjustment`/log
evidence."* It is not.

⚠️ **And the two heaviest buckets by money are the two least explained:** `broker:sl` **−594** (a real mechanism —
though see §2, since losers consume only **49%** of the stop, so many are *not* stopping out) and
`broker:unknown` **−337** (no mechanism at all).

### What this establishes, and what it does not

✅ **Established:** capture ratio **16.9%**; realised reward:risk **0.46**, inverted against a declared **1.85**;
the target fires **once in 275**; and **half of all closes carry no reason**.

⚠️ **NOT established — do not assume it: WHY winners close at +3.13.** Candidates are the reconciler booking a
position it did not itself close, a broker-side close the bridge does not report, or a management actor whose
reason is never written. **The `closeReason` gap is the thing to close first**, because every other question
here is downstream of it and each candidate implies a different fix.

⚠️ **No number was changed by this comment, deliberately.** `slPct`/`tpPct` and the trail distances are *the
maths* — a copied configuration and a monitored comparison, not an edit (`maths-change-requires-ab`). The
measurement is the deliverable; **16.9% is the baseline** any change is judged against.
