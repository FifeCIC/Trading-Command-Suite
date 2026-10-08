## Pre-close check — deployed, and OBSERVED firing on the live condition

### Acceptance criteria

- [x] **A breached cap produces an Alert Center row naming the cap, the refusal count, the symbol count and the recorded reason.**
      Observed live, unprompted, ~2 min after the build: `alert` table holds
      `type='trading'`, `title='Trading blocked by the daily-loss cap'`, `severity='critical'`, `createdAt 2026-10-07 20:09:22`.
      The message reads: *"165 order(s) refused across 13 symbol(s) in the last 30 minutes by
      `risk.maxDailyLoss`. Newest: `Daily loss $178.02 exceeds risk.maxDailyLoss ($100)`"*. The condition was real and
      ongoing when it fired — measured at 20:11:23, the newest refusal was **4 seconds old**.
- [x] **The daily-loss trigger raises a Windows notification; the portfolio-risk one does NOT.**
      `risk-daily-loss` is the only new key added to `ATTENTION_KEYS`. Canaried: removing it fails the toast test;
      the portfolio trigger's own test asserts `send` is **not** called while its Alert Center row still appears.
- [x] **Below the threshold it is SILENT.** Threshold 5 refusals in a 30-minute window; a canary with 4 refusals
      asserts `addAlert` and `send` are both untouched.
- [x] **The window uses `UTC_TIMESTAMP()`, never `NOW()`.** Guarded by a **source check** that slices
      `checkRiskCapBreach()` and asserts both the presence of `UTC_TIMESTAMP()` and the absence of `NOW()` — because
      this failure is silent (a window an hour out reports nothing, with no error). The same trap was paid for in
      this file on 2026-09-22.
- [x] **The title is stable (no count in it).** Asserted by firing the trigger with 6 and with 440 refusals and
      requiring an identical, digit-free title. A count in the title is how one condition fractures into a new
      alert row per count — corrected for `symbol-silent` on 2026-09-23.
- [x] **Canaried in both directions.** `logs/canary-1086-risk-alerts-v2.ps1` — **5 mutations, all 5 observed to
      fail, tree restored byte-for-byte on every one**, final run 8/8. Suite: `npx jest src/modules/alerts` →
      **4 suites / 28 tests pass**.

### ⚠️ Two things I got wrong, both in the CANARY SCRIPT rather than the guard

Recorded because the canary's own design is what caught them, and that is the point of the `CANARY INVALID` state:

1. **PowerShell treats `''` inside a single-quoted string as ONE literal quote**, so two anchors silently became
   un-matchable text. It reported **"anchor not found, edit was NOT made — refusing to report"** rather than a
   false pass.
2. **The title mutation injected a literal `${n}`** — single quotes in TypeScript do not interpolate — so it added
   no digit and could not fail a "no digits in the title" assertion. That canary read `DID NOT FAIL`, which is also
   correct reporting: the guard was fine, the mutation was empty.

v2 uses literal here-strings and a mutation that genuinely adds a digit.

### Not done / stated limits

⚠️ **The alert does NOT appear in the canonical structured log** (`nest/logs/tcs-<date>.log`), because
`AlertTriggerService` writes through the NestJS logger to stdout. Its surfaces are the **Alert Center** (persisted —
verified above), the **Windows toast**, and stdout. Writing to `SystemLogService` as well would need another injected
dependency; not done here, and recorded rather than left implied.

⚠️ **The check fires only when something TRIED to trade.** A breached cap with no signals produces no `decision_log`
rows and therefore no alert. The message reports a **count of refusals** rather than claiming the cap is breached
generally, so the alert does not overstate what it knows.

⚠️ **Nothing escalates, and no cap value moved.** Both caps still return `{ allowed: false }`; `100` and `0.15` are
unchanged. Auto-escalation to `emergencyStop()` was considered and **not** taken: it also halts the **Stop Guardian**,
so it would stop trailing-stop tightening precisely when losses are running, and it still could not reach a path that
bypasses the caps (**#1082**).
