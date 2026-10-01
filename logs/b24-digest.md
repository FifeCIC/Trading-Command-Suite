============================================================================
FILE: 2026-09-27-1012-orphaned-history.md
date=2026-09-27 area=data type=bugfix
MISSING: Capability Map Entry + Architecture Framework Entry
WHAT: `deleteCopyProtocol()` now counts and reports the `score_snapshot` rows it orphans, instead of leaving them silently behind. The orphaned history is **kept** — a retention decision, recorded.
SLICE: (none)
CAPABILITY: (none) | persistence=- uiSurfaces=- pipeline=- completion=-
QA: - | (none) | proc:  | exp: 
ROUTES: NONE
SCHEMA: NONE
SHAPE: no
DIAGRAM: ABSENT
DEFERRED: **Nothing surfaces the orphan state in the UI** — visible to an agent running the audit, not to a reader of a page. Owner: #1012; natural home is the symbol protocol-com… ~ **Nothing can detect or prevent a by-hand `DELETE` of a `protocol` row** — the route that produced the two largest orphans.
UNCHANGED: **The orphan rows are not deleted.** `DELETE`/`TRUNCATE` would turn the audit green and destroy the only record of what those protocols scored. ~ **No protocol rows were re-created** to satisfy a join — that would re-attach old history to new meaning. ~ **`deleteCopyProtocol()` still does not refuse** when rows exist. Copies are created and removed routinely for A/B; a hard block would break that for a 1-row cost, and w…

============================================================================
FILE: 2026-09-27-926-protocol-authority.md
date=2026-09-27 area=data type=feature
MISSING: NONE
WHAT: `"Which protocols apply to this symbol?"` now has **one authority** — `SymbolProtocolAuthorityService`, a **ranked union** of six sources with per-entry provenance — and `GET /api/symbols/:ticker/protocols` **and** `getFocus()` both read it. Previously six mechanisms each held a partial answer and …
SLICE: (none)
CAPABILITY: (none) | persistence=- uiSurfaces=- pipeline=- completion=-
QA: - | (none) | proc:  | exp: 
ROUTES: GET /api/symbols/:ticker/protocols  ;;  GET /:ticker/protocols  ;;  GET /api/symbols/:ticker/focus  ;;  GET /api/symbols/XAUUSD/protocols  ;;  GET /api/symbols/XAUUSD/focus
SCHEMA: NONE
SHAPE: YES?
DIAGRAM: PRESENT
DEFERRED: **`getFocus()` `scoring_strategies` from disk** — owner **#926**. ~ **Orphaned `score_snapshot` history** (a retention decision) — owner **#1012**.
UNCHANGED: **The weaker sources are not filtered out.** They *add* protocols; `rank` records the strongest evidence. A first-hit chain would change its answer when an unrelated tab… ~ **`/focus`'s `scoring_strategies` still reads disk JSON.** Left as the staged second half; it is no longer used to decide which protocols exist. ~ **The guard is on demand, not `prebuild`.** It needs the API running, and every `prebuild` validator in this repo is static and reads no database.

============================================================================
FILE: 2026-09-27-935-readiness-verdict.md
date=2026-09-27 area=scoring type=bugfix
MISSING: NONE
WHAT: The SymbolPage "✓ Trade Ready" badge now reads the **same verdict the order path enforces** instead of `preTradeReady` alone — which required first annotating the drilldown endpoint with `executionBlockers`, because that endpoint carried **none at all**.
SLICE: (none)
CAPABILITY: (none) | persistence=- uiSurfaces=- pipeline=- completion=-
QA: - | (none) | proc:  | exp: 
ROUTES: GET /api/signals/envelope/:symbol  ;;  GET /api/signals/best
SCHEMA: NONE
SHAPE: YES?
DIAGRAM: PRESENT
DEFERRED: **A wider agreement sample** — the live cross-check ran with **1** envelope because the market was ~ **`signal-card-view.js` cannot be unit-tested** — it imports `./notices/registry` **extensionless**,
UNCHANGED: **`scoreId` and dismissals are NOT part of the frontend verdict.** Both are routing concerns this page ~ **The ladder's fail-closed `UNKNOWN_SIGNAL_CLASS` branch is kept verbatim.** An underivable side ~ **`HOLD` is not treated as "ready".** `signalToSide('HOLD') → null`, so a HOLD envelope is `blocked`;

