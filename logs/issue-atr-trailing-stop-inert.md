## Summary

`atr-trailing-stop` is one of the **four** directives the stop guardian derives `stopConfidence` from against a `>= 55` threshold. It has contributed **directional evidence 0 times in 133 live evaluations**, because all four of its branches are unreachable at real market distances.

Being registered is not the same as being heard.

---

## Measured

### 1. It never speaks

Today's canonical log (`nest/logs/tcs-2026-10-06.log`), 133 `DECLINED` lines:

| Directive | Directional | Rate |
|---|---|---|
| `supertrend` | 68 / 133 | 51% |
| `chandelier-exit` | 32 / 133 | 24% |
| **`atr-trailing-stop`** | **0 / 133** | **0%** |
| `wick-filter` | 0 / 133 | 0% (by design — 3 of its 5 branches return `neutral`) |

`consensus` was `0` in **132 of 133** lines, and the guardian adjusted **0 positions** all day.

### 2. Reproduced deterministically

`POST /api/directives/atr-trailing-stop/test` with the guardian's own input (`5m`, 30 bars):

| Symbol | Result |
|---|---|
| XAUUSD | `neutral` score 30 — *"Price inside ATR trailing-stop channel — no clear trend"* |
| EURUSD | `neutral` score 30 — same |
| US30 | `neutral` score 30 — same |

### 3. The arithmetic — the branches cannot fire

The directive computes `longStop = highestHigh(20) − 3×ATR` and `shortStop = lowestLow(20) + 3×ATR`, then branches on **fractions of price**:

```
if (distAboveLong > 0.1)   → bullish
if (distAboveLong > 0.03)  → bullish     // needs price >3% ABOVE the long stop
if (distBelowShort < -0.1) → bearish
if (distBelowShort < -0.03)→ bearish     // needs price >3% BELOW the short stop
else                       → neutral
```

Measured on live 5m bars (`marketbar`, last 30 bars):

| Symbol | `lastClose` | `hh20` | `ll20` | `atr14` | `distAboveLong` | `distBelowShort` |
|---|---|---|---|---|---|---|
| XAUUSD | 4169.30 | 4184.29 | 4166.52 | 2.864 | **−0.00153** | **−0.00139** |
| EURUSD | 1.13 | 1.13 | 1.13 | ~0 | 0.00008 | −0.00024 |
| US30 | 51580 | 51587 | 51537.2 | 12.986 | 0.00062 | 0.00007 |

**Observed distances are 0.0001–0.0015. The thresholds are 0.03 and 0.1 — 20× to 300× larger.**

For the bullish branch to fire on gold, price would need to sit ~3% (≈125 USD) above a level defined as `highestHigh − 3×ATR`, i.e. an enormous move within 20 bars. The values are not "small" — they are a **distance-from-stop expressed as a fraction of price**, which is structurally ~0.1–1% at most, compared against 3% and 10% cut-offs. The sibling directive immediately above it in the same file compares `pctB` (a 0–1 normalised band position), and those thresholds *are* reachable — the unit is the difference.

For completeness: `git log -S "distAboveLong > 0.03"` shows the string was **introduced once** (`c9c1353`, "Directive Improvements", 2026-09-08) and never changed, so this is not a regression from a previously-working value.

---

## Impact

The `>= 55` threshold is calibrated for four signals. A permanently-neutral directive contributes **exactly as little as an absent one**, so the threshold has been applied to fewer signals than intended — the same class as **#890**, by a different route.

Nothing anywhere reported it. `resultsMap.size` read **4 of 4** throughout, so `INV-GUARDIAN-DIRECTIVE-RESOLVABLE` and the `GUARDIAN DIRECTIVES UNRESOLVED` error both reported healthy for the exact condition they exist to detect. That guard asks *"is it registered?"* — a question this directive answers `yes` to.

## What was fixed in this change (no trading number touched)

A **contribution** guard beside the presence guard: `trackDirectiveContributions()` counts consecutive neutral evaluations per declared directive and warns — throttled to once per hour — when one crosses 200. Deliberately a **symptom** guard: it does not need to know *why* a directive is silent, only *that* it is.

```
GUARDIAN DIRECTIVE SILENT — atr-trailing-stop 200x — "Price inside ATR trailing-stop channel — no clear trend". Registered and active, but has contributed no directional evidence across >= 200 evaluations, so its input to the >= 55 consensus is ABSENT rather than neutral. Being registered is not the same as being heard (#890).
```

8 canary tests, each verified to FAIL when its mechanism is broken (streak reset removed → 2 failed; throttle removed → 1 failed; streak threshold lowered → 3 failed; file restored byte-for-byte, SHA-256 verified).

---

## ⚠️ The thresholds are NOT changed here — this is a maths decision

`0.03` / `0.1` are numeric thresholds on the exit path. Per
`.github/instructions/maths-change-requires-ab.instructions.md`, moving them changes when the
guardian adjusts a live stop, so it requires a **copied configuration and a monitored comparison** —
not an in-place edit. Options for the owner, with the costs named:

| Option | Pros | Cons | Effort |
|---|---|---|---|
| 🟢 **A — recalibrate the thresholds to observed range** (e.g. `0.001`/`0.003`, from the measured distribution) | Makes a dead directive live; the guardian's evidence base goes 2→3 of 4 | Changes when stops move on **every open position**; needs an A/B copy and a monitored window | Medium |
| **B — express the distance in ATR units** (`(lastClose − longStop) / lastATR`) | Dimensionless and scale-free across symbols — the comparison the description actually implies | A unit change, so historical calibration (if any) is void; still a maths change | Medium |
| **C — leave it neutral and remove it from `STOP_GUARDIAN_DIRECTIVES`** | Honest: the threshold then matches the evidence base it really has | Loses a directive; needs the `>= 55` threshold revisited separately | Small |
| **D — do nothing** | Zero risk | A declared input stays permanently silent, and the guard now warns about it hourly | None |

**Recommendation: A, via the A/B system** — but note the precondition recorded in the maths rule is
still live: A/B attribution cannot yet produce a readable verdict (arms merge on the same netting
account). C is the honest interim if the warning becomes noise.

## Not in scope

- **Not** a stub: all 109 directives in the `directive` table are `active=1`; there are **zero**
  inactive rows. This is not the #288 stubbing path.
- **Not** a time gate: no directive in the repo declares an `activeWindow` (the only match is a
  comment recording that one was removed).
- **Not** short bars: the directive needs 25 and the guardian supplies 30.
