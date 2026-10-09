## Pre-Close Verification — the audit, with every criterion measured

> The fix half (2026-09-10) landed before this issue's remaining criteria. This comment is the
> **audit the criteria asked for**, plus two live defects the audit found and fixed.

- [x] **A build-time guard flags a non-zero constant baseline on a no-signal path in any directive.**
  `INV-NO-FABRICATED-READING` (`nest/scripts/validate-pipeline-contracts.cjs`, runs in `prebuild`, zero whitelist entries) covers BOTH shapes: sign-test direction AND non-zero score on a could-not-measure path. **Canaried 2026-10-09, and the canary found two real evasion gaps — both closed:**
  - **M1 (sign test)** — injected `signalClass: x > 0 ? 'bullish' : 'bearish'` into a real directive → build gate **FAILED**, exit 1, naming file:line. Restored byte-for-byte.
  - **M2 (templated floor)** — injected `score: 30` on a `Need ${MIN} bars` path → **ESCAPED**. The reason test ran on the raw template, so `Need ${MIN} bars` never matched `need \d+ bars`. Placeholders are now normalised. Re-run → **FAILED** naming the line. Restored.
  - **M3 (computed floor)** — restoring `Math.round(15 * closes.length / 200)` → **FAILED** with the new computed-expression branch. Restored. Precision side observed in the same run: `surge.directive.ts`'s *"Spike FAILED"* (a measured outcome, not a measuring failure) does **not** fire — the `failed` term was narrowed to failures of the measuring act.
- [x] **Every `ready` directive audited for fabricated floors, sign-test direction, unreachable maxScore.** Findings below. Method: the build scan (shapes 1+2) + `directive-guard.cjs` **new mode 9** (maxScore reachability, all-literal arithmetic only; dynamic = explicit "cannot judge") + mode 7 runtime evidence (last 5,000 `score` rows) + a value/reason probe.
- [x] **Fabricated floors fixed → `unmeasured`.** Two found; both fixed (below).
- [x] **Renaming decision recorded.** Display name → **'Momentum Acceleration'; the id stays** `analyst-adjustments`. Reason: measured **11 ACTIVE protocols** reference the id via `protocol_directive_entry`; it is written into score breakdowns and seeds, and a half-done id migration orphans entries silently (#801's class). The name is the thing a user reads; the DB `directive.name` converges from the class on boot. Three homes: marker at the class, register **row 78**, this comment. 🔴 unguarded by design.
- [x] **rsi-oversold 140 vs 130 resolved — the premise was STALE, and the number is right.** The docstring says `MAX: 140 (50 base + 80 extreme bonus + 10 curl)` and has since **2026-08-14** (`20127a0`, 27 days before this issue was filed — the audit note described the pre-fix file). Reachability verified from code: RSI ≤ 30 → base 50 (mapRange clamps), RSI < 20 → +80, curling → +10 ⇒ **140 reachable**, no stale `130` anywhere in the file.

## 🛑 Found and fixed by this audit — two PRO-RATED FLOORS

| Directive | Shape | Evidence (measured) | Fix |
|---|---|---|---|
| **`sp500-regime`** | `score: Math.round(15 * closes.length / 200)` on the "Need 200+ bars" path — a floor of up to 15, **pro-rated by how close the window is** | LIVE: **241 records in the last ~24h, all exactly 5** ("Need 200+ bars, have 72"), in the `vix-spike-v1` / `vix-short-v1` RISK GATE | `score: 0, unmeasured: true`, reason names it. Spec: `directive-floor-contracts.spec.ts` (canaried — restoring the formula fails exactly the new case: *Expected 0, Received 5*) |
| **`like-zacks`** | `score: Math.round(10 * closes.length / 50)` on the "Need 50+ bars" path | Latent (readiness `beta` ⇒ excluded by the readiness gate today; would have gone live on promotion) | Same fix, same spec file |

**Live-verified on 0.122.0 (2026-10-09 ~17:36Z):**
- `POST /api/directives/sp500-regime/test` (US500 5m) → **`score=0, unmeasured=true`, neutral** —
  *"Insufficient data: need 200 bars, have 100 — unmeasured"* (old form: `round(15 × 100/200)` = 8).
- **Recorded in production after the restart: `0`** with the new reason (`values=[0, 5]` — the 5s are
  the 241 pre-fix history rows; every post-restart record is 0).
- `GET /api/directives` → display name **Momentum Acceleration**; the DB row converged from the
  class on boot (`id` unchanged).

⚠️ **Why the original guard missed both:** the score match was **literal-only**, and this floor is
COMPUTED. Invisible to a pattern that only sees `score: 5`. The guard now flags **any non-`0` score
expression** on a path whose own reason admits no measurement.

## Criterion 2 — the audit record

**Sign-test direction:** scan clean across every implementation file (M1 proves detectability).

**Unreachable maxScore — `directive-guard.cjs` MODE 9 (new):** 33 directives judged (all-literal arithmetic), **28 flagged**, 126 **manual — "cannot judge"** (dynamic arithmetic; e.g. `gold-session-profile` returns shorthand `{ score, … }` where score is `Math.max(10, Math.min(90, …))` — the first draft under-read it as 20 and the fix is what moved it to manual; two false-positive classes were closed by spot-check: shorthand returns and `+=` accumulation).

The 28, all `declared > reachable`: `mt5-dark-cloud-piercing` 85, `mt5-engulfing-cci` 85, `mt5-engulfing` 85, `mt5-hammer` 80, `mt5-harami` 80, `mt5-star-doji` 90, `awesome-oscillator` 75, `chaikin-mf` 80, `donchian-breakout` 75, `keltner-channel` 70, **`supertrend` 55** (its canonical form is a flat 55), `adx-di-crossover` 80, `bollinger-pct-b` 70, **`atr-trailing-stop` 75** (ATR-unit form), `momentum-roc` 80, `demarker` 65, `accumulation-dist` 70, `bulls-bears-power` 75, `ease-of-movement` 65, `ichimoku-cloud` 80, `analyst-adjustments` 70, `opex-gamma` 5, `position-size-kelly` 30, `santa-claus-rally` 15, `september-slump` 16, `triple-witching` 3, `turnaround-tuesday` 12, `wick-filter` 80.

⚠️ **These are recorded, NOT fixed here** — declared `maxScore` is the core of every protocol's
denominator, so changing 28 of them is a maths change (`maths-change-requires-ab.instructions.md`),
not a guard's side effect. **Queue row R52** asks the owner how to batch them (they are phantom
capacity of exactly the shape `analyse-unreachable-capacity.cjs` measures — median protocol already
shows **46.5% never-directional** share).

**Production evidence triage (mode 7 — 6 ready directives constant over the last ~24h):**

| Directive | Constant | Verdict |
|---|---|---|
| `earnings-momentum` (794) / `social-buzz` (935) | **0** | **Justified** — honest zero; the reason names the missing import ("No stored earnings data…"). Contributes nothing; tracked separately as a readiness-badge question, not a floor. |
| `btc-halving-cycle` (141: 20) / `crypto-weekend-effect` (380: 10) | 20 / 10 | **Justified as date-driven** — the DATE is the measurement (phase "Day 901/902", "Weekday (Thu)"). Belongs to **#879** (calendar-effect biases), not this issue. |
| `session-open-effect` (3,543: 0) | 0 | **Justified** — 0 *outside the ±30min window by design*; the 2026-09-10 all-zeros bug (6308 records) was this directive's fix landing correctly. |
| **`sp500-regime` (241: 5)** | 5 | 🛑 **A defect — fixed above.** |

## Deliberately unchanged

- **The 28 unreachable ceilings** — maths; recorded above + R52. Not a guard's privilege to change denominators.
- **`like-zacks` readiness stays `beta`** — the floor is fixed, but promotion is a separate decision (#627 process).
- **`minScore = 1` on rsi-oversold** (while a reachable score is 0): `minScore` is registry/config metadata — verified **no consumer clamps scores to it** (`sanitizeDirectiveResult` clamps `[0, maxScore]`). Recorded, not changed.
- **Zero-scores without `unmeasured`** (e.g. social-buzz/earnings-momentum): honest zeros are not the flagged shape (the gate flags non-zero only). A mass edit would be churn against a live tree; the convention is documented on `DirectiveResult.unmeasured`.

## Deferred

- **The R52 maxScore batch** — owner decision named above; deliberately not smuggled into this landing.