============================================================================
FILE: 2026-09-27-972-992-trade-allowed-and-watchdog.md
date=2026-09-27 area=trading type=bugfix
MISSING: NONE
WHAT: The app read `health?.autoTrading` — a field the bridge `/health` endpoint has **never sent** — so `tradeAllowed` was `null` forever and **no surface could report that AutoTrading was switched off in the MT5 terminals.** Separately, the #992 watchdog refused to attempt recovery while in `STATE_TERM…
SLICE: (none)
CAPABILITY: (none) | persistence=- uiSurfaces=- pipeline=- completion=-
QA: - | (none) | proc:  | exp: 
ROUTES: GET /api
SCHEMA: NONE
SHAPE: YES?
DIAGRAM: PRESENT
DEFERRED: **Populating `brokerSymbol` on the 6 NULL broker-3 routes** — not done here because it is a **seed** change (`symbol_route`'s only writer is `nest/prisma/seed-symbol-onb… ~ **Any `brokerSymbol` guard** — must refuse an `enabled` mt5 route whose bare ticker is not confirmed present in that broker's `/symbols`. Owner: **#1009**. ~ **`/reconnect` reaching a NAMED broker** — `mt5.controller.ts` still fetches a single `BRIDGE_URL`. Owner: **#972**. ~ ⚠️ **#992 STAYS OPEN.** Two acceptance boxes remain honest `[ ]`: the named-broker reconnect (#972 owns it) and a **live session-drop canary**. 3 of 5 are ticked and ver…
UNCHANGED: **The `retcode 10027 AutoTrading disabled` refusals themselves** — considered and declined. AutoTrading is a **per-terminal UI switch**; no API call can flip it. Making …

============================================================================
FILE: 2026-09-28-1013-bar-window-maximum.md
date=2026-09-28 area=scoring type=bugfix
MISSING: NONE
WHAT: The base (live) cadence bar window is now a **maximum** of the protocol's declared requirements rather than a fall-through, and it is computed in **one** place — `ProtocolDbService.getBaseBarCount()`. Two hardcoded literals in the speed scan were removed. Result: `btc-speed-v1` went from 4 directiv…
SLICE: (none)
CAPABILITY: (none) | persistence=- uiSurfaces=- pipeline=- completion=-
QA: - | (none) | proc:  | exp: 
ROUTES: NONE
SCHEMA: NONE
SHAPE: YES?
DIAGRAM: PRESENT
DEFERRED: NONE
UNCHANGED: NONE

============================================================================
FILE: 2026-09-28-1018-per-bot-magic.md
date=2026-09-28 area=trading type=feature
MISSING: NONE
WHAT: Every bot now owns an immutable MT5 magic number (234100–234134) that is stamped on the order and carried by the position for life, so the stop guardian can attribute a position to its owner without a symbol match or a truncated comment — and can now *show* which path it used.
SLICE: (none)
CAPABILITY: (none) | persistence=- uiSurfaces=- pipeline=- completion=-
QA: - | (none) | proc:  | exp: 
ROUTES: GET /api/automation/stop-guardian/status
SCHEMA: NONE
SHAPE: YES?
DIAGRAM: PRESENT
DEFERRED: **Magic attribution is not yet observable on a LIVE position** — the 12 open positions all carry ~ **No UI surface for the resolution path** — `ownerVia` / `ownerAttribution` are API-only. ~ **5 of 40 bots have no magic** — they are API-created copies absent from `strategy-seed-data.ts`,
UNCHANGED: **The comment resolver stays.** It is not dead code: magic is immutable, so every position opened ~ **`DEFAULT_MAGIC` stays a duplicated literal** (Python bridge + TypeScript). There is no shared ~ **`makeGuarded`'s `positions.find(...)` match is unchanged** — two positions owned by the same bot

============================================================================
FILE: 2026-09-28-990-exit-mechanism-declaration.md
date=2026-09-28 area=trading type=feature
MISSING: NONE
WHAT: `GuardianRule` gained `fields` — the `trading_strategy` column(s) a mechanism reads — so the two registries that describe exit behaviour (bot-rules.ts, GUARDIAN_RULES) can be cross-checked, and the bot page can render each exit column with the mechanism that owns it.
SLICE: (none)
CAPABILITY: (none) | persistence=- uiSurfaces=- pipeline=- completion=-
QA: - | (none) | proc:  | exp: 
ROUTES: NONE
SCHEMA: trading_strategy` column
SHAPE: YES?
DIAGRAM: PRESENT
DEFERRED: **The per-bot-vs-global split for exit behaviour** — not decided here because it changes what the ~ **An edit surface for a bot's behavioural fields** — `@Patch(':id')` exists on the API and no page
UNCHANGED: **No editor was built.** `ViewStrategyPage.jsx` is read-only by design today, and 17 of 35 rules ~ **No tier/escalation ordering was invented.** The observed/decide/resolve bundle is a proposal, not

============================================================================
FILE: 2026-09-28-protocol-comparison.md
date=2026-09-28 area=ui type=feature
MISSING: NONE
WHAT: `/research/symbol/:ticker` now shows a **Protocol Comparison** — every protocol that scores the symbol, side by side, with average / best / worst score, sample count, active bots, and realised trades + P&L — sorted strongest-first so the two ends are adjacent.
SLICE: (none)
CAPABILITY: (none) | persistence=- uiSurfaces=- pipeline=- completion=-
QA: - | (none) | proc:  | exp: 
ROUTES: GET /api/symbols/:ticker/protocols  ;;  GET /api/symbols/XAUUSD/protocols
SCHEMA: NONE
SHAPE: YES?
DIAGRAM: PRESENT
DEFERRED: **`getFocus()`'s `scoring_strategies` still reads watchlist JSON from disk** (yielded 0 for XAUUSD). Owner: **#926**. ~ **The orphaned-history state is not surfaced in this UI.** Owner: **#1012**. ~ **No decision taken on whether to stop scoring symbols no bot subscribes to.** That is a maths change (it alters what a tradeable symbol is scored on) and needs a copied…
UNCHANGED: **`0 bots` is FLAGGED, not judged.** `gold-macro-v1` has 0 active bots **and +30.48 realised P&L** on XAUUSD. A rule that skipped scoring on "no bot" would have deleted … ~ **Trades/P&L are labelled ATTRIBUTED.** `scoringStrategyId` holds a protocol slug in some rows and a bot id in others, so the figure is attributed, not certain. Some rea… ~ **No scoring behaviour changed.** Nothing was made to score less. This is observability only.

============================================================================
FILE: 2026-09-29-1022-barcount-from-table-not-import.md
date=2026-09-29 area=data type=bugfix
MISSING: Capability Map Entry + Architecture Framework Entry
WHAT: `BacktestPeriodService.importBars` wrote `barCount: 0` in the branch where no provider supplied bars, **without reading `MarketBar`**. The column's documented meaning is *"bars present in `marketbar` for this window"*, so it recorded the outcome of a network call instead of the state of the table. …
SLICE: (none)
CAPABILITY: (none) | persistence=- uiSurfaces=- pipeline=- completion=-
QA: - | (none) | proc:  | exp: 
ROUTES: GET /api/backtest/periods  ;;  POST /api/backtest/periods/{id}/import
SCHEMA: NONE
SHAPE: no
DIAGRAM: ABSENT
DEFERRED: NONE
UNCHANGED: NONE

============================================================================
FILE: 2026-09-29-1023-log-retention-and-volume.md
date=2026-09-29 area=infra type=feature
MISSING: NONE
WHAT: Log volume and retention are now **declared settings the app enforces**, not constants: the writer collapses repeated identical lines to one per window plus a suppressed count, and prunes its own dated log files on a daily schedule — **moving them to an archive one cycle before removal**, so the de…
SLICE: (none)
CAPABILITY: (none) | persistence=- uiSurfaces=- pipeline=- completion=-
QA: - | (none) | proc:  | exp: 
ROUTES: GET /api/system/logs/retention  ;;  POST /api/system/logs/prune  ;;  GET /api/system/logs/collapse-stats
SCHEMA: NONE
SHAPE: YES?
DIAGRAM: PRESENT
DEFERRED: **Compress rather than hold.** The archive is bounded by the same window, so nothing accumulates — but old ~ **A stated ceiling for the worst day.** The acceptance criterion asks that a `tcs-<date>.log` for a ~ **The launcher's success message is still a port check.** The `-State Listen` bug that let the OLD API ~ **Ad-hoc captures in `logs/` are untouched.** Item 2's option (c) — a gitignored `logs/scratch/` — was not
UNCHANGED: **The in-memory ring buffer is NOT collapsed.** It is bounded at 500 entries, so a storm cannot grow it, ~ **`logs/` (repo root) is still not gitignored.** It holds live `logs/scoring/*.jsonl`. Console capture was ~ **Item 3's option (c) — downgrade bridge-unreachable from WARN to DEBUG — is declined.** The issue already

============================================================================
FILE: 2026-09-29-1027-exit-verdict-replay.md
date=2026-09-29 area=trading type=feature
MISSING: NONE
WHAT: Added `scripts/replay-exit-verdict.cjs` (step 3d) — it replays the REAL 5-directive `ExitConsensus` verdict over every closed valid trade — and its answer refutes the exit premise **three ways**, so `#1019`'s acting exit is **NOT built** and the sprint is redirected to the loss magnitude. Settled a…
SLICE: (none)
CAPABILITY: (none) | persistence=- uiSurfaces=- pipeline=- completion=-
QA: - | (none) | proc:  | exp: 
ROUTES: NONE
SCHEMA: NONE
SHAPE: YES?
DIAGRAM: PRESENT
DEFERRED: **The `time-stop` cannot-ever-argue defect** — not fixed here because it is an exit-contract change, not a replay change. Measured: `neutral` in **4206 of 4206** evaluat…
UNCHANGED: **No acting exit was built.** Considered and declined — that is the question steps 3c/3d existed to answer, and the answer is no. Nothing is outstanding. ~ **The API was not rebuilt.** The only backend edit is a comment, so `dist/` differs by a comment; the served version is **UNVERIFIED** and needs a restart. Not manufactu… ~ **Intrabar fills not modelled.** Considered and declined — would need tick data the store does not hold for these windows. Stated as a limitation in `#1027` instead of i…

============================================================================
FILE: 2026-09-29-986-backtest-periods.md
date=2026-09-29 area=data type=feature
MISSING: NONE
WHAT: A backtest could only ever measure **the most recent N bars**. `run()` loaded bars with `take: days + 120` — a ROW LIMIT walking backwards from the newest bar — so a window that ended months ago was **not expressible**. That is why sprint #965 could not produce a verdict on today's data: the instru…
SLICE: (none)
CAPABILITY: (none) | persistence=- uiSurfaces=- pipeline=- completion=-
QA: - | (none) | proc:  | exp: 
ROUTES: POST /api/backtest/run  ;;  POST /api/replay/run  ;;  POST /api/backtest/periods/import  ;;  POST /api/backtest/periods/{id}/import  ;;  POST /api/backtest/periods  ;;  POST /api/backtest/periods/:id/import  ;;  GET /api/backtest/periods/:id  ;;  DELETE /api/backtest/periods/:id  ;;  GET /api/backtest/periods
SCHEMA: NONE
SHAPE: YES?
DIAGRAM: PRESENT
DEFERRED: NONE
UNCHANGED: **An existing bar is NOT overwritten by an import.** The unique key is ~ **The bars are NOT deleted when a period is deleted.** They belong to the symbol and are shared by ~ **`getCandles()` was not changed to accept a range.** It has other callers whose behaviour depends ~ **`totalDays` keeps its old meaning on a day-range run.** It stores the REQUEST's `days` — a row

============================================================================
FILE: 2026-09-30-1028-1029-signal-class-integrity.md
date=2026-09-30 area=data type=bugfix
MISSING: Architecture Framework Entry
WHAT: A signal class is a **VALUE**, not a string to be prefix-matched or truncated. Two halves of that one class were live: `#1029` classified signals by prefix (so both STRONG classes read as `watch`), and `#1028` stored `STRONG_SELL` in a `VarChar(10)` column (so it was written as `STRONG_SEL`). Fixed…
SLICE: (none)
CAPABILITY: (none) | persistence=- uiSurfaces=- pipeline=- completion=-
QA: - | (none) | proc:  | exp: 
ROUTES: GET /api/scoring/recently-analysed
SCHEMA: NONE
SHAPE: YES?
DIAGRAM: PRESENT
DEFERRED: **`DirectiveOutcome.signalClass` stays `VarChar(10)`** — no, this is NOT deferred: it is a **declared exception** in the guard, because it holds `bearish | bullish | neu… ~ **`strategy_signal_queue.signal` is not covered by the width gate** — it is an **unmodelled** table (raw-managed, as `schema.prisma`'s header documents), so there is no …
UNCHANGED: **`strategy_signal_queue.signal` and `strategy_evaluation.signal` hold the SIDE (`BUY`/`SELL`), not a class** — measured, max length 4. Widened anyway (free, and removes… ~ **No recovery of the 83,000 NULL `decision_log.signal` rows.** Considered and declined — the value was never written, so there is nothing to restore. ~ **The classification fix is presentation-only.** Blast radius traced before changing: the value reaches `GET /api/scoring/recently-analysed` and ONE consumer, the badge …

============================================================================
FILE: 2026-09-30-1030-broker-addressed-position-io.md
date=2026-09-30 area=trading type=bugfix
MISSING: NONE
WHAT: Post-entry exit management (stop guardian + position time-stop) now reads and writes **every active MT5 bridge**, addressing each position by the account that HOLDS it, instead of using one URL captured at start-up. Two of nine live positions had never been trailed or time-stopped.
SLICE: (none)
CAPABILITY: (none) | persistence=- uiSurfaces=- pipeline=- completion=-
QA: - | (none) | proc:  | exp: 
ROUTES: GET /api/automation/stop-guardian  ;;  GET /api/mt5/positions
SCHEMA: NONE
SHAPE: YES?
DIAGRAM: PRESENT
DEFERRED: **The read path** — `GET /api/mt5/positions`, its close-all loop, and
UNCHANGED: **`Mt5TradingService`'s `bridgeUrl` getter** — `getAccount()` is genuinely a primary-account read, ~ **The UI** — `brokerId` is additive and rendered nowhere; adding it is a UI change for the owner

============================================================================
FILE: 2026-09-30-1031-bot-magic-attribution.md
date=2026-09-30 area=trading type=bugfix
MISSING: NONE
WHAT: `#1018`'s per-bot MT5 magic never reached a single order, because `findAll()` returns an **explicit field list** and `magic` was not in it — so every position carried `234000` ("no bot attributed") and `trade.magic` was NULL on every open row. Fixed at every link, plus the three further gaps it exp…
SLICE: (none)
CAPABILITY: (none) | persistence=- uiSurfaces=- pipeline=- completion=-
QA: - | (none) | proc:  | exp: 
ROUTES: GET /api/trading/strategies
SCHEMA: NONE
SHAPE: YES?
DIAGRAM: PRESENT
DEFERRED: **~9 files still hand-roll the self-test loop** (`replay-exit-counterfactual.cjs`, `replay-exit-verdict.cjs`, `validate-theories.cjs`, `validate-notices.cjs`, `audit-sym…
UNCHANGED: **The 6 surviving positions keep `234000`.** Considered and declined — immutable in MT5, and closing/reopening a demo position to tick a box is not warranted. ~ **No backfill of `trade.magic` on historical rows.** Considered and declined — `scoringStrategyId` attributes 182 of 410 trades, and inventing the rest trades a known ga…

============================================================================
FILE: 2026-09-30-1032-shared-selftest-harness.md
date=2026-09-30 area=infra type=refactor
MISSING: NONE
WHAT: One shared self-test harness, plus a guard so a new file cannot hand-roll it — and the guard caught two copies written the same day, including by the agent closing the issue.
SLICE: (none)
CAPABILITY: (none) | persistence=- uiSurfaces=- pipeline=- completion=-
QA: - | (none) | proc:  | exp: 
ROUTES: NONE
SCHEMA: NONE
SHAPE: YES?
DIAGRAM: PRESENT
DEFERRED: **A shared API for table-driven cases** — the 4 files that iterate a `cases` array with per-case arguments share a genuine second shape. Two options were considered and … ~ **Wiring the guard into `prebuild`** — deliberate hold. A gate that has run once is not yet a gate; wire it once a divergence is caught in the wild.
UNCHANGED: **The 4 table-driven files** — considered and declined. Converting them trades a duplication defect for a readability defect, and the guard's whole credibility rests on … ~ **`scripts/validate-decisions.cjs`, `scripts/verify-view-meta-routes.cjs`, `nest/scripts/audit-strategy-realism.cjs`, `nest/scripts/validate-rule-enforcement.cjs`** — al…

============================================================================
FILE: 2026-09-30-1035-wrong-account-order-refusal.md
date=2026-09-30 area=trading type=feature
MISSING: NONE
WHAT: A bridge attached to an account it was **not** configured for now **refuses every order-placing call** with notice `TCS-TRADE-021`, instead of only logging the mismatch. Reads (`/health`, `/positions`, `/account`, quotes) stay open so the app can still see what the attached account holds.
SLICE: (none)
CAPABILITY: (none) | persistence=- uiSurfaces=- pipeline=- completion=-
QA: - | (none) | proc:  | exp: 
ROUTES: POST /order  ;;  GET /health  ;;  GET /positions
SCHEMA: NONE
SHAPE: YES?
DIAGRAM: PRESENT
DEFERRED: **Live verification of the refusal on a real bridge** — not done here because loading the change
UNCHANGED: **`reachable` on `Mt5BrokerInfo`** — considered and declined. Row 48 records that three services ~ **`/reconnect` and the account-switch route** — considered and deliberately NOT gated. They do not

============================================================================
FILE: 2026-09-30-1037-contested-position-claimants.md
date=2026-09-30 area=trading type=feature
MISSING: NONE
WHAT: A position built from **several bots' orders** is now detected and **named** rather than silently unowned, and the detection is a pure, tested module so the guardian can share it (#1041).
SLICE: (none)
CAPABILITY: (none) | persistence=- uiSurfaces=- pipeline=- completion=-
QA: - | (none) | proc:  | exp: 
ROUTES: GET /api/trading/mt5/positions/managed
SCHEMA: NONE
SHAPE: YES?
DIAGRAM: PRESENT
DEFERRED: **The guardian half** — manage a contested position by its strictest claimant. Owner: **#1041**.
UNCHANGED: **`getPositions()` (single-bridge).** Still used by `closeAll`/`closePosition`/`modifyPosition`,

============================================================================
FILE: 2026-09-30-1037-position-lifecycle-change-guide.md
date=2026-09-30 area=docs type=docs
MISSING: Capability Map Entry + Architecture Framework Entry
WHAT: Ticket `152703882760` (−322.67, the worst trade on record) is written up as a **guide for changes**: seven measured failures turned into rules any change to a bot or algorithm must satisfy, plus the specification for the position-management interface the owner needs to stop watching MetaTrader + Pe…
SLICE: (none)
CAPABILITY: (none) | persistence=- uiSurfaces=- pipeline=- completion=-
QA: - | (none) | proc:  | exp: 
ROUTES: GET /api/mt5/history/deals
SCHEMA: NONE
SHAPE: YES?
DIAGRAM: ABSENT
DEFERRED: NONE
UNCHANGED: **`#1014`, `#807`, `#929`, `#801`, `#721`, `#1030`, `#1033`, `#978`, `#979`** — the guide points at ~ **No version bump** — documentation only.

============================================================================
FILE: 2026-09-30-929-ab-cancel-and-brake-layer.md
date=2026-09-30 area=automation type=feature
MISSING: NONE
WHAT: A running A/B test can now be **halted without inventing a verdict** — a choice that did not exist in the API — and the bot's own picture now shows **what stops a trade, and whether that needs the app to be running**. The run that caused the worst trade on record (`b50727ee`) is cancelled.
SLICE: (none)
CAPABILITY: (none) | persistence=- uiSurfaces=- pipeline=- completion=-
QA: - | (none) | proc:  | exp: 
ROUTES: POST /:id/cancel  ;;  POST /api/automation/ab-tests/:id/cancel  ;;  POST /api/automation/ab-tests/{id}/cancel
SCHEMA: NONE
SHAPE: YES?
DIAGRAM: PRESENT
DEFERRED: **A UI control for cancel.** The route exists; nothing in the frontend calls it. Owner:
UNCHANGED: **`stop()` still computes a verdict** — it is the correct action for a test that genuinely ran, so ~ **The brake-layer claims.** They assert nothing (`ok: null`), because neither the bridge caps nor ~ **No version-bump rebuild.** Repo and nest are 0.104.0; the API was not restarted for it. The next

============================================================================
FILE: 2026-09-30-992-option-b-session-recovery.md
date=2026-09-30 area=infra type=feature
MISSING: NONE
WHAT: ⚠️ **Most of #992 was already built** (option A, the bridge's own watchdog, landed 2026-09-25 in `0db44af`) and the issue was never closed, so it read as open work. This lands **option B**: an API-side observer that recovers a bridge whose MT5 session died — the case A deliberately gives up on.
SLICE: (none)
CAPABILITY: (none) | persistence=- uiSurfaces=- pipeline=- completion=-
QA: - | (none) | proc:  | exp: 
ROUTES: POST /api/providers/mt5/session-recovery  ;;  GET /api/providers/mt5/session-recovery
SCHEMA: NONE
SHAPE: YES?
DIAGRAM: PRESENT
DEFERRED: **#1000** — the bridge's blocking-native-call failure mode. B cannot cover it: the bridge answers
UNCHANGED: **`reachable`** — three services read it. Re-defining a field others use is how a fix becomes an ~ **The bridge's 5-attempt cap** — raising it would make A the unbounded loop it refuses to be.

============================================================================
FILE: 2026-09-30-994-927-floor-remeasured.md
date=2026-09-30 area=risk type=docs
MISSING: Capability Map Entry + Architecture Framework Entry
WHAT: No code changed. **#994 was re-measured and closed with a verdict**: the #927 declared-distance floor **is** holding, and the panel that reported "18 breaches" has two independent defects of its own.
SLICE: (none)
CAPABILITY: (none) | persistence=- uiSurfaces=- pipeline=- completion=-
QA: - | (none) | proc:  | exp: 
ROUTES: NONE
SCHEMA: NONE
SHAPE: no
DIAGRAM: ABSENT
DEFERRED: NONE
UNCHANGED: **L1209's recorded basis** — the writer is correct for what it says; the *detector* misreads it. ~ **The 7 rows** — left exactly as recorded. They are accurate history, and rewriting them would

============================================================================
FILE: 2026-09-30-add-symbol-notice-null-crash.md
date=2026-09-30 area=ui type=bugfix
MISSING: Capability Map Entry + Architecture Framework Entry
WHAT: The free-edition **Add Symbol** page (`/watchlists/add-symbol`) threw `TypeError: Cannot read properties of null (reading 'notice')` on its **first render** and took the entire page down. `ManualAddForm` dereferenced `msg.notice` **outside** the `msg` null guard.
SLICE: (none)
CAPABILITY: (none) | persistence=- uiSurfaces=- pipeline=- completion=-
QA: - | (none) | proc:  | exp: 
ROUTES: NONE
SCHEMA: NONE
SHAPE: no
DIAGRAM: ABSENT
DEFERRED: NONE
UNCHANGED: **No automated guard added for this class.** A heuristic for "property read outside its null guard"

============================================================================
FILE: 2026-09-30-meta-stack-review-and-guards.md
date=2026-09-30 area=infra type=refactor
MISSING: NONE
WHAT: An engineering review of META.Stack from start to finish, then the fixes it identified — plus two guards that close whole classes of defect rather than single instances. The review itself is `docs/meta-stack-structure-review.md`; this handoff covers the landings.
SLICE: (none)
CAPABILITY: (none) | persistence=- uiSurfaces=- pipeline=- completion=-
QA: - | (none) | proc:  | exp: 
ROUTES: NONE
SCHEMA: NONE
SHAPE: YES?
DIAGRAM: PRESENT
DEFERRED: **The remaining naming collisions** — 21 of 25 remain (`Recommendation`, `TradeRecord`, `SessionInfo`, `MarketStatus`, `MarketSession`, `MarketBar`, `SwingPoint`, `Fresh… ~ **3 oversized controllers** — `trading/trade-history.controller.ts` (1,244 lines), `scoring/protocol-gating.controller.ts` (942), `automation/automation.controller.ts` (… ~ **138 N+1 sites across 41 files** — hot paths first: `trading-strategy.service.ts` (12), `backtest.service.ts` (10), `research-import.service.ts` (12). Owner: **the revi… ~ **`scenario.service.ts` is still in-memory** — a `Map`, so scenarios are lost on restart. Needs a table; 13 tables already live outside Prisma, so this is schema work, n…
UNCHANGED: **`trading-strategy.service.ts:1707` and `:1776` still say `StopGuardianService`** — considered and left, because they are CORRECT. Proven, not assumed: `automation/stop… ~ **`validate-architecture-docs.cjs` is NOT in `prebuild`** — `prebuild` is shared by every agent, and a gate that has run once is not yet a gate. Same reasoning as `valid… ~ **`scripts/analyse-query-patterns.cjs` is not a build gate** — its N+1 rule has a high false-positive rate by construction (it matches adjacency, not data flow). Every h…

============================================================================
FILE: 2026-09-30-page-walkthrough-ui-review.md
date=2026-09-30 area=ui type=feature
MISSING: NONE
WHAT: Added **Page Walkthrough** at `/development/ui-review` — one row per view in the app (141 rows), where the owner records **importance** (H/M/L), **hide now** (Y/N), **keenness** (1–3) and a free-text **note**, saving on every interaction. It exists so the free edition can be curated from a single p…
SLICE: (none)
CAPABILITY: (none) | persistence=- uiSurfaces=- pipeline=- completion=-
QA: - | (none) | proc:  | exp: 
ROUTES: PUT /api/system/settings/ui-review  ;;  GET /api/system/settings/ui-review
SCHEMA: NONE
SHAPE: YES?
DIAGRAM: PRESENT
DEFERRED: **No DELETE endpoint, and a stray `__selftest__` key** left in the store by the round-trip
UNCHANGED: NONE

============================================================================
TABLE A - files missing a required section:
  2026-09-27-1012-orphaned-history.md
  2026-09-29-1022-barcount-from-table-not-import.md
  2026-09-30-1028-1029-signal-class-integrity.md
  2026-09-30-1037-position-lifecycle-change-guide.md
  2026-09-30-994-927-floor-remeasured.md
  2026-09-30-add-symbol-notice-null-crash.md

TABLE B - SHAPE signals (keyword-detected, must be confirmed by reading):
  2026-09-27-926-protocol-authority.md
  2026-09-27-935-readiness-verdict.md
  2026-09-27-972-992-trade-allowed-and-watchdog.md
  2026-09-28-1013-bar-window-maximum.md
  2026-09-28-1018-per-bot-magic.md
  2026-09-28-990-exit-mechanism-declaration.md
  2026-09-28-protocol-comparison.md
  2026-09-29-1023-log-retention-and-volume.md
  2026-09-29-1027-exit-verdict-replay.md
  2026-09-29-986-backtest-periods.md
  2026-09-30-1028-1029-signal-class-integrity.md
  2026-09-30-1030-broker-addressed-position-io.md
  2026-09-30-1031-bot-magic-attribution.md
  2026-09-30-1032-shared-selftest-harness.md
  2026-09-30-1035-wrong-account-order-refusal.md
  2026-09-30-1037-contested-position-claimants.md
  2026-09-30-1037-position-lifecycle-change-guide.md
  2026-09-30-929-ab-cancel-and-brake-layer.md
  2026-09-30-992-option-b-session-recovery.md
  2026-09-30-meta-stack-review-and-guards.md
  2026-09-30-page-walkthrough-ui-review.md

FILES READ: 25