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

*Last updated: 2026-09-09.*
