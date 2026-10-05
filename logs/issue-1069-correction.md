## ⚠️ CORRECTION (2026-10-04) — the reachability claim in the body is now WRONG. This is **ACTIVE**, not merely reachable.

The body says:

> *"**Zero rows carry an unrecognised side.** So the sign divergence is **REACHABLE IN CODE but NOT ACTIVE IN DATA** — it cannot fire today."*

**Measured again 2026-10-04, after a Trading 212 sync populated the position table:**

| provider | `side` | rows |
|---|---|---|
| **trading212** | **NULL** | **19** |
| mt5 | buy | 6 |
| mt5 | sell | 1 |
| | **total** | **26** |

**19 of 26 positions — 73% — carry an unrecognised side.** My original measurement (buy 6 / sell 1) was correct at the time: the table held **7** rows, all MT5. The Trading 212 holdings sync has added **19** rows since, and every one has `side = NULL`.

**And they reach the code.** All 19 are fully computable — `no_entry = 0`, `no_current = 0` — so nothing upstream skips them:

```
unrecognised_side_rows   from_trading212
19                       19
computable   no_entry   no_current
19           0          0
```

### What that means concretely

For the same position, on the same tick:

| implementation | signs `side = NULL` as |
|---|---|
| `profitPctFor()` (canonical, `peak.ts`) | **LONG** — anything not `sell`/`short` |
| `exit-consensus.service.ts:373` | **SHORT** — anything not `'buy'` |
| `stop-guardian.service.ts:1541`, `:1659` | **SHORT** |

**Opposite signs, 19 live rows.** The P&L alert (which now uses the canonical after yesterday's fix) and `exit-consensus` would report the **opposite direction** for the same holding.

### ⚠️ This changes the fix, and it is a genuine fork — not a de-duplication

The obvious fix (route all three through `profitPctFor`) would make everything agree on **LONG** for an unknown side. But that is a **guess presented as a fact**, and this repo has already settled the opposite rule twice:

> **register row 60** — *"NULL ≠ 0 — 'no peak observed' and 'the peak was break-even' are different facts."*

An unknown direction is the same shape: **"we could not determine the direction" is not "long".**

So the fix is **not** "point them all at one function". It is a decision between:

| option | what it does | cost |
|---|---|---|
| **A** — canonical stays long-defaulting; the other two are corrected to match | cheapest; consistent today | 19 positions silently get a **long-signed** P&L that was never established. If a T212 position were ever short, it reads inverted with no error |
| **B** — `profitPctFor` returns **null** for an unrecognised side; every caller must handle "cannot judge" | honours the row-60 rule | changes what those 19 rows report **today** — a behaviour change on positions, so it needs the A/B discipline, not a drive-by |
| **C** — establish the side for T212 rows at import (they are long-only, so `buy` is likely correct) | fixes the **data** rather than the maths | needs the T212 importer checked for what it actually holds; if a short exists the assumption fails |

**C is the one that removes the ambiguity rather than papering over it**, and it is the only one that does not change maths. It was not attempted: it needs the importer read, and the seed-first rule applies to whatever it finds.

### What is unchanged

- `profitPctFor` correctly guards `entry === 0`, `NaN` and non-finite prices — that part is not in question.
- The four-copies finding itself stands: four implementations, divergent edges, one canonical owner.

**No fix landed. The record is corrected so the decision is made against the real number (19 live rows), not the stale one (0).**
