## Pre-close verification — #916 ✅ (the actor was named, and the assumption is now enforced)

**Owner's answer, 2026-10-07 (R46):** *"Yes I think that was me bulk closing the positions."* — the same-second MT5-side closes were the owner's own bulk closes. They **stopped on 2026-10-02** (0 in the five days since; 2-13/day before). And the owner's same-day direction — *"The app should assume that it was me if there is no record of the bot closing a position"* — has been implemented, so this class of close is now **attributed, not parked in a bucket**.

### What changed (shipped, built, guarded)

| Piece | Before | Now |
|---|---|---|
| `closeReasonFromDealReason()` (unstamped CLIENT/MOBILE/WEB/EXPERT, reasons 0-3) | `broker:terminal` ("actor NOT identified") | **`user:manual`** — owner direction R46. Rollover/vmargins/split (7-9) stay in the bucket; **no observable deal at all** stays `broker:unknown` (absence ≠ a person) |
| `closeReasonFromComment()` `TCS:session-exit` | parsed to `null` → fell to the enum → **our own session-exit close landed in broker:terminal** | → `system:session-exit` (a latent misattribution fixed) |
| `TCS:close-all` / `TCS:close-profitable` | n/a | → `user:manual` (operator-invoked bulk endpoints) |
| Bridge `/close/partial` comment | `'Partial close'` — **no `TCS:`**, parsed as foreign | `TCS:<origin>` (default `partial`) |
| Bridge `/orders/bulk` close comment | `'TCS Bulk Close'` — wrong shape, parsed as foreign | `TCS:<origin>` (default `bulk-close`) |
| Every NestJS `/close` call site | three carried no origin (deprecated endpoint, `close-all`, `close-profitable`) | all name their origin; adapter/manager partial paths pass `origin` too |

### Evidence

- **Guard canaried:** reverting the 0-3 mapping to `broker:terminal` → **4 tests FAIL** (`close-reason.spec.ts`); restored → 14/14.
- **Class guard added:** `validate-bridge-order-choke-point.cjs` **R5** — every position-targeting market request in the bridge must carry a `TCS:` comment, and every NestJS `/close` call site must name an `origin` (the rule caught a doc-string false positive on its first real run and was narrowed). **Self-test 17/17**, real tree green, and R5 runs in `prebuild`.
- **Suites:** `close-reason` + `position-sync` + `mt5-trading` = **43/43**. Bridge compiles (`py_compile` 0). API rebuilt and serving (see close confirmation).
- **The precondition, stated:** the "assume the owner" rule is only safe while every app close **stamps its closer** — that is exactly what R5 now enforces, on both sides.

### Item status (the issue's own asks)

1. ✅ **Record the close reason on every close** — shipped 09-20 (v0.51.2/.3) + surface (Trade Journal chips); re-verified in today's distributions.
2. ✅ **Identify the early-exit mechanism and decide whether it is intended** — the actor is **named and answered by the owner** (R46); the residual winner-truncation is separately measured as **structural, not a villain** (winners capture ~11% of tpPct across every actor — register row 21 amended; calibration belongs to the strategy-by-strategy review).
3. ✅ **Report realised payoff per bot alongside win rate** — already served: `bot-performance.service.ts` + `symbols.service.ts` compute per-bot realised payoff (null when a side has no observations — information, not zero); surfaced on the bot pages/Trade Journal.

### Residuals, declared

- The **93 historic `broker:terminal` rows keep their bucket label** — the record of the 13-day search is not rewritten; the label reads *"Closed at the broker — actor NOT identified"* and the docblock now carries the resolution.
- `broker:unknown` still exists for closes with **no observable deal**; it is not the owner by default.

Nothing in scoring, maths or sizing was changed — this is attribution only.
