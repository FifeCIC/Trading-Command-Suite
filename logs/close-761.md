## Pre-close verification — #761 ✅

**The rescale shipped 2026-09-15; this close verifies it against the live system and pins it with a guard.** Every claim below has its command/observation.

### Acceptance criteria — all five ticked (body updated)

| # | Criterion | Evidence |
|---|---|---|
| 1 | Thresholds from a **measured** distribution, reasoning recorded | Rescaled 09-15: entry 40→6, strong 80→13, gate 65→10 — a ÷~6.3 units migration against the frozen CONFIGURED denominator; derivation recorded at `protocol-gating.service.ts`, `style-thresholds.ts`, `scoring.service.ts`; register row 10 updated today |
| 2 | All bands occupied, none saturated | Stored classifier labels, 7 days: **BUY 8,098/26 protocols · HOLD 5,150/21 · STRONG_BUY 1,930/24 · SELL 32 + STRONG_SELL 320** (vix-short-v1) |
| 3 | Gate decided + justified | `GET /api/scoring/gated/thresholds` (2026-10-07T13:13:47Z): `classification {entry 6, strong 13}` · `preTradeGate {default 10, byStyle {scalp 12, speed 13, day-trade 10, swing 9, position 7}}` + #759 bot-bar reconciliation (lowers only) |
| 4 | QA asserts bands reachable | Procedure + first run in "QA entry" below; handed to the Librarian |
| 5 | Block rate before/after | **Before:** decision_log shows zero executions and the queue empty 2026-09-11→09-14 · **After:** resumed 09-15 (9 that day; 4–31/day since; queue 1–7/day). Current blocks are risk-layer (daily loss · portfolio risk · duplicate guard) — no longer the strength gate |

### Sub-questions the issue left open

- **Risk multiplier 0.0000** — answered: a stored `0` has **never occurred** (min 0.741 across all **16,053** `score` rows, 2026-09-10→now; 99.9% ≥ 0.8). `0` is only reachable as a hard-gate veto (by design — composite zeroed, `risk-gating-engine.service.ts`). The "second multiplicative suppressor" risk measured **minor**: the multiplier is not materially shrinking composites today.
- **`xau-speed-v1` never produces a run** — RESOLVED: first `Score` row 2026-10-01; 466 rows since (peak 20.9% on the current scale).
- **Control-protocol efficiency (33.3% vs 47.8% "reachable")** — the residual loss is directives that never co-fire on one bar; the multiplier is 1.0 for that protocol and the moving-denominator selection defect (#813) was fixed via #818. This matches `PROTOCOL-THEORY.md`'s declared per-protocol ceilings → **protocol directive-set review (#688-class), not a threshold defect.**

### Guard added — canaried both ways, restores verified

**`nest/src/modules/scoring/signal-threshold-scale.spec.ts`** — 5 tests pinning: entry 6 / strong 13 · scale = CONFIGURED · band-boundary arithmetic (worked example on gold-macro's 795 capacity) · style table values + preserved ordering · gate defaults + extended-vocabulary resolution ("Session / Mean Reversion" → day-trade).

- Canary A: `ENTRY_THRESHOLD` 6→40 (the pre-rescale value) → **2 tests FAIL** · restored byte-for-byte (`git diff` clean).
- Canary B: style `swing` 9→14 (breaks ordering) → **1 test FAILS** · restored byte-for-byte.
- Existing class guards also cover this: `weight-strategy-inert.spec.ts` (configured-denominator pin), `directional-capacity-contract.spec.ts`, `validate-threshold-sources.cjs` → **OK — every threshold has exactly one owner**.
- `validate-decisions.cjs` → 67 rows, all with a guard status · `nest run typecheck` → clean.

### QA entry (for the QA page)

- **area:** Scoring
- **name:** Classification bands are reachable on the configured-denominator scale
- **procedure:** `SELECT breakdown->>'$.signal' label, COUNT(*) n, COUNT(DISTINCT breakdown->>'$.protocolId') protos FROM score WHERE timestamp > DATE_SUB(NOW(), INTERVAL 7 DAY) GROUP BY label;` and `GET /api/scoring/gated/thresholds`
- **expected:** All of BUY/HOLD/STRONG_BUY non-empty, each covering ≥10 distinct protocols; endpoint serves `entry 6 / strong 13`; `activeCannotFire` small with each named bot explained (live today: **1** — Gold Position 4H, bar 8 vs gold's quiet 7-day ceiling 6.8 — a market condition, not a scale leftover; all bot bars are on the rescaled scale, 1–10)

### Honest notes (found, declared, not hidden)

- `activeNoData: 1` — "London EURUSD Macro" bot points at `eurusd-macro-v1`, which is **inactive** (awaits the #797 FX-majors rollout). Tracked there, not a #761 defect.
- Adaptive Target remains **disabled everywhere** (0 of 52 protocols) — the documented "silently loosens trading" interaction stays dormant; no action needed today.
- **Stale QA texts found** (handed to the Librarian for refresh): "65/40/80 thresholds" references and "no guard test for the pair" (now false — the guard shipped today).
