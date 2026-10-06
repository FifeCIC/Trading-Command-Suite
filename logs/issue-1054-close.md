## Pre-Close Verification

The issue's own acceptance criteria, each answered with a measurement:

- [x] **The missing input is named, per arm row, with the count for each** → **There is no missing input.** 91 of 122 tagged trades were **OPEN** (`closedAt IS NULL`) and correctly carry no P&L; of the 31 closed rows, **zero** have a NULL `pnl`. The values resolve — `-5.901666666666666` is a repeating decimal, i.e. the signature of a division, so a volume share was applied
- [x] **A completed A/B run explains why the arms genuinely cannot differ** → proven by a field-by-field diff of the two arms' configs (below)
- [x] **The distinction between the two causes is settled — attribution vs identical scoring** → **identical scoring.** Attribution is shown working, not assumed
- [x] **A verdict refuses to speak on a thin sample** → `MIN_SAMPLES_FOR_VERDICT = 30`, enforced at `ab-test.service.ts:723` — `Refusing to name a winner: ${nA} vs ${nB} closed trades (need ≥30 per side)`
- [x] **The class is guarded so it cannot recur** → `assertArmsCanDiffer()` refuses an A/B whose arms differ only by inert fields; canaried both directions below

### The measurement that settles it — what actually differs between the arms

Field-by-field diff of `metaStackSnapshot.snapshot` for the COMPLETED test (`a1bfc533…`, *"#929 XAU M15 — group vs maxscore weighting"*), 21 comparable fields:

| Field | control v1.0.1 | variant v1.0.2 |
|---|---|---|
| `snapshot.weightStrategy` | `group-weighted` | `maxscore-weighted` |
| `id` / `version` / `createdAt` / `fingerprint` | — | identity + derived noise |

**One substantive field, and it is the INERT one.** `protocol-gating.service.ts:80` states it plainly:

> ⚠️ `weightStrategy` IS INERT — DECLARED, NOT APPLIED (measured 2026-09-24, #919) … it is only echoed into the payload (`meta.weightStrategy`); the denominator is hardcoded

So both arms score identically → they enter and exit the same trades at the same prices → **identical P&L by construction.** The runner and the attribution both did their jobs; the experiment had no variable in it.

✅ **Attribution is proven working, not assumed:** the AB rows hold **separate tickets** (no ticket is shared between AB-A and AB-B), close at identical prices, and **zero non-AB rows share an AB ticket**.

## ⚠️ A valid A/B pair already exists — and it was cancelled

The second test (`b50727ee…`, *"#929 measurable run — tradeThreshold 55 (v1.0.0) vs 10 (v1.0.1)"*) differs in a field the pipeline **actually reads**:

| Field | control v1.0.0 | variant v1.0.1 |
|---|---|---|
| `snapshot.tradeThreshold` | **55** | **10** |

`automation-loop.service.ts:1600` — inside the A/B arm evaluation — is `const threshold = cfg.tradeThreshold ?? BOT_BAR_DEFAULT;`, and `if (score.composite < threshold)` gates whether the arm trades. **This pair can produce a difference. Its status is `cancelled`.**

So the app has a *valid* experiment available and ran an *invalid* one to completion. Raised in the review queue rather than started here — running it spends a live measurement window and places demo orders.

## The guard, canaried both directions (added by #929, verified here)

| Direction | Action | Observed |
|---|---|---|
| 1 | neutralised `if (liveable.length === 0)` → `if (false && …)` | `REFUSES a test whose arms differ ONLY in a field declared inert` **FAILS** — 1 failed, 6 passed, exit 1 |
| 2 | restored | **7 passed, 7 total** |
| — | restore integrity | SHA-256 identical: `A8F8B80059FF2CB0E111311F882C4BEB607E5DCABA830B82B89F6B94F717E90F` |

The guard's own comment records the precedent: *"That trade was already paid once (see INERT_SNAPSHOT_FIELDS)"* — i.e. **this issue is why the guard exists.**

## Why this issue's premise was wrong, since that is the durable lesson

The body was written from a query grouped over **all** tagged rows, without splitting open from closed. An open trade having no P&L is not a defect — it is the expected state. The correction was recorded here on 2026-10-01 and this comment confirms it independently.

⚠️ The shape to watch: **`weightStrategy` being INERT is the same defect as `?? 60` in the A/B threshold** (`automation-loop.service.ts:1596`, #839) — *"making the right value available does not make it used."* Two fields, same failure, both now guarded.
