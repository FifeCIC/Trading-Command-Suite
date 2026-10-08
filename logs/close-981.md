# #981 — name-vs-window audit for every bot + advisory pre-open alert — CLOSE (2026-10-08)

## Pre-close checklist — evidence per acceptance criterion

**1. `auditNameVsWindow` fires for a bot with `sessionWindow = NULL` — canary both directions** — ✅

**Root cause (structural, not a wrong value):** the audit was called ONLY from `logSessionSkip()`
(`automation-loop.service.ts` L1708/L1965), which is reached ONLY when `checkSessionWindow()` returns
a skip. A NULL window is UNGATED → `ok:true` → no skip → **the audit could never observe an empty
slot**. A Sydney-named bot with no window was invisible to the check written to catch exactly that.

**Fix:** `auditBotWindows()` (`automation-loop.service.ts`) now runs `botWindowState()` (new, in
`trading/session-window.ts`) for **every active bot, every tick** — gated, ungated, or in-window —
and rewrites the per-bot record each tick. The map (`sessionGated`) is now written by ONE writer
(the pass); `logSessionSkip()` keeps only the transition LOG; the `sessionGated.delete()` on a
passing bot is REMOVED (it would have deleted the ungated record — the finding).

**Canary (observed, both directions):**
- Reverting the ungated branch (`'ungated — no session window declared'` → `'within window (none)'`)
  → spec fails: `Tests: 2 failed, 11 passed` (first test + distinct-readings test).
- Embedding `${m}` in the alert title → same run fails the collapse-stability test.
- Restore byte-exact → `git diff` shows additions only, `Tests: 13 passed, 13 total`.

**Structural dead-path proof (in the spec):** `checkSessionWindow(null)` → `ok:true`,
`reason: undefined` — i.e. **no skip existed to trigger the old call site**. The spec carries this
assertion with the comment naming the defect.

**2. An alert is raised ahead of a session open and NO trade behaviour changes** — ✅

Structural: the alert path (`checkPreOpenSessionAlert`) calls ONLY `collapseOrCreateAlert()` +
sets a status block. It cannot gate, pause, close or size — no dispatch call exists on that path.

Live (2026-10-08, API 0.120.1, build from this change): threshold raised to 90 for a deterministic
window (row removed afterwards → absent = the declared default 30):

```
preOpenSession: {"state":"ok","session":"ny","minutesUntilOpen":59,"alertActive":true,
  "alertTitle":"New York (US session) opens soon — 2026-10-08"}

alert row f4baf430-… | repeatCount 1 | severity info | dismissed 0 | createdAt 12:31:18

decision_log 12:28→12:35 (three ticks):  OBSERVED 5 · BLOCKED 9   (no EXECUTE, no order rows)
```

**3. The alert collapses — ONE row through a full window** — ✅

```
SELECT COUNT(*) rows_total, MAX(repeatCount) maxRepeat … WHERE title LIKE '%opens soon%';
→ rows_total = 1   maxRepeat = 2   first = 12:31:18   last = 12:33:17   (two ticks, one row)

detail (updated in place, minute count moved 59 → 57):
"New York (US session) opens in 57 minute(s). Bots waiting on this session: 9 bot(s): Dow Index
 Tick Scalp, Tech Giants - AVGO, … +5 more. Open positions right now: 7. Advisory only — no
 automatic trade action."
```

Title is day-scoped and minute-free — the collapse key `(type, title)` cannot split per tick; the
spec pins stability across minute changes and day scoping (canaried: embedding the minutes in the
title fails the stability test).

**4. A failed or unknown session read must not render as "no alert pending"** — ✅

`planPreOpenSession()` returns `kind:'unknown'` for a missing roster row or an unresolvable
next-open — never `none`. The loop maps it to `preOpenSession.state='unknown'` + a warn logged
once per transition; `GET /api/automation/status` exposes the state so absence is distinguishable
from failure. Spec: `roster without the watched session is UNKNOWN — never "none"` and
`not open AND no resolvable next-open → UNKNOWN`.

**5. The three NULL bots are named in the audit output** — ✅

Live `GET /api/automation/status` (tick #1, 2026-10-08 12:29:17Z — first pass after deploy):

```
Sydney AUDJPY Session      gated:false  reason:"ungated — no session window declared"
  note:"name references sydney but the bot is UNGATED — no clock is enforced"
GBPCAD Macro Session       gated:false  reason:"ungated — no session window declared"
Wellington NZDJPY Session  gated:false  reason:"ungated — no session window declared"
  note:"name references wellington but the bot is UNGATED — no clock is enforced"
```

All three were the bots from the issue's 2026-09-23 measurement — still NULL in the DB, and
**before this change no surface anywhere listed them.**

**6. Gate 3 — `GET /api/automation/status` showing the audit result for a NULL bot** — ✅

```json
{
  "strategyId": "6ebd9aae-bf3f-4dfb-aa78-e3358ea922a8",
  "name": "Sydney AUDJPY Session",
  "symbol": "AUDJPY",
  "reason": "ungated — no session window declared",
  "allowed": [], "active": [],
  "nameWindowAgreement": "consistent",
  "nameWindowNote": "name references sydney but the bot is UNGATED — no clock is enforced",
  "gated": false,
  "at": "2026-10-08T12:29:17.974Z"
}
```

Contrast, same payload — a DECLARED window, currently shut (the readings do not collapse):

```json
{ "name": "US SPY Speed", "gated": true,
  "reason": "outside US session (open: London)", "allowed": ["us"], "active": ["london"] }
```

`sessionGatedBots` went from **2 entries (gated only) → 39 (every active bot)** — the list the
audit was supposed to produce.

## Gates

- **Structural** — `npm run typecheck` (nest): clean. `build:api` full prebuild chain: ✅ (one
  interim failure: `docs/PIPELINE-MAP.*` stale from the new files — regenerated with
  `generate-pipeline-map.cjs --write`, then green). Build succeeded, API restarted, `/api/version`
  answered (0.120.1).
- **Contract** — prebuild validators incl. pipeline contracts (the `sessionGated`/`getSessionGated`
  markers the validator watches are kept by the new pass): ✅
- **State** — live: `sessionGatedBots` = 39 (all active bots, `gated` flag present); NULL bot rows
  verified above; alert table holds ONE row for the window; setting row for
  `automation.preOpenAlertMinutes` was created for the test and **removed** afterwards (absent =
  declared default 30).
- **Behaviour** — three ticks observed: tick 1 = audit populated (39 entries); tick 2 =
  `alertActive:true` + row created; tick 3 = same row, `repeatCount 2`, detail updated. No EXECUTE
  decisions in the window (OBSERVED 5 / BLOCKED 9, the same risk-cap blocks as before the change).

## Not done / Deferred

- **#982** (make the slot DECLARED) is the follow-up and must run AFTER this issue produced the
  NULL list — the list is now being written every tick.
- The alert watches `ny` only (per the issue: "start with ny"). London/Tokyo are a second entry in
  `PRE_OPEN_SESSION` + the same loop.
- No gate, no auto-flatten, no entry block — deliberately out of scope (owner: "no automatic
  effect"; #928 Part 2 did not reach significance for a rule).
