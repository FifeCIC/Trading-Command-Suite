---
date: 2026-09-10
area: automation
type: bugfix
issues: [759]
invariants: [INV-QUEUE-TERMINAL-STATE, INV-GATE-RECONCILED, INV-SESSION-VISIBLE]
---

# META.Stack trace faults — four silent blockers on the trade path

## What Changed

Traced a registered, MT5-tradeable symbol (AUDUSD) end-to-end through META.Stack and fixed the
four faults that stopped qualified signals becoming orders. The app was **scoring correctly and
then discarding the result at four separate gates, each of which failed silently.**

## Why This Existed — the shared root cause

Every one of the four faults had the same shape: **a decision was made, the decision was correct
given its inputs, and nothing reported the decision.** No errors, no warnings, no rows. The score
was computed, plausible, and dropped. Three of the four were invisible from every surface the app
offers, so the only way to find them was to query the database by hand — which is what this trace
had to do.

That is the same failure class as `inv-gate-fails-closed` and the #750/#751 substrate bugs, and it
is why each fix below adds an **observable state**, not just a corrected condition. A corrected
condition with no visibility will regress undetected; that is precisely how these four accumulated.

---

## Fault 1 — Queue entries stranded in `executing` (INV-QUEUE-TERMINAL-STATE)

**Symptom:** `GBPUSD` sat at `status='executing'` from 13:07 with no ticket number, and the bot
never traded that symbol again.

**Cause:** `processSignalQueues()` wrote `status='executing'` for **both** `EXECUTED` *and*
`QUEUED`, then consumed the entry. But `executing` is not a state anything reads back — the head
query only selects `status='pending'`. So a `QUEUED` signal (awaiting human confirmation) left the
queue permanently. If the confirmation was never clicked, or the process restarted first, the row
stranded forever. The method's own docblock claimed *"BLOCKED and FAILED entries stay pending"* —
the code did not match its documentation.

**Fix:** terminal status is now **derived from the actual outcome**. Only a real `EXECUTED` consumes
the entry (`status → 'executed'`). `QUEUED` stays `pending` and is re-offered next tick, which is
the honest state for "waiting on a human". A bounded recovery pass also returns any row already
stranded in `executing` to `pending`, so the fix drains the field without hand-editing the DB.

**Verified live:** queue now reads `executed` (1) + `pending` (3) — no stuck rows. USDCAD reached
`executed`; the stranded GBPUSD row recovered.

## Fault 2 — Session gate blocked 3 of 6 forex bots, invisibly (INV-SESSION-VISIBLE)

**Symptom:** AUDUSD scored **100% STRONG_BUY**, `preTradeReady: true`, zero pre-trade blockers,
`scoreId` present, `holdsCfd: false` — and produced no order. Nothing in the app said why.

**Cause:** three bots carry `sessionWindow = 'asian'`, a **trading clock** (19:00–04:00 ET). Read as
a clock they are shut through London and the entire US session. They are named
*"Sydney AUDUSD Session"*, *"Tokyo USDJPY Session"*, *"Wellington NZDUSD Session"* — those cities
name the place whose **news drives the pair** (AUD news is Sydney, JPY news is Tokyo, NZD news is
Wellington), and the same word is also a trading session. Nothing in the data says which reading
was meant.

**⚠️ The window value is not wrong.** Verified against the live table: those bots store the literal
`asian`, not `sydney`. By the time it is a column value the decision *looks deliberate*. The
ambiguity lives in the **name**.

**Fix — deliberately NOT a window rewrite.** Silently un-gating three bots would be a trading
behaviour change dressed as a bug fix, and by definition it uses the other reading of an ambiguous
name. Instead:

- `auditNameVsWindow()` classifies each bot: `consistent` / `ambiguous` / `contradictory`. A city
  name over a session-tag window reports **both readings** so the operator can say which was meant.
- The gate now **publishes state**: `/api/automation/status` → `sessionGatedBots` lists every bot it
  is holding shut, with the reason and the verdict. The deduped log line is kept (a standing
  condition should not write per-tick rows) but it is no longer the *only* evidence.
- `checkSessionWindow()` stays **pure clock logic** and is unchanged. The audit is a separate
  function that provably cannot alter a gate — asserted directly in the spec.

**Verified live:** NZDUSD now reports `agreement=ambiguous` with the full note naming both readings.

**KNOWN and yours to decide:** the three `asian` windows are still in the DB. Every `asian` bot is
correctly gated right now, and will trade 19:00–04:00 ET as configured. Report expected the case to
surface, not be decided by an agent.

## Fault 3 — Pre-trade gate demanded more than the bots declared (INV-GATE-RECONCILED)

**Symptom:** `USDJPY` / `USDCAD` / `USDCHF` scored 50 / 50 / 50.6 and were dropped as
`Signal below 65% (50.0%) [style 'Session / Mean Reversion' → day-trade]`. Their bots declare
`minComposite` 60 / 55 / 55.

