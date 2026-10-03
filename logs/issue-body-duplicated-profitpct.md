# The same number is computed in FOUR places, and two of them disagree — the signed profit % of a position

**Raised by the owner, 2026-10-03:** *"Are we building this app in a way where the same numbers are being
calculated in two or more places and potentially, different maths?"*

**Answer: yes, and here is one measured instance.** It is a **class** question, not a bug report — the
instance is real but currently **REACHABLE, not ACTIVE** (see the reachability measurement below, which
is the part that decides priority).

---

## The four implementations

The *signed* profit percentage — "is this position up or down, and by how much" — exists four times:

| # | Location | Its rule for `side` | When it cannot compute |
|---|---|---|---|
| 1 | **`nest/src/common/trading/peak.ts:82`** `profitPctFor()` — **CANONICAL** | `isShort = s === 'sell' \|\| s === 'short'` (lowercased) | returns **`null`** |
| 2 | `nest/src/modules/scoring/exit-consensus.service.ts:373` | `side === 'buy' ? long : short` | returns **`0`** |
| 3 | `nest/src/modules/automation/stop-guardian.service.ts:1541` | `isBuy = pos.type === 'buy'` | **no guard** |
| 4 | `nest/src/modules/automation/stop-guardian.service.ts:1659` | `isBuy = pos.type === 'buy'` | **no guard** |

The arithmetic is identical in all four. **The edges are not.**

## Divergence 1 — the sign INVERTS for an unrecognised side

```
canonical :  isShort = (side === 'sell' || side === 'short')   →  NOT short ⇒ LONG
the others:  side === 'buy' ? long : short                     →  NOT 'buy' ⇒ SHORT
```

**For `side = null`, `undefined`, `''`, or any value that is not exactly `'buy'`, the canonical returns a
LONG-signed percentage and the other three return a SHORT-signed one — the same inputs, opposite signs.**

`'sell'` and `'SELL'` agree by luck (canonical lowercases; the others fall to the `else`). Only the
*unknown* case diverges — which is the case with no natural correct answer, and therefore the one where
two silent implementations matter most.

## Divergence 2 — `0` where the canonical says `null`

`exit-consensus` ends with `: 0`. The canonical returns `null`.

This is the rule this repo already settled as **register row 60**: *"NULL ≠ 0 — 'no peak observed' and
'the peak was break-even' are different facts."* A `0` here is a **definite claim of break-even** on a
row that could not be priced — and `giveBackPct` is then computed against that fabricated zero.

## Divergence 3 — no guard at all in `stop-guardian`

Divisions by `pos.priceOpen` / `entry` with no `> 0` test. The canonical guards `entry === 0`,
`NaN` and non-finite inputs.

---

## ⚠️ Reachability — measured, because it decides the priority

| Table | `side` values present |
|---|---|
| `position` (live, 7 rows) | `buy` 6 · `sell` 1 |
| `trade` (closed, 512 rows) | `buy` 445 · `sell` 67 |

**Zero rows carry an unrecognised side.** So the sign divergence is **REACHABLE IN CODE but NOT ACTIVE
IN DATA** — it cannot fire today. That is a different finding from an active defect, and it is stated
rather than implied.

It is filed anyway because (a) `stop-guardian` is a **money path** — it moves stops — and (b) the
condition needed to reach it is a data state the app already models elsewhere (`side: null` appears in
`weekend-defense.service.spec.ts`), so "not active" is not the same as "cannot happen".

## Scale — this is not four lines

The tell-tale of a re-derived direction test, `=== 'buy' ?` / `isBuy =`, appears **45 times across 15
files**. Most are legitimate direction branches (choosing an order side), **not** copies of the profit
formula — this is a *smell count*, not a duplicate-maths count, and it is reported as such.

Top files: `automation-loop.service.ts` 6 · `exit-consensus.service.ts` 6 · `mt5.adapter.ts` 6 ·
`stop-guardian.service.ts` 6.

## What already exists to catch this class

| Guard | What it covers | Why it did not catch this |
|---|---|---|
| `validate-duplication.cjs` (**INV-NO-NEW-DUPLICATION**) | 1,966 duplicate blocks / 154 pairs, ratcheted | It detects **syntactic** blocks. A 1-line formula differs syntactically in all four places, so it scores below the threshold. |
| `validate-threshold-sources.cjs` | A module-level **numeric threshold** outside its declared owner | These are **expressions**, not declared constants — no module-level number to catch. |

So the repo has a ratchet for *large* duplication and one for *constants*, and **nothing for a
one-line formula re-derived with different edges.**

## Suggested fix (not done — see below)

Route all four through `profitPctFor()`, which is already the canonical owner and already handles the
long/short sign (`#998`). The shape that makes it stick is a **guard on the readers**, not the writers:
assert that the sign is the same for a recognised side and **that the uncomputable case is `null` in
every consumer**.

## Not done — deliberately

- **No fix landed.** Routing `stop-guardian` through the canonical changes the sign for an
  unrecognised `side` on a money path. That is a behaviour change which needs the A/B discipline in
  `maths-change-requires-ab.instructions.md`, and *"the divergence exists"* is not a measurement of
  what the divergence costs. Measure first.
- **The other 41 direction-test occurrences were not individually classified** — only the four profit%
  copies were read. The 45 is a search result, not an audit.
