# Ownership Axes — one value, one owner, enforced at build time

> **Created 2026-09-15**, after finding **23 drifted literals** of a single policy value (strength
> thresholds) across 8 files, plus **4 independent answers** to "how long is a 1h bar?".
>
> Neither was caused by carelessness. In both cases the correct pattern **already existed** and was
> simply not *enforced* — and in the most damning instance, `automation-loop.service.ts` **imported
> the right constant** and still wrote a literal 1,180 lines later. **Making a value available does
> not make it used.**
>
> This file is the register of axes we have closed, so the next person can see what is owned and
> what is still open — rather than rediscovering it.

---

## What is an "axis"?

A **concept that must have exactly one authoritative definition** in the codebase. Not a value —
a *concept*. "How strong must a reading be to trade?" is an axis. "How long is a 4h bar?" is an
axis. Each has:

- **one owner** — the file that declares it,
- **consumers** — everything else, which must *import* it,
- **a guard** — a script that fails the build when a second declaration appears.

**The failure mode is always the same:** a value changes in the owner, one consumer keeps its own
copy, and nothing errors. The system produces plausible numbers describing the wrong thing.

---

## Closed axes

### 1. Strength thresholds — ✅ CLOSED

| | |
|---|---|
| **Owner** | `nest/src/modules/scoring/protocol-gating.service.ts` (classification)<br>`nest/src/common/utils/style-thresholds.ts` (style bars + consumer defaults) |
| **Exports** | `ENTRY_THRESHOLD`, `STRONG_PCT`, `SIGNAL_THRESHOLDS` / `STYLE_THRESHOLDS`, `BOT_BAR_DEFAULT`, `SIGNALS_GATE_DEFAULT`, `resolveStyleThreshold` |
| **Guard** | `nest/scripts/validate-threshold-sources.cjs` (in `prebuild`) |
| **Closed** | 2026-09-15 · issue **#839** |

**Drift found:** 23 out-of-scale literals. Worst consequence: a bot created via the API, the Speed
Scanner, or the Create-Strategy form received a bar of 55–75 while the live scale peaks at ~33 — it
would appear active, score normally, emit `SKIP` decisions with a plausible reason, and **never
trade**. No error anywhere.

**Also:** the guard verifies Prisma `@default` values equal the canonical constant. A column default
is a **second owner** and the sneakiest one — it applies to any `INSERT` that omits the field, so it
can create a broken row even when every line of application code is correct.

⚠️ **Not covered:** `gateConfig.*.threshold` (40/35/45) uses a different key and a possibly-different
scale — a group gate is compared against a *group* percentage, not the protocol composite. Flagged
in `scoring-strategy-seed.ts`, deliberately not "tidied".

---

### 2. Timeframe / cadence — ✅ CLOSED

| | |
|---|---|
| **Owner** | `nest/src/common/utils/timeframe.ts` |
| **Exports** | `BAR_LENGTH_MS`, `barLengthMs()`, `barLengthMsOrUndefined()` |
| **Guard** | `nest/scripts/validate-timeframe-sources.cjs` (in `prebuild`) |
| **Closed** | 2026-09-15 |

**Drift found:** four independent implementations. Measured behaviour, not assumed:

| tf | owner | `market-status.ts` | `outcome-tracker.service.ts` | `contract-probe.cjs` |
|---|---|---|---|---|
| `1m`–`1d` | correct | same | same | same |
| **`1w`** | 604,800,000 | **undefined** | **3,600,000** (1h — 168×) | same |
| **`'1M'`** | 86,400,000 (1d) | **undefined** | **60,000** (1min — 1440×) | undefined |

⚠️ **Honest scope:** they **agreed** on the seven common lowercase cadences, so this was **latent**,
not live. It is guarded anyway because `1w` is *already* wrong by 168×, and because `'1M'` is a
**1,440× disagreement on identical input** — the owner's map is case-sensitive while the removed
parser used `/i`.

**⚠️ `barLengthMs()` vs `barLengthMsOrUndefined()` — the difference is load-bearing.**
`computeMarketStatus()` fails closed on `!declaredCadenceMs`. `barLengthMs()` always returns a
number, so using it there would have made the fail-closed branch unreachable and let an unmeasurable
feed read as **OPEN**. Two variants from one owner exists *precisely* so that guard stays alive.

**⚠️ Open:** the frontend has **16 `TIMEFRAMES` arrays in 4 conventions** — 7 lowercase, 3
UPPERCASE (`1M/5M/1H`), 2 MT5-style (`M5/H1/D1`), 4 other. Not yet unified. Passing an uppercase
label into a duration path is the hazard above.

---

### 3. Time / timezone — ✅ CLOSED

| | |
|---|---|
| **Owner** | `nest/src/common/utils/session-time.ts` |
| **Exports** | `zoneOffsetMs()`, `minutesInZone()`, `zonedWallClockInstant()`, `minutesFromOpen()` |
| **Guard** | `nest/scripts/validate-timezone-sources.cjs` (in `prebuild`) |
| **Closed** | 2026-09-15 |

**Drift found:** "What is the ET time?" was answered by **month arithmetic** in two files:

```ts
// market-context.service.ts          // session-window.ts  (identical)
const isDST = month >= 2 && month <= 10;   // Mar–Nov approximate DST
let etHour = utc.getUTCHours() - (isDST ? 4 : 5);
```

**Real US DST 2026 is 8 Mar → 1 Nov**, so all of March and all of November were treated as EDT —
**the ET clock ran an hour ahead for ~36 days a year.** That value feeds `sessions[].active`,
`opensIn` and `closesIn`, i.e. *which markets report as open*. Measured before/after: 5 Mar and
3 Nov were each an hour out; 9 Mar, 30 Oct, 15 Jun and 15 Jan were already correct and did not move.

⚠️ **The two copies were DELIBERATELY identical.** `session-window.ts` said so: *"identical to the
historic MarketContextService behaviour, so session boundaries do not move as a side effect of this
file."* Reasonable in isolation — but it means **fixing one alone makes the two disagree, which is
worse than both being consistently wrong.** They were changed together.

⚠️ **This class has already caused real damage:** epic #731 — the same wall clock re-parsed in the
machine's timezone made `session-open-effect` score **6,308 times without ever leaving its
no-signal branch**.

⚠️ **A false positive was caught and fixed in the guard itself.** Its first version matched any
`month >= N && month <= M` and flagged **`sell-in-may.directive.ts`** — the May–October *seasonal
window*, nothing to do with DST. Tightened to require a month range that **decides an hour offset**.
Verified: catches **4/4** original defect variants, **0** false positives on the seasonal window and
OpEx. *Tighten the pattern; do not exempt the file — an exemption is how a guard dies.*

**Not covered:** the frontend holds its own timezone lists (`StrategyWizard.jsx`,
`FeatureLab/TimezoneDecisionDemo.jsx`). The demo is **intentionally** wrong — it exists to contrast
hardcoded offsets against IANA resolution — and is an explicit, reasoned exemption in the guard.

---

## Open axes — not yet made visible

Named here so they are tracked rather than rediscovered. **None is guarded yet.**

| # | Axis | Why it is at risk |
|---|---|---|
| 4 | **Status / enum strings** | `'live' \| 'stale' \| 'no_data' \| 'error'` drifted silently once already (#827). Direction modes and signal classes are similar string unions. |
| 5 | **Symbol lists** | Seeded symbols vs `symbol_route` vs watchlists. Per `database-seed-discipline.instructions.md`, several tables have **no seeder at all** — a direct DB write is lost on reinstall. |
| 6 | **Protocol ↔ directive group membership** | `isRiskGate` decides gate vs voter. A first attempt to detect it **by name** found zero gates and silently produced `NON-GATE == ALL`, hiding the very identity being checked. |
| 7 | **Directive maxScores** | 101 values, seed vs DB. The whole weighting system rests on them (see the directive-scoring rules: scores are **not** capped at 100). |

---

## How to close an axis

1. **Name the concept**, not the value.
2. **Find every declaration** — grep for the *shape* (a map, a literal default, a derived parser),
   not just the name. Renaming a variable must not evade the guard.
3. **Pick one owner** and delete the others; consumers import.
4. **Write the guard.** It must:
   - compare against the **real owner** (load the compiled module as the oracle — do not
     hand-copy expected values, which is a second owner),
   - **fail loudly** rather than pass silently. A verifier that cannot parse its target must ERROR,
     not report OK — one guard here initially reported *"no map found"* and vouched for a file it
     never checked,
   - be **deliberately narrow**. A guard that fires on legitimate values gets switched off, and a
     disabled guard is worse than none.
5. **Wire it into `prebuild`** (list it in `nest/package.json`).
6. **Preserve load-bearing edge semantics.** Before replacing a local implementation, check whether
   a caller depends on a *distinguishing* behaviour (absence, `undefined`, a fallback). Two of the
   four cadence copies were nearly "fixed" into weakening a fail-closed guard.
7. **Record it here**, with what was found and what was *not* fixed.

---

## Why this exists instead of a big review

The owner asked whether reading the whole META.Stack pipeline for broken logic was worth it. The
conclusion: **the goal is right, the method is not.**

Reading 166K lines is unreliable (it flags correct code and misses things), non-repeatable (a
one-off read prevents nothing), and unfocused (no definition of done). **Writing a guard found 23
drifted literals in about a minute, verified them, and now runs on every build forever.**

> **Do not read for bugs. Enumerate the axes, and make each one enforceable.**

## Related

- `docs/SETTLED-DECISIONS.md` — decisions, with guard status (🟢/🟡/🔴)
- `.github/instructions/meta-stack-contracts.instructions.md` — invariants (`INV-*`)
- `.github/instructions/shared-core.instructions.md` — canonical import paths for shared utilities
- `.github/instructions/change-completion.instructions.md` — the four gates, and why Gate 3
  (state) is the one that keeps being missed