**Cause:** two independent thresholds decide whether a signal becomes an order — the pre-trade gate
(from the protocol's trading *style*) and the bot's `minComposite` (its configured *intent*). Nothing
reconciled them, so a bot set to act at 55 was starved by a gate of 65 it never mentioned. The signal
was discarded **before reaching the component whose configured intent governs it.**

**Fix:** `reconcileGateWithBots()` reconciles the style bar **down** to the lowest participating bot
bar. Two safety properties, both load-bearing:

- **Lowers only, and only to the lowest bot bar.** It never raises, so a style that legitimately
  demands more (scalp 75, speed 80) is untouched for bots that agree with it, and it can never make a
  threshold stricter than the operator asked for.
- **An explicit `signals.gate.<protocol>` override is left verbatim.** That is a deliberate human
  instruction, and a convenience rule must not silently overrule it.

Precedence follows the same pattern this codebase already uses for directive `maxScore`
(protocol override → global config → directive class). The blocker text now carries the gate's
provenance so the number is never a mystery: *"…reconciled down to the lowest participating bot bar (55)"*.

**Verified live:** USDCAD and USDCHF flipped from blocked to `preTradeReady: true`.

## Fault 4 — Stale bar coverage was invisible (diagnostic)

**Symptom:** `BTCUSD` held 177 hourly bars ending **2026-07-18** (7 weeks stale) with **no 15m and no
1d bars at all**, so both BTC protocols hit the controller's zero-bar fallback and returned the
hardcoded `composite: 50`. In the UI this read as "scoring".

**Fix:** `BarRefreshService.getStarvedSymbols()` reports symbols whose newest bar is stale or which
are missing a timeframe the pipeline provides. Restricted to protocol-assigned symbols, so the report
is actionable rather than listing all ~240 registry rows. Exposed as `starvedSymbols` on
`/api/market-data/bars/refresh/status` and refreshed each cycle.

**Verified live:** immediately named `BTCUSD (1294h, missing 4 timeframes)`, `BTC-USD (377h)`,
`US30 (1145h)`, and `SPX500`/`TECH100`/`USOIL` with **no bars at all**.

---

## The Theory — why these were invisible, and what prevents a repeat

Each fault is an instance of one principle: **a gate that returns "do not act" without publishing
"why" is indistinguishable from an idle system.** The healthy path and the blocked path produce the
same observable outcome — nothing happens — so the absence of activity carries no information.

Two of the four had *some* logging and it still did not help, which is the sharper lesson:

- Fault 2 logged one deduped line per bot per state change. Correct design (a per-tick row would
  flood `decision_log`) — but a single line that scrolls away is not observability. **The dedupe
  preserved the transition and threw away the state.** Splitting those two concerns is the fix:
  log the transition, publish the state.
- Fault 3 logged the block with the threshold and its provenance, in text, on a page a human has to
  open. The information was complete and still never acted on.

So the rule this establishes: **when a gate blocks, the block is a first-class fact about the
system, not a log line.** It belongs in an API payload that a page, an alert, or an agent can read
without knowing to look for it. That is now true of the session gate (`sessionGatedBots`), the
pre-trade gate (blocker text with provenance), the queue (`executed`/`pending` only, no resting
transit state), and bar coverage (`starvedSymbols`).

## Data Findings — reported, not changed

These are database facts an agent must not decide alone:

1. **10 assignments point at INACTIVE protocols.** `btc-scalp-v1` (BTCUSD, BTC-USD, ETHUSD, ETH-USD,
   SOLUSD), `dow-speed-v1` (DJI, US30), `oil-speed-v1` (NATGAS, UKOIL, USOIL). Nothing scores these
   while the protocol is inactive. Intent unclear — the assignments may be deliberately parked.
2. **Duplicate crypto symbols.** Both `BTCUSD` and `BTC-USD` exist, as do `ETHUSD` and `ETH-USD`.
   Only one matches MT5's naming; the other can never receive bars.
3. **Zero-length watchlists.** 23 watchlists, 0 `watchlist_item` rows. Membership lives in the
   `watchlist.symbols` JSON column only, so `watchlist_item` is dead weight (or an unfinished
   migration). `forex-majors.symbols` correctly holds all 7 pairs, which is why symbol resolution
   worked.
4. **The three `asian` session windows** (Fault 2) — the one decision that is genuinely the
   operator's.

## Files Changed

- `nest/src/modules/automation/automation-loop.service.ts` — terminal status derived from outcome;
  stranded-row recovery; `sessionGated` state + `getSessionGated()`; name/window audit on skip.
- `nest/src/modules/automation/automation.controller.ts` — `sessionGatedBots` in the status payload.
- `nest/src/modules/trading/session-window.ts` — `auditNameVsWindow()` + `CITY_WORDS`.
  `checkSessionWindow()` unchanged and still pure.
- `nest/src/modules/signals/signal-envelope.service.ts` — `reconcileGateWithBots()`, wired into
  `evaluatePreTrade`. Never raises; never overrides an explicit setting.
- `nest/src/modules/market-data/bar-refresh.service.ts` — `getStarvedSymbols()` + status field.
- `nest/src/modules/trading/session-window.spec.ts` — **NEW**, 15 tests.
- `.github/instructions/meta-stack-contracts.instructions.md` — 3 new invariants.
- `nest/scripts/validate-pipeline-contracts.cjs` — 4 canaries (14 invariants total).
- `src/data/qa-checklist.js` — 3 new QA entries.

## Verification

- **262 tests / 46 suites pass.** 4 failures remain in `directive-dedupe.spec.ts`, which is
  **another agent's in-flight work** (written 14:08:37, after my final edit at 14:06:41) testing a
  `dedupe` helper that does not exist in `protocol-gating.service.ts`. Not touched.
- Backend + frontend builds clean; pipeline-contract gate green at 14 invariants.
- **Every new guard proven by injection into a healthy file**, then restored:
  - queue-terminal-state: restoring `status='executing'` → guard FAILS ✅
  - session audit: neutering city detection → **4 tests FAIL** ✅
  - ambiguity reporting: removing it → **3 tests FAIL** ✅
- All four fixes confirmed against the **live API and database**, not just in tests.

## Future Note

`sessionGatedBots` is currently API-only. It belongs on an operational page next to the loop status —
a gated bot is a standing condition an operator should see without constructing a query. Same for
`starvedSymbols`. Both are one-line additions to an existing status view.
