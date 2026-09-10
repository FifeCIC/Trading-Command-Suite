# Directive Restructure — Reconciliation (#731 → current state)

> **Purpose:** Before re-opening directive maths for #731 ("Directives Re-structure"),
> reconcile the audit's findings against what the META.Stack correctness work has
> **already** fixed. This is the 3rd/4th pass over this ground — the goal is to stop
> re-deriving a model that already exists and only change what is actually still broken.
>
> **Companion sources of truth (these win over this doc where they conflict):**
> - `docs/scoring-architecture.md` — the dual-score model (Opportunity vs Signal).
> - `docs/meta-stack-correctness-review.md` — the MST-001…MST-012 ledger.
> - `nest/src/modules/scoring/protocol-gating.service.ts` — the executable implementation.
> - `nest/src/modules/directives/directive-inclusion.ts` + each directive class `maxScore`.

---

## 1. The canonical model (non-negotiable, already built)

The system is **dual-score**. Do not collapse these back into one number.

| Score | Definition | Drives |
|-------|-----------|--------|
| **Opportunity** | $\Sigma$ all directive raw scores ÷ $\Sigma$ all `maxScore` | ranking / screening |
| **Signal** | $\Sigma$ directional-only raw scores ÷ $\Sigma$ directional `maxScore`, then × risk-multiplier (soft) or 0 (hard gate) | BUY / HOLD / SELL + automation |

Key invariants (from `scoring-architecture.md`, these are load-bearing):

1. **Raw ≠ %.** Raw score, max, percentage, confidence, and risk multiplier are distinct
   units. A raw score must never be persisted into a percentage field.
2. **Bull/bear stay separate** until an explicit conflict/netting rule. Protocol intent
   (`LONG`/`SHORT`) is *eligibility*; `signalClass` at runtime is *evidence*.
3. **maxScore is the single source of truth** on the directive class. No DB `weight` /
   `global_setting` override. No 0–100 clamp — the 0-100 trap.
4. **No constant floors.** A no-signal directive returns **0**, not a midpoint.
5. **One canonical evaluator** for live / API / replay / backtest / scheduler.

The runtime marker is `signalClass`:
- `bullish` / `bearish` → Signal numerator.
- `neutral` → Opportunity only (condition/gate, not direction).
- Gate (`isRiskGate`) → multiplier/veto only, never adds points.

---

## 2. Mapping #731's findings → current status

| #731 finding | Mapped MST | Status (2026-09-09) |
|---|---|---|
| Unit mismatch: raw score written into `compositePct` (120 passes 65%) | MST-003 | ✅ **Implemented.** `signalRaw` / `signalMax` / `signalPct` are explicit; DB consumers use % where required. |
| Parallel scoring paths diverge (`rankAll`, `ProtocolRunnerService`, backtest) | MST-001/004/009 + #734 | 🔶 **Mostly done.** #734 routed schedulers/portfolio off `rankAll` → `rankFromDb`. Backtest data-feed equivalence is MST-009 (partial). |
| Stop Guardian side asymmetry (averages long-biased raw into one confidence) | MST-012 | ✅ **Implemented + unit tested.** Side-aligned evidence; symmetric stop directives. |
| Timeframe leakage (hardcoded 60×1d to intraday) | MST-004 | 🔶 **Partial.** Envelope loads 1d/1h/15m; remaining controllers must adopt the loader. |
| Dropped `signalClass` (Hammer/VWAP default to neutral) | MST-002 | 🔶 **Partial.** Bull/bear evidence separated; remaining directives need `signalClass`/`directionBias` audit. |
| Bull/bear score asymmetry (under-scores bearish) | MST-002 / MST-012 | 🔶 **Partial.** Stop directives symmetric; other asymmetric directives not yet audited. |
| Price-scale non-invariance (absolute-price momentum/MACD) | MST-008 | 🔶 **Partial.** RSI flat/ROC/DeMarker/Force Index/finite-boundary fixed; price-scale normalization not complete. |
| Specific indicator bugs (VWAP, Donchian, Liquidity Sweep, Stochastic >100, Ichimoku/AO/CMF) | MST-008 | 🔶 **Partial.** Some fixed; several remain. |
| Outcome learning loop dead (→ #733) | MST-007 | 🔶 **Just fixed** this session — see §4. |

**Net:** the *architecture* (units, dual-score, gate-vs-score) is **done and tested**.
What remains for #731 is **mostly per-directive correctness**, not a re-architecture.

---

## 3. What actually remains for #731 (the real work)

The remaining items are a *directive-level audit*, not a rebuild:

1. **`signalClass` / `directionBias` consistency** across all registered directives —
   a directive must emit `score` = evidence strength (0..maxScore) and put direction in
   `signalClass`, never encode direction inside `score` magnitude. (MST-002 completion.)
2. **Bull/bear symmetry** — a directive that scores bullish evidence at 100/100 must
   score equally-strong bearish evidence at an equal magnitude. (MST-002/012 completion.)
3. **Price-scale invariance** — momentum/MACD-style directives must use %-return or
   volatility-normalized units, not absolute price points. (MST-008 completion.)
4. **Specific formula bugs** — the named directives in #731 (VWAP anchor, Donchian
   active-candle inclusion, Liquidity Sweep flat-candle false positive, Stochastic >100
   clamp, Ichimoku/AO/CMF displacement). (MST-008 completion.)
