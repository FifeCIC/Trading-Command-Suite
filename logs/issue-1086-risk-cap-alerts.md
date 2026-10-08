# The two risk caps refuse orders SILENTLY — 722 refusals in one day, no alert, no notification, no count

**Found 2026-10-07** while answering a direct question from the owner: *"Is maxDailyLoss global or per position or per account? … Is that the case?"* The answer required querying `decision_log` by hand, which is the defect.

---

## The measurement

`decision_log`, 2026-10-07, UTC day:

| block reason | refusals | symbols |
|---|---|---|
| `Daily loss $178.02 exceeds risk.maxDailyLoss ($100)` | **440** | 13 |
| `Portfolio at risk 17.7–18.3% exceeds risk.maxPortfolioRisk 15%` | **~282** | ~10 |

**Executions that day: 7.** The app was locked out of new entries for most of the day and **nothing said so**:

- `risk.maxDailyLoss` is read in exactly two places — the entry gate, and a health-page comparison of app-setting vs bridge-limit. **Neither raises an alert.**
- There is no notification, no Alert Center row, and no aggregate count anywhere.
- Each refusal writes one `decision_log` row among hundreds of others, so the signal is present and unreadable.

⚠️ **The failure is `development-philosophy §7` exactly: a system can be correct and still be a defect, if the correct behaviour is invisible.** Both caps are doing precisely what they are configured to do. What is missing is that anyone is told.

## What this does NOT change

⚠️ **No threshold moves.** `risk.maxDailyLoss` (100) and `risk.maxPortfolioRisk` (0.15) are **unchanged** — a cap is a number that gates a trading decision, so changing one is *the maths* and needs a copied configuration and a monitored comparison (`maths-change-requires-ab`). This issue is about **visibility only**.

⚠️ **Nothing escalates.** The caps keep returning `{ allowed: false }`. No fix here calls `emergencyStop()`, deliberately: `emergencyStop()` → `stop()` also halts the **Stop Guardian** (trailing-stop tightening on open positions), so auto-escalation would make positions *loosely* managed at the moment losses are running, and it still could not reach a path that bypasses the caps.

## The fix — two triggers, deliberately different

Added to the existing `AlertTriggerService` registry (no new mechanism — it already provides cooldown, the Alert Center row, the canonical-log line, and the `ATTENTION_KEYS` Windows toast):

| key | severity | cooldown | attended (toast) | why |
|---|---|---|---|---|
| `risk-daily-loss` | `critical` | 30 min | **yes** | a **LATCH** — cannot clear until local midnight, so every bot stays blocked for the rest of the day |
| `risk-portfolio-risk` | `warning` | 60 min | no | a **CAPACITY STATE** — clears itself as positions close or stops tighten; a toast for something that resolves on its own is how the toast channel gets ignored |

**Fires on a persisted breach, not a single order:** ≥5 refusals inside a 30-minute window. A momentary over-cap on one order is a transient and stays quiet.

**It reads the recorded refusal rather than re-deriving the number.** The refusal already carries the cap, the figure and the accountable positions:

```
Daily loss $178.02 exceeds risk.maxDailyLoss ($100)
Portfolio at risk 18.1% exceeds risk.maxPortfolioRisk 15% — #152730169965 AMZN |entry−SL|…
```

Recomputing the day's P&L or the book's at-risk figure inside the alerts module would be a **second implementation of a money calculation** — the repo's most expensive kind of debt. The row is the evidence and it is the row an operator would grep for.

⚠️ **Stated limit:** the check can only fire when something *tried* to trade. A breached cap with no signals produces no rows and therefore no alert. That is why the message reports a **count of refusals** rather than claiming the cap is breached generally.

## Acceptance criteria

- [ ] A breached cap produces an Alert Center row naming the cap, the refusal count, the symbol count and the recorded reason
- [ ] The daily-loss trigger raises a **Windows notification**; the portfolio-risk one does **not**
- [ ] Below the threshold it is **silent** (a transient must not alert)
- [ ] The window uses `UTC_TIMESTAMP()`, never `NOW()` — the trap this file already documents
- [ ] The title is stable (no count in it), so one condition cannot fracture into many rows
- [ ] Canaried in both directions

---

**Related:** #1082 (the order choke point — until it exists, a gate is optional for whatever path is added next) · #1079 (the A/B arm whose £134.71 loss tripped the daily cap today) · #943 (trader controls) · `development-status.instructions.md` puts risk limits in the "always treat as production" exception