5. **Tooling already exists** to catch these: `nest/scripts/directive-guard.cjs`
   (mode 3 = constant floor, mode 5 = signalClass-vs-directionBias mismatch) and
   `nest/scripts/validate-protocol-directions.cjs` (runs on every build).

**Proposed sequencing for #731:** run the guard, produce a per-directive defect table,
agree the target for each class of bug (symmetry / invariance / signalClass), then fix
one directive at a time with a date-stamped comment, re-running the guard after each.

---

## 4. #733 note (outcome learning loop)

`OutcomeTrackerService.computeOutcomes()` was dead code (MST-007). This session:
- Confirmed the daily `@Cron` already wires it (item 1 done by a prior pass).
- **Implemented independent per-horizon maturity** (item 2): each of T+15m/1h/4h/24h is
  filled only once its own due time passes, instead of one update at the 24h mark. Added a
  grace cutoff (25h) so permanently-missing data can't rescan forever.
- Accuracy remains **measurement-only** (`getAccuracy` is exposed read-only via
  `scoring.controller.ts`; it is **not** fed into any weighting) — item 3 holds by design.

### ⚠️ Correction (2026-09-10) — wired ≠ working

The entry above is now known to be **too optimistic**. All three requirements were
implemented, but the loop still produced **zero usable outcomes**:

| Live evidence (before today's fix) | Value |
|---|---|
| Outcome rows | 40,120 |
| Rows with `priceT15m` filled | **0** |
| Rows finalised (grace) with NULL prices | 3,000 |
| Rows carrying `timeframe='M15'` (no such label in `MarketBar`) | 35,472 (88%) |

- **`timeframe` label mismatch.** Outcome rows were written with MT5-style labels
  (`M15`) while `MarketBar.timeframe` stores `15m`; `getPriceAt()` filters by equality,
  so every horizon matured to NULL. Fixed with `canonicalTimeframe()` applied on write
  and at lookup — which also **recovers the 35k historical rows** instead of letting the
  grace path discard them.
- **Sweep starvation.** The sweep took the 500 oldest pending rows, so the unfillable
  backlog blocked the 4,648 valid rows behind it for days.
- **Silent failure.** `getPriceAt()`'s `catch { return null }` made a 100%-failure
  lookup rate indistinguishable from "no data yet".

Lesson worth keeping: a measurement loop that reports "nothing yet" is not evidence of
working code — check that the columns it is supposed to fill are non-null, not that the
cron is registered.

---

## 5. Directive Guard Run #1 + first fix (2026-09-09)

`node nest/scripts/directive-guard.cjs --db` → **0 errors, 199 warnings** (108 files,
153 classes exercised at runtime).

### Triage of the 199 warnings

| Mode | Count | Verdict |
|---|---|---|
| 5 signalClass-vs-directionBias | ~55 | **Mostly false positives under MST-002.** `directionBias='neutral'` + runtime `signalClass` is the canonical eligibility/evidence split (bullishRaw/bearishRaw accumulate by signalClass in `protocol-gating.service.ts`). Do NOT churn these into one-way biases. |
| 1 runtime constant-output | ~32 | **Mostly false positives** — seasonality (`january-effect`, `sell-in-may`, `triple-witching`, …) and sizing (`position-size-kelly`, `budget-gate`) directives don't consume the synthetic bar-only input A/B. ⚠️ Exceptions worth human review: `budget-gate`=100, `rollover-risk`=100, `pattern-density-sr`=90, `position-size-kelly`=30. |
| 7 readiness evidence | 115/129 | **Suspect measurement.** The check reads the legacy `Score` table; the dual-score pipeline persists elsewhere (SignalEnvelope). Verify storage before acting — likely a guard fix, not a directive fix. |
| 4 producer-trace | 2 | **Real.** `cad-usd-oil-correlation` reads `input.wtiValue`; `earnings-proximity` reads `input.earningsDate`. Confirm producers inject these or the directives silently under-deliver. |
| 3 constant floors | 0 | Clean. |
| 6 duplicate ids | 0 | Clean. |

### Fix 1 — `gold-round-numbers` v1.3.0 → v1.4.0 ✅

**Defect:** emitted signed scores (−25/−15/−8) while the engine boundary
(`DirectivesService.sanitizeDirectiveResult`) hard-clamps scores to
`[0, maxScore]`. Every tick the bearish evidence was zeroed and a
"clamped at boundary" warning spammed the log (4× per tick, visible live).

**Fix:** scores are now **magnitude-only** (25/15/8); direction travels in
`signalClass` (bullish above level, bearish below) — matching MST-002 and the
`bullishRaw`/`bearishRaw` accumulation in `protocol-gating.service.ts`.
`minScore = 0` declaration is now honest.

**Tests:** 2 mirror tests added to `indicator-symmetry.spec.ts`
(equal magnitude both sides + non-gold neutral). 9/9 pass. Build + protocol
direction validator pass.

**Runtime verification:** ✅ 2026-09-09 — backend restarted on the new build
(v1.4.0 registered, `ScoringService` debug shows `gold-round-numbers v1.4.0 (maxScore=25)`).
Tick #1 completed with **zero** `gold-round-numbers … clamped at boundary` warnings
(previously 4× per tick). Stack fully restored (bridges 2/3 on 5000/5001, NestJS 3201, Vite 5173).
⚠️ Per fail-closed design, broker `tradingEnabled` resets to false on every restart —
re-enable via the UI toggle or `POST /api/automation/config`.

### Fix queue (next in order)

1. `earnings-proximity` / `cad-usd-oil-correlation` — producer-trace (mode 4).
2. Constant-output review: `budget-gate`, `rollover-risk`, `pattern-density-sr`, `position-size-kelly`.
3. Guard mode 7 — point the readiness check at the real signal store, then re-run.

---

## 6. Guard Run #2 + three fixes (2026-09-10)

`node nest/scripts/directive-guard.cjs --db` → **0 errors, 82 warnings** (from 199).
The drop is mostly the guard measuring the right thing (§6.4) plus real fixes.

### 6.1 Producer-trace defects (mode 4) ✅

Both directives read an input no producer writes. Neither had live impact, but both
were structurally dishonest, so both were corrected rather than left as noise.

- **`cad-usd-oil-correlation` v2.0.1 → v2.1.0.** The `WTI > $85 → +25` tier was
  unreachable (`wtiValue` has 0 writers), so 25 of `maxScore 125` were phantom
  points inflating every protocol denominator. Removed the tier, `maxScore 125 → 100`,
  `requiredDataFeeds ['oil'] → ['dxy']`. Also removed two constant floors: a non-CAD
  symbol scored a flat `50`, and a no-macro-data symbol scored a flat `50` — both now
  `0` (no evidence = no contribution). Same treatment `gold-macro-correlation` got in
  2026-08-14. All 5 protocols using it are inactive, so no live score moved.
- **`earnings-proximity` v2.0.1 → v2.0.2.** The mock branch returned a constant `45`
  ("Mock-neutral score"). Now returns `0` with an honest reason, so it cannot inject a
  phantom contribution if it is ever re-enabled before a feed is wired. Stays at
  `alpha` (excluded) per #626/#648 — rehoming it as a screener catalyst is still the plan.
- Both classes and their 5 `global_setting` / `directive` / `protocol_directive_entry`
  weight rows were synced (the DB config layer outranks the class at runtime, and the
  boot seed only rewrites it on restart).

### 6.2 Indicator correctness — session instants ✅ (the big one)

`session-open-effect` is `ready` and sits in 10 active protocols, yet its scoring rows
showed **6,308 evaluations, all `0`**. Root cause was a timezone bug, not the strategy:

```ts
// OLD — parses the ZONE's wall clock in the MACHINE's timezone
const d = new Date(onDay.toLocaleString('en-US', { timeZone: iana }));
d.setHours(oh, om, 0, 0);
```

Measured on this (Europe/London) machine: New York's 09:30 open resolved to
**08:30 UTC (5h early)** and Tokyo's 09:00 open to **08:00 UTC (8h late)** — London was
correct only by accident of the machine's zone. So the ±30-minute window rarely matched
a real open and the directive never left its no-signal branch.

- **New shared helper `nest/src/common/utils/session-time.ts`** — `zonedWallClockInstant()`
  (two-pass offset refinement, DST-correct, no dependency), plus `zoneOffsetMs`,
  `minutesInZone`, `minutesFromOpen`.
- Applied in `session-open-effect.directive.ts` and `market-sessions.service.ts`
  (`localOpenTime`/`localCloseTime` — the same broken pattern was scheduling session
  calendar events at wrong instants).
- The same pattern also affects the London-vs-machine assumption globally; any machine
  not in the session's own zone was wrong.
- Tests: `session-time.spec.ts` (absolute UTC expectations that hold on any machine) and
  `session-open-effect.directive.spec.ts` (proves the directive now fires at the real NY
  and Tokyo opens, and stays silent mid-session).

### 6.3 Constant-output triage (mode 1) — all four were false positives

| Directive | Verdict |
|---|---|
| `budget-gate` (100) | Decommissioned 2026-09-08, `alpha` → excluded from scoring by `directive-inclusion.ts` rule 1. Constant is by construction. |
| `rollover-risk` (100) | A **gate-group** directive: `isRiskGate` groups are a multiplier path, never additive (#716). `maxScore` outside the rollover window means "gate open". |
| `position-size-kelly` (30) | Hardcoded stub, `alpha` → excluded. Wiring Kelly needs portfolio-level win rate/loss ratio in `DirectiveInput` (a feature, not this sweep). |
| `pattern-density-sr` (90) | Real maths; the guard's synthetic A/B pair produces the same branch. Needs ≥40 bars and 4+ reversals. |

### 6.4 Guard mode 7 now measures the right thing ✅

Mode 7 previously flagged **115/129** `ready` directives as lacking evidence because it
judged every `ready` directive against a `score` table that only covers protocols which
persist breakdowns. It now filters by:

1. **admission** — the canonical rules (`directive-inclusion.ts`): a bearish directive in
   a LONG_ONLY protocol can never produce evidence (`rsi-overbought`: 12 of its 13 active
   protocols exclude it by bias, and the one SHORT_ONLY protocol admits it but does not
   persist breakdowns);
2. **persistence** — the directive must be admitted by an active protocol that actually
   writes breakdown rows;
3. **sample size** — fewer than 10 records is "too few to judge", not a defect.

Result: **115 → 1** finding. The one that remains is the genuine production constant
(`session-open-effect`, 6,308 records / 1 distinct value) — fixed in §6.2, so it will
clear as fresh evidence accumulates.

### 6.5 Clean-up

- `nest/src/app.controller.spec.ts` asserted `version === '0.4.0'` while the app is
  `0.5.4` — it now reads `package.json`, so the suite is green (171/171) and cannot drift.
- Guard weight rows synced; temp diagnostics removed.

---

*Last updated: 2026-09-10.*
