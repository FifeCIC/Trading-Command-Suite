==========================================================================
FILE 2026-09-27-1012-orphaned-history.md   [2026-09-27 data/bugfix]
MISSING: CapabilityMap + ArchFramework
WHAT: `deleteCopyProtocol()` now counts and reports the `score_snapshot` rows it orphans, instead of leaving them silently behind. The orphaned history is **kept** — a retention decision, recorded.
AF.section=- | AF.summary: 
CAP:  | persist=- ui=- pipe=- done=-
QA: [Data / Scoring] a protocol deletion reports the score history it orphans
QA.proc: call `deleteCopyProtocol('<a-copy-slug>')` and read the response/log; then `SELECT COUNT(*) FROM score_snapshot WHERE protocolId='<slug>'` before and after.
QA.exp: the call returns `scoreSnapshots: N` and logs `⚠️ ORPHANED N score_snapshot row(s)`, and the `score_snapshot` count is **unchanged** — the rows are kept, not deleted. `node nest/scripts/aud…
ROUTES: NONE
DIAGRAM: ABSENT
DEFERRED: Nothing surfaces the orphan state in the UI — visible to an agent running the audit, not to a reader of a page. Owner: #1012; natural home is the symbol protocol-co… ~ Nothing can detect or prevent a by-hand `DELETE` of a `protocol` row — the route that produced the two largest orphans.
UNCHANGED: The orphan rows are not deleted. `DELETE`/`TRUNCATE` would turn the audit green and destroy the only record of what those protocols scored. ~ No protocol rows were re-created to satisfy a join — that would re-attach old history to new meaning. ~ `deleteCopyProtocol()` still does not refuse when rows exist. Copies are created and removed routinely for A/B; a hard block would break that for a 1-row cost, and …

==========================================================================
FILE 2026-09-27-926-protocol-authority.md   [2026-09-27 data/feature]
MISSING: none
WHAT: `"Which protocols apply to this symbol?"` now has **one authority** — `SymbolProtocolAuthorityService`, a **ranked union** of six sources with per-entry provenance — and `GET /api/symbols/:ticker/protocols` **and** `getFocus()` both read it. Previously six me…
AF.section=data | AF.summary: The question *"which protocols apply to this symbol"* had **six** live mechanisms and no authority. Measured for XAUUSD they answered 2 / 8 / 3 / **0** / 0 / `gold-macro-v1`, so a symbol could be *assigned but not traded*, *traded but not assigned*, or *scored by neither*. `SymbolProtocolAuthorityService` resolves it as a **ran…
CAP: Symbol ↔ protocol authority (which protocols apply to a symbol) | persist=stored (derived at read time from four DB sources) ui=2 — `SymbolDetailPage` Protocol Scores, `SymbolFocusPage` (`/research/symbol/:ticker`) pipe=both done=partial — `/focus`'s `scoring_strategies` still reads watchlist JSON from disk
QA: [Data / Symbols] symbol ↔ protocol authority agrees with the pages that consume it
QA.proc: `node nest/scripts/audit-symbol-protocol-authority.cjs --days 7`; then compare `GET /api/symbols/XAUUSD/protocols` with `GET /api/symbols/XAUUSD/focus` → `protocols`.
QA.exp: Guard exits **0** with **0 fatal orphans** (70 scored pairs / 45 symbols / 21 ticking protocols). The two endpoints **agree**: XAUUSD **20 = 20** (they were **8 vs 20**), USDCAD **3**, with…
ROUTES: GET /api/symbols/:ticker/protocols ;; GET /:ticker/protocols ;; GET /api/symbols/:ticker/focus ;; GET /api/symbols/XAUUSD/protocols ;; GET /api/symbols/XAUUSD/focus
DIAGRAM: present
DEFERRED: `getFocus()` `scoring_strategies` from disk — owner #926. ~ Orphaned `score_snapshot` history (a retention decision) — owner #1012.
UNCHANGED: The weaker sources are not filtered out. They *add* protocols; `rank` records the strongest evidence. A first-hit chain would change its answer when an unrelated ta… ~ `/focus`'s `scoring_strategies` still reads disk JSON. Left as the staged second half; it is no longer used to decide which protocols exist. ~ The guard is on demand, not `prebuild`. It needs the API running, and every `prebuild` validator in this repo is static and reads no database.

==========================================================================
FILE 2026-09-27-935-readiness-verdict.md   [2026-09-27 scoring/bugfix]
MISSING: none
WHAT: The SymbolPage "✓ Trade Ready" badge now reads the **same verdict the order path enforces** instead of `preTradeReady` alone — which required first annotating the drilldown endpoint with `executionBlockers`, because that endpoint carried **none at all**.
AF.section=data | AF.summary: A readiness claim is a claim about a **predicate**, and a surface that asserts it must read the whole predicate. `GET /api/signals/envelope/:symbol` now carries `executionBlockers`, assessed by the same `ExecutionFeasibilityService.assess()` the ladder (#723) and the order path use — via one shared `annotateFeasibility()` in `s…
CAP: Symbol readiness verdict (badge agrees with the order path) | persist=ephemeral ui=1 — the SymbolPage score card badge pipe=both done=complete
QA: [Scoring / Signals] SymbolPage readiness agrees with the order path
QA.proc: Open `/symbol/ETH`; compare the badge against `GET /api/signals/best` → the same symbol/protocol card's blockers.
QA.exp: Both report the **same** blockers. Live 2026-09-27: the drilldown now returns `executionBlockers: [{ key: 'route-unverified', message: 'ETH cannot be ordered on MT5: the route targets broke…
ROUTES: GET /api/signals/envelope/:symbol ;; GET /api/signals/best
DIAGRAM: present
DEFERRED: A wider agreement sample — the live cross-check ran with 1 envelope because the market was ~ `signal-card-view.js` cannot be unit-tested — it imports `./notices/registry` extensionless,
UNCHANGED: `scoreId` and dismissals are NOT part of the frontend verdict. Both are routing concerns this page ~ The ladder's fail-closed `UNKNOWN_SIGNAL_CLASS` branch is kept verbatim. An underivable side ~ `HOLD` is not treated as "ready". `signalToSide('HOLD') → null`, so a HOLD envelope is `blocked`;

==========================================================================
FILE 2026-09-27-972-992-trade-allowed-and-watchdog.md   [2026-09-27 trading/bugfix]
MISSING: none
WHAT: The app read `health?.autoTrading` — a field the bridge `/health` endpoint has **never sent** — so `tradeAllowed` was `null` forever and **no surface could report that AutoTrading was switched off in the MT5 terminals.** Separately, the #992 watchdog refused …
AF.section=data | AF.summary: Trade-permission visibility. The MT5 bridge `/health` reports `tradeAllowed` (from `mt5.terminal_info().trade_allowed`); NestJS `app.controller.ts` surfaces it as `mt5Bridge.tradeAllowed` plus `anyTradeAllowed` (true if ANY active broker can trade) on `GET /api`. Replaces a read of `autoTrading`, a field `/health` never sent, w…
CAP: Broker Trade-Permission Visibility (AutoTrading state) | persist=ephemeral (read live from the bridge per request; not stored) ui=1 (`/api` serves `mt5Bridge.tradeAllowed` / `anyTradeAllowed`; the health dashboard reads `best`) pipe=trading done=complete
QA: [Trading] App reports broker AutoTrading state truthfully
QA.proc: `curl http://localhost:3201/api` and read `mt5Bridge.tradeAllowed` / `anyTradeAllowed`; compare against `curl http://localhost:5000/health` and `:5001/health`. Enable AutoTrading in one MT5 terminal and re-read.
QA.exp: `tradeAllowed` is a **boolean**, never `null`, and agrees with the bridge `/health` on every broker. With AutoTrading off everywhere: `tradeAllowed=false` and `anyTradeAllowed=false`. Enabl…
ROUTES: GET /api
DIAGRAM: present
DEFERRED: Populating `brokerSymbol` on the 6 NULL broker-3 routes — not done here because it is a seed change (`symbol_route`'s only writer is `nest/prisma/seed-symbol-onboar… ~ Any `brokerSymbol` guard — must refuse an `enabled` mt5 route whose bare ticker is not confirmed present in that broker's `/symbols`. Owner: #1009. ~ `/reconnect` reaching a NAMED broker — `mt5.controller.ts` still fetches a single `BRIDGE_URL`. Owner: #972.
UNCHANGED: The `retcode 10027 AutoTrading disabled` refusals themselves — considered and declined. AutoTrading is a per-terminal UI switch; no API call can flip it. Making the…

==========================================================================
FILE 2026-09-28-1013-bar-window-maximum.md   [2026-09-28 scoring/bugfix]
MISSING: none
WHAT: The base (live) cadence bar window is now a **maximum** of the protocol's declared requirements rather than a fall-through, and it is computed in **one** place — `ProtocolDbService.getBaseBarCount()`. Two hardcoded literals in the speed scan were removed. Res…
AF.section=data | AF.summary: Base bar window sizing — `ProtocolDbService.getBaseBarCount()` is the ONE rule; four former open-coded fall-throughs delegate to it. A directive cannot know the runtime cadence, so it declares its requirement under the generic `'1d'` key (74 of 108 do); the window must therefore satisfy the **maximum**, not the base-cadence key…
CAP: Protocol-derived base bar window (one sizing rule) | persist=config ui=0 pipe=both done=complete
QA: [Scoring Pipeline] A protocol's base bar window is the MAXIMUM of its declared requirements
QA.proc: `node nest/scripts/directive-guard.cjs --db` and read the MODE 8 block. Then `node logs/probe-bar-window.cjs` — it lists every protocol whose window the rule changes. To re-prove the guard can fail: `pwsh -File logs/canary-mode8.ps1`.
QA.exp: MODE 8 prints `NEWEST tick … — 0/<n> directive(s) starved.` **This is the reading to trust** — the tick is current, so it answers "is it fixed now?". ⚠️ The `N chronic` figure is a **24h ba…
ROUTES: NONE
DIAGRAM: present
DEFERRED: none
UNCHANGED: none

==========================================================================
FILE 2026-09-28-1018-per-bot-magic.md   [2026-09-28 trading/feature]
MISSING: none
WHAT: Every bot now owns an immutable MT5 magic number (234100–234134) that is stamped on the order and carried by the position for life, so the stop guardian can attribute a position to its owner without a symbol match or a truncated comment — and can now *show* w…
AF.section=trading | AF.summary: Per-Bot MT5 Magic — `trading_strategy.magic Int? @unique`, seeded 234100–234134 for the 35 seeded bots (distinct, no gaps; 234000 is reserved as the bridge's "no bot attributed"). Stamped by `automation-loop.dispatchTrade` → `BrokerOrderRequest.magic` → MT5 adapter `/order` → bridge → the MT5 position, where it is immutable. `s…
CAP: Per-Bot MT5 Magic Attribution | persist=stored ui=0 — the resolution path is exposed on the API only; the bot page has a lifecycle diagram but does not render `ownerVia`/`ownerAttribution` pipe=trading done=complete
QA: [Trading] A position is attributed to its owning bot by magic, and an unmatched magic is repo…
QA.proc: GET `http://localhost:3201/api/automation/stop-guardian/status`. Read `ownerAttribution` and the `ownerVia` field on each entry of `guardedPositions`. Then place one order from a seeded bot (its `trading_strategy.magic` is ≥ 234100) and GET again.
QA.exp: The new position's `ownerVia` is `'magic'` and `ownerAttribution.viaMagic` ≥ 1. Positions opened before this change (magic 234000) still resolve with `ownerVia: 'comment:exact'` or `'commen…
ROUTES: GET /api/automation/stop-guardian/status
DIAGRAM: present
DEFERRED: Magic attribution is not yet observable on a LIVE position — the 12 open positions all carry ~ No UI surface for the resolution path — `ownerVia` / `ownerAttribution` are API-only. ~ 5 of 40 bots have no magic — they are API-created copies absent from `strategy-seed-data.ts`,
UNCHANGED: The comment resolver stays. It is not dead code: magic is immutable, so every position opened ~ `DEFAULT_MAGIC` stays a duplicated literal (Python bridge + TypeScript). There is no shared ~ `makeGuarded`'s `positions.find(...)` match is unchanged — two positions owned by the same bot

==========================================================================
FILE 2026-09-28-990-exit-mechanism-declaration.md   [2026-09-28 trading/feature]
MISSING: none
WHAT: `GuardianRule` gained `fields` — the `trading_strategy` column(s) a mechanism reads — so the two registries that describe exit behaviour (bot-rules.ts, GUARDIAN_RULES) can be cross-checked, and the bot page can render each exit column with the mechanism that …
AF.section=directives | AF.summary: Exit enforcement attribution. `GuardianRule.fields` links a guardian mechanism to the `trading_strategy` columns it reads; `bot-rules.ts` `enforcedBy` is the claim, `fields` is the declaration, and `validate-rule-enforcement.cjs` (prebuild) fails when they disagree — a column claiming the guardian that no mechanism declares, on…
CAP: Exit-mechanism attribution (a column states the mechanism that reads it) | persist=config ui=1 — `/trading/strategy/:id`, the Exit stage + "Exit management — global mechanisms" pipe=trading done=partial — the two registries now agree and the page states ownership; the editor does not exist (see Deferred)
QA: [Trading] Every column claiming the guardian is declared by exactly one mechanism
QA.proc: `node nest/scripts/validate-rule-enforcement.cjs` → expect exit 0 and "5 column(s) claim the guardian and every one is declared by exactly one mechanism". Then delete the `exhaustion-observer` entry from `GUARDIAN_RULES` and re-run → expect exit 1 n…
QA.exp: Green at rest; red with a named column when a mechanism is removed. Load `/trading/strategy/:id` and confirm the Exit stage shows 9 rows, exactly 5 of them carrying a "Read by the …" line, …
ROUTES: NONE
DIAGRAM: present
DEFERRED: The per-bot-vs-global split for exit behaviour — not decided here because it changes what the ~ An edit surface for a bot's behavioural fields — `@Patch(':id')` exists on the API and no page
UNCHANGED: No editor was built. `ViewStrategyPage.jsx` is read-only by design today, and 17 of 35 rules ~ No tier/escalation ordering was invented. The observed/decide/resolve bundle is a proposal, not

==========================================================================
FILE 2026-09-28-protocol-comparison.md   [2026-09-28 ui/feature]
MISSING: none
WHAT: `/research/symbol/:ticker` now shows a **Protocol Comparison** — every protocol that scores the symbol, side by side, with average / best / worst score, sample count, active bots, and realised trades + P&L — sorted strongest-first so the two ends are adjacent.
AF.section=data | AF.summary: Which protocols *score* a symbol is now separable from which protocols *earn their keep*. `/api/symbols/:ticker/protocols` carries per-protocol `stats` (avg/high/low/samples over a stated 30-day window), `bots` (active subscribers), and `realised` (trades/wins/pnl), so a reader can see that 6 of XAUUSD's 23 protocols account fo…
CAP: Protocol comparison per symbol (strongest / weakest investigation) | persist=ephemeral (computed per request) ui=1 — `SymbolFocusPage` (`/research/symbol/:ticker`) pipe=none — read-only observability done=complete
QA: [UI / Data] symbol protocol comparison shows real, attributed statistics
QA.proc: open `/research/symbol/XAUUSD`; alternatively `GET /api/symbols/XAUUSD/protocols` and read `stats`, `bots`, `realised`.
QA.exp: `statsError: null`, `statsWindowDays: 30`. Live 2026-09-28: `xau-speed-4h` avg **75.8** (strongest), `xau-speed-4h-copy` avg **34.6** (weakest), `xau-speed-1h` **1 trade, −65.25** — matchin…
ROUTES: GET /api/symbols/:ticker/protocols ;; GET /api/symbols/XAUUSD/protocols
DIAGRAM: present
DEFERRED: `getFocus()`'s `scoring_strategies` still reads watchlist JSON from disk (yielded 0 for XAUUSD). Owner: #926. ~ The orphaned-history state is not surfaced in this UI. Owner: #1012. ~ No decision taken on whether to stop scoring symbols no bot subscribes to. That is a maths change (it alters what a tradeable symbol is scored on) and needs a copie…
UNCHANGED: `0 bots` is FLAGGED, not judged. `gold-macro-v1` has 0 active bots and +30.48 realised P&L on XAUUSD. A rule that skipped scoring on "no bot" would have deleted a p… ~ Trades/P&L are labelled ATTRIBUTED. `scoringStrategyId` holds a protocol slug in some rows and a bot id in others, so the figure is attributed, not certain. Some re… ~ No scoring behaviour changed. Nothing was made to score less. This is observability only.

==========================================================================
FILE 2026-09-29-1022-barcount-from-table-not-import.md   [2026-09-29 data/bugfix]
MISSING: CapabilityMap + ArchFramework
WHAT: `BacktestPeriodService.importBars` wrote `barCount: 0` in the branch where no provider supplied bars, **without reading `MarketBar`**. The column's documented meaning is *"bars present in `marketbar` for this window"*, so it recorded the outcome of a network …
AF.section=- | AF.summary: 
CAP:  | persist=- ui=- pipe=- done=-
QA: [Data] A failed import does not store an empty count for a window that already holds bars
QA.proc: Create a period over a window that HAS bars in `MarketBar` but whose symbol no range-capable provider can serve (measured: `XAUUSD` 5m, any one-day window). Then `POST /api/backtest/periods/{id}/import` and read `GET /api/backtest/periods`.
QA.exp: `outcome: "provider-unavailable"`, `barsBefore == barsAfter == ` the real count (289, not 0), the list shows `barCount: 289`, and `findings[]` carries *"This window ALREADY HOLDS 289 bar(s)…
ROUTES: GET /api/backtest/periods ;; POST /api/backtest/periods/{id}/import
DIAGRAM: ABSENT
DEFERRED: none
UNCHANGED: none

==========================================================================
FILE 2026-09-29-1023-log-retention-and-volume.md   [2026-09-29 infra/feature]
MISSING: none
WHAT: Log volume and retention are now **declared settings the app enforces**, not constants: the writer collapses repeated identical lines to one per window plus a suppressed count, and prunes its own dated log files on a daily schedule — **moving them to an archi…
AF.section=status | AF.summary: Log Retention & Volume — the writer (`SystemLogService`, `nest/logs/tcs-<date>.log`) enforces four declared settings: it collapses repeated identical lines to one per `logging.repeatWindowMinutes` plus a count, and at 03:15 **moves** dated files outside `logging.retentionDays` into `nest/logs/archive/`, removing them on the fol…
CAP: Log Volume Control & Retention | persist=config ui=1 (`/settings/data-management` → Log Files panel) pipe=none done=complete
QA: [System / Data] Log retention moves before it removes, and never touches today's file
QA.proc: Create `nest/logs/tcs-2026-01-01.log`, then `POST /api/system/logs/prune?dryRun=true` and confirm the file still exists in place; then `POST /api/system/logs/prune?dryRun=false` and confirm it is now at `nest/logs/archive/tcs-2026-01-01.log` (NOT de…
QA.exp: Dry run lists the file under `wouldRemove` with `archived: []` and the file survives. The first real run returns it under `archived` and it exists in `archive/`; `nest/logs/tcs-2026-09-29.l…
ROUTES: GET /api/system/logs/retention ;; POST /api/system/logs/prune ;; GET /api/system/logs/collapse-stats
DIAGRAM: present
DEFERRED: Compress rather than hold. The archive is bounded by the same window, so nothing accumulates — but old ~ A stated ceiling for the worst day. The acceptance criterion asks that a `tcs-<date>.log` for a ~ The launcher's success message is still a port check. The `-State Listen` bug that let the OLD API
UNCHANGED: The in-memory ring buffer is NOT collapsed. It is bounded at 500 entries, so a storm cannot grow it, ~ `logs/` (repo root) is still not gitignored. It holds live `logs/scoring/*.jsonl`. Console capture was ~ Item 3's option (c) — downgrade bridge-unreachable from WARN to DEBUG — is declined. The issue already

==========================================================================
FILE 2026-09-29-1027-exit-verdict-replay.md   [2026-09-29 trading/feature]
MISSING: none
WHAT: Added `scripts/replay-exit-verdict.cjs` (step 3d) — it replays the REAL 5-directive `ExitConsensus` verdict over every closed valid trade — and its answer refutes the exit premise **three ways**, so `#1019`'s acting exit is **NOT built** and the sprint is red…
AF.section=data | AF.summary: Exit Verdict Replay — replays the REAL `ExitConsensus` verdict (`exit-consensus.service.ts`) over closed trades using `marketbar` bars. Requires the **compiled** service for `EXIT_DIRECTIVE_IDS` and `arguesExitFor` and the compiled directive classes — it refuses to substitute copies, and fails loud if they cannot be read. Bars …
CAP: Exit Verdict Replay (step 3d) | persist=ephemeral ui=**0** — and that is a finding, not a blank: the measurement is reachable only by running `npm run replay:verdict`. Nothing in the UI or the API surfaces it. pipe=none — it READS `trade` and `marketbar` and writes nothing done=complete
QA: [Trading] The exit verdict is replayed honestly, and a NaN is refused rather than reported
QA.proc: `npm run test:replay-verdict` (expect 12/12, exit 0), then `npm run replay:verdict`.
QA.exp: fires on **77/166** at EXIT (delta **−0.0080%**) and **153/166** at REDUCE (delta **+0.0272%**), with `ran` > 0 and `no bars` / `threw` = 0. Then break it: make `toBar` return `c: +r.close`…
ROUTES: NONE
DIAGRAM: present
DEFERRED: The `time-stop` cannot-ever-argue defect — not fixed here because it is an exit-contract change, not a replay change. Measured: `neutral` in 4206 of 4206 evaluation…
UNCHANGED: No acting exit was built. Considered and declined — that is the question steps 3c/3d existed to answer, and the answer is no. Nothing is outstanding. ~ The API was not rebuilt. The only backend edit is a comment, so `dist/` differs by a comment; the served version is UNVERIFIED and needs a restart. Not manufactured… ~ Intrabar fills not modelled. Considered and declined — would need tick data the store does not hold for these windows. Stated as a limitation in `#1027` instead of …

==========================================================================
FILE 2026-09-29-986-backtest-periods.md   [2026-09-29 data/feature]
MISSING: none
WHAT: A backtest could only ever measure **the most recent N bars**. `run()` loaded bars with `take: days + 120` — a ROW LIMIT walking backwards from the newest bar — so a window that ended months ago was **not expressible**. That is why sprint #965 could not produ…
AF.section=data | AF.summary: Backtest Periods — a named, noted range of `MarketBar` that a backtest or replay measures. NOT a second bar store: bars stay in `marketBar` (uniqueness symbol+timeframe+timestamp, so an import is idempotent); the period row only NAMES a range. `getCandlesRange()` was added to the provider interface because the existing `getCand…
CAP: Backtest Period Capture | persist=stored ui=1 — the period panel on the Backtest Engine page (`/lab/backtest`) pipe=none (analytics/research; writes bars for the backtest + #819 replay to read) done=complete
QA: [Data] A captured period imports idempotently, and an empty window reports a finding
QA.proc: `POST /api/backtest/periods/import` with `{ name, symbol, timeframe, from, to }`, then re-run `POST /api/backtest/periods/{id}/import`. Then POST the same body with a date range the market was closed for (e.g. a weekend) on a tradeable ticker.
QA.exp: First run reports `outcome: "imported"` with `inserted = fetched`. The RE-RUN reports `inserted: 0`, `alreadyPresent = fetched`, and `barsAfter == barsBefore` — the idempotency assertion. T…
ROUTES: POST /api/backtest/run ;; POST /api/replay/run ;; POST /api/backtest/periods/import ;; POST /api/backtest/periods/{id}/import ;; POST /api/backtest/periods ;; POST /api/backtest/periods/:id/import ;; GET /api/backtest/periods/:id ;; DELETE /api/backtest/periods/:id ;; GET /api/backtest/periods
DIAGRAM: present
DEFERRED: none
UNCHANGED: An existing bar is NOT overwritten by an import. The unique key is ~ The bars are NOT deleted when a period is deleted. They belong to the symbol and are shared by ~ `getCandles()` was not changed to accept a range. It has other callers whose behaviour depends

==========================================================================
FILE 2026-09-30-1028-1029-signal-class-integrity.md   [2026-09-30 data/bugfix]
MISSING: ArchFramework
WHAT: A signal class is a **VALUE**, not a string to be prefix-matched or truncated. Two halves of that one class were live: `#1029` classified signals by prefix (so both STRONG classes read as `watch`), and `#1028` stored `STRONG_SELL` in a `VarChar(10)` column (s…
AF.section=- | AF.summary: 
CAP: Signal-class integrity (classification + storage width) | persist=stored ui=1 — the Recently Analysed badge is now correct for both strong classes pipe=scoring done=complete
QA: [Scoring] A signal class survives classification and storage
QA.proc: `node nest/scripts/validate-signal-classification.cjs --self-test` and `node nest/scripts/validate-signal-column-width.cjs --self-test` (expect 12/12 and 8/8). Then `GET /api/scoring/recently-analysed` — a `STRONG_BUY` symbol must NOT render as "Wat…
QA.exp: both self-tests pass, both gates exit 0, and the query `SELECT COUNT(*) FROM score_snapshot WHERE trading_signal='STRONG_SEL'` returns **0** (it was 1,081). ⚠️ To see the fix work, force a …
ROUTES: GET /api/scoring/recently-analysed
DIAGRAM: present
DEFERRED: `DirectiveOutcome.signalClass` stays `VarChar(10)` — no, this is NOT deferred: it is a declared exception in the guard, because it holds `bearish | bullish | neutra… ~ `strategy_signal_queue.signal` is not covered by the width gate — it is an unmodelled table (raw-managed, as `schema.prisma`'s header documents), so there is no dec…
UNCHANGED: `strategy_signal_queue.signal` and `strategy_evaluation.signal` hold the SIDE (`BUY`/`SELL`), not a class — measured, max length 4. Widened anyway (free, and remove… ~ No recovery of the 83,000 NULL `decision_log.signal` rows. Considered and declined — the value was never written, so there is nothing to restore. ~ The classification fix is presentation-only. Blast radius traced before changing: the value reaches `GET /api/scoring/recently-analysed` and ONE consumer, the badge…

==========================================================================
FILE 2026-09-30-1030-broker-addressed-position-io.md   [2026-09-30 trading/bugfix]
MISSING: none
WHAT: Post-entry exit management (stop guardian + position time-stop) now reads and writes **every active MT5 bridge**, addressing each position by the account that HOLDS it, instead of using one URL captured at start-up. Two of nine live positions had never been t…
AF.section=data | AF.summary: Position I/O is broker-addressed. `Mt5ConnectionManager.getAllPositions()` merges every bridge and stamps each row with `brokerId`; the guardian and time-stop read positions from all bridges and address `getCandles` / `modifyOrder` / `closePosition` by `position.brokerId`. `modifyOrder()` now returns HTTP `status` so a broker r…
CAP: Multi-Account Post-Entry Exit Management | persist=ephemeral (in-memory tick state) + `stop_adjustment` audit rows ui=1 (`ViewStrategyPage` renders `guardedPositions`; it does **not** yet show which account a position is on — the API does, via `brokerCoverage` / `GuardedPosition.brokerId`) pipe=trading done=complete for the two managers; the read path is open as **#1033**
QA: [Trading] A position on the second MT5 account is guarded and edited on its own account
QA.proc: `GET /api/automation/stop-guardian` (or `/status`) and read `brokerCoverage` + `guardedPositions[].brokerId`; compare the count against `GET :5000/positions` plus `GET :5001/positions`.
QA.exp: `guardedPositions` contains rows with `brokerId: 3`; `brokerCoverage.brokersQueried` is `[2,3]` and `positionsByBroker` accounts for every position both bridges report. Before the fix the c…
ROUTES: GET /api/automation/stop-guardian ;; GET /api/mt5/positions
DIAGRAM: present
DEFERRED: The read path — `GET /api/mt5/positions`, its close-all loop, and
UNCHANGED: `Mt5TradingService`'s `bridgeUrl` getter — `getAccount()` is genuinely a primary-account read, ~ The UI — `brokerId` is additive and rendered nowhere; adding it is a UI change for the owner

==========================================================================
FILE 2026-09-30-1031-bot-magic-attribution.md   [2026-09-30 trading/bugfix]
MISSING: none
WHAT: `#1018`'s per-bot MT5 magic never reached a single order, because `findAll()` returns an **explicit field list** and `magic` was not in it — so every position carried `234000` ("no bot attributed") and `trade.magic` was NULL on every open row. Fixed at every …
AF.section=data | AF.summary: Per-bot MT5 magic is the durable owner key for a position. `trading_strategy.magic` (seeded 234100+, UNIQUE, never 234000) travels with a position for life and is never truncated or punctuation-mangled, unlike the order comment. It must be listed in `findAll()`'s explicit field map or it is silently dropped — the defect that ma…
CAP: Per-Bot Position Attribution (MT5 magic) | persist=stored ui=1 — `magic` is now on `GET /api/trading/strategies`; no page renders it yet pipe=trading done=partial — the write path is complete and proven at the API; no position opened since the fix, so an order carrying its bot's magic has **not** been observed
QA: [Trading] A new order carries its bot's magic, and every bot has a unique one
QA.proc: `GET /api/trading/strategies` — every strategy must carry a non-null `magic`. Then read `sql: SELECT magic, name FROM trading_strategy` (0 NULL, 0 duplicates). After the next order opens: `curl :5000/positions` — that position's `magic` must equal i…
QA.exp: 40/40 strategies with a non-null magic (observed 2026-09-30); the next position opened carries a per-bot value. ⚠️ Positions opened before 2026-09-30 keep `234000` for life — magic is immut…
ROUTES: GET /api/trading/strategies
DIAGRAM: present
DEFERRED: ~9 files still hand-roll the self-test loop (`replay-exit-counterfactual.cjs`, `replay-exit-verdict.cjs`, `validate-theories.cjs`, `validate-notices.cjs`, `audit-sy…
UNCHANGED: The 6 surviving positions keep `234000`. Considered and declined — immutable in MT5, and closing/reopening a demo position to tick a box is not warranted. ~ No backfill of `trade.magic` on historical rows. Considered and declined — `scoringStrategyId` attributes 182 of 410 trades, and inventing the rest trades a known g…

==========================================================================
FILE 2026-09-30-1032-shared-selftest-harness.md   [2026-09-30 infra/refactor]
MISSING: none
WHAT: One shared self-test harness, plus a guard so a new file cannot hand-roll it — and the guard caught two copies written the same day, including by the agent closing the issue.
AF.section=status | AF.summary: Self-test harness consolidation (#1032) — `scripts/lib/validator-helpers.cjs` exports `runCases()` (non-exiting) and `runSelfTest()` (exiting), and `scripts/validate-selftest-harness.cjs` now fails when a file re-implements that contract. The signature is deliberately narrow — a loop over a `cases` array that both `try`s and th…
CAP: Single-sourced self-test harness, guarded | persist=ephemeral ui=0 — a build/CLI check with no UI surface, stated as a finding pipe=none done=complete
QA: [Infrastructure] A new validator cannot hand-roll the self-test harness
QA.proc: `npm run validate:selftest-harness` (expect exit 0), then plant a copy — a file containing `for (const [name, fn] of cases)` with a `try` and a `fn() === true` comparison and a PASS/FAIL log — and re-run
QA.exp: first run prints `✔ OK — no file re-implements the harness` and exits 0; after planting, it names the file and line as `**VIOLATION**` and exits 1. `npm run test:selftest-harness` passes 8/8
ROUTES: NONE
DIAGRAM: present
DEFERRED: A shared API for table-driven cases — the 4 files that iterate a `cases` array with per-case arguments share a genuine second shape. Two options were considered and… ~ Wiring the guard into `prebuild` — deliberate hold. A gate that has run once is not yet a gate; wire it once a divergence is caught in the wild.
UNCHANGED: The 4 table-driven files — considered and declined. Converting them trades a duplication defect for a readability defect, and the guard's whole credibility rests on… ~ `scripts/validate-decisions.cjs`, `scripts/verify-view-meta-routes.cjs`, `nest/scripts/audit-strategy-realism.cjs`, `nest/scripts/validate-rule-enforcement.cjs` — a…

==========================================================================
FILE 2026-09-30-1035-wrong-account-order-refusal.md   [2026-09-30 trading/feature]
MISSING: none
WHAT: A bridge attached to an account it was **not** configured for now **refuses every order-placing call** with notice `TCS-TRADE-021`, instead of only logging the mismatch. Reads (`/health`, `/positions`, `/account`, quotes) stay open so the app can still see wh…
AF.section=data | AF.summary: Bridge credential binding — `order_send_checked()` is the single choke point for every order the MT5 bridge places. `verify_connection_identity()` compares the REQUESTED login/server with the ACTUAL session on every connect; the result (`credential_mismatch`) refuses mutating calls via a typed `BridgeRefusal` caught in `do_POST…
CAP: Wrong-Account Order Refusal | persist=config (the binding is `.env` slot credentials, verified against the live session) ui=2 — `/health` and `/broker` carry `orderReady`; the refusal renders through the existing notice surface (`TCS-TRADE-021`). ⚠️ No dedicated UI page; it surfaces where refusals already surface. pipe=trading done=partial — the gate is complete and guarded; the live path is unobserved (below)
QA: [Trading] A bridge on the wrong account refuses orders and says so
QA.proc: Start a bridge with `MT5_ACCOUNT_<slot>=99999999`, `MT5_SERVER_<slot>=NoSuchServer-Demo` and **its own `MT5_PATH_<slot>`** (⚠️ without a path it attaches to a live terminal — that is how #1035 was found). Then `POST /order` on that port, and `GET /h…
QA.exp: `POST /order` returns **409** with `code: TCS-TRADE-021` and `params` carrying `requestedAccount` / `requestedServer` / `actualAccount` / `actualServer`. `GET /health` returns `connected: t…
ROUTES: POST /order ;; GET /health ;; GET /positions
DIAGRAM: present
DEFERRED: Live verification of the refusal on a real bridge — not done here because loading the change
UNCHANGED: `reachable` on `Mt5BrokerInfo` — considered and declined. Row 48 records that three services ~ `/reconnect` and the account-switch route — considered and deliberately NOT gated. They do not

==========================================================================
FILE 2026-09-30-1037-contested-position-claimants.md   [2026-09-30 trading/feature]
MISSING: none
WHAT: A position built from **several bots' orders** is now detected and **named** rather than silently unowned, and the detection is a pure, tested module so the guardian can share it (#1041).
AF.section=trading | AF.summary: Order→position→bot derivation for netting accounts. `position-claimants.ts` is pure and shared; `getPositionsManaged()` exposes `claimants[]` + `contested` per position. Identity is the
CAP: Contested-position detection (claimants) | persist=derived, nothing stored ui=1 — the Positions Monitor card names the claimants pipe=both done=partial — detection and display complete; **acting** on a contested position is #1041
QA: [Trading] A position built from several bots is reported as contested, with its claimants nam…
QA.proc: `npx jest src/modules/trading/position-claimants.spec.ts`; then `GET /api/trading/mt5/positions/managed` and inspect `claimants` / `contested` per position.
QA.exp: 16/16 pass. The incident fixture yields **one** position with **three** claimants (`Gold Position 4H (copy)`, `AB-A 929 measurable run`, `AB-B 929 measurable run`) and `isContested` true; a…
ROUTES: GET /api/trading/mt5/positions/managed
DIAGRAM: present
DEFERRED: The guardian half — manage a contested position by its strictest claimant. Owner: #1041.
UNCHANGED: `getPositions()` (single-bridge). Still used by `closeAll`/`closePosition`/`modifyPosition`,

==========================================================================
FILE 2026-09-30-1037-position-lifecycle-change-guide.md   [2026-09-30 docs/docs]
MISSING: CapabilityMap + ArchFramework
WHAT: Ticket `152703882760` (−322.67, the worst trade on record) is written up as a **guide for changes**: seven measured failures turned into rules any change to a bot or algorithm must satisfy, plus the specification for the position-management interface the owne…
AF.section=- | AF.summary: 
CAP:  | persist=- ui=- pipe=- done=-
QA: [Documentation / Trading] Position lifecycle change guide explains the worst trade from the app alone
QA.proc: Open `docs/change-guide-position-lifecycle.md`; cross-check the deal table against `GET /api/mt5/history/deals?days=2` filtered to `positionId 152703882760`, and the app row against the `trade` table for `brokerTicket 152703882760`.
QA.exp: Eleven deals, one `positionId`, ten opening fills totalling 0.10 and one 0.10 close at reason 4 (SL); the `trade` row shows `quantity 0.01`, `pnl −322.67`, `abTestId NULL`, `pnlInvalid 0`. …
ROUTES: GET /api/mt5/history/deals
DIAGRAM: ABSENT
DEFERRED: none
UNCHANGED: `#1014`, `#807`, `#929`, `#801`, `#721`, `#1030`, `#1033`, `#978`, `#979` — the guide points at ~ No version bump — documentation only.

==========================================================================
FILE 2026-09-30-929-ab-cancel-and-brake-layer.md   [2026-09-30 automation/feature]
MISSING: none
WHAT: A running A/B test can now be **halted without inventing a verdict** — a choice that did not exist in the API — and the bot's own picture now shows **what stops a trade, and whether that needs the app to be running**. The run that caused the worst trade on re…
AF.section=automation | AF.summary: `POST /api/automation/ab-tests/:id/cancel` halts a run with **no verdict**, distinct from `:id/stop` which completes it and computes one. **Only `status='running'` dispatches orders** — `automation-loop.service.ts` `evaluateAbTest()` reads `getActiveTests()`, which filters on that one value, so any other status is the kill swit…
CAP: A/B run cancellation + bot brake coverage | persist=stored (status on `ab_test`); the brake layer is derived, nothing stored ui=2 — the bot lifecycle diagram and the Exit-management section on the bot page; the cancel route is API-only (**no UI button exists** — a finding, not a blank) pipe=both done=complete for the cancel path and the surfaces; **partial for the UI** (no button)
QA: [Automation] A running A/B test can be cancelled without producing a verdict
QA.proc: `POST /api/automation/ab-tests/{id}/cancel`, then `SELECT status FROM ab_test WHERE id='{id}'` and `SELECT COUNT(*) FROM ab_test WHERE status='running'`.
QA.exp: `status` is `cancelled` (not `complete`), `results` is JSON `null`, and the running count is **0** — so `evaluateAbTest()` iterates nothing and no further orders are dispatched for that tes…
ROUTES: POST /:id/cancel ;; POST /api/automation/ab-tests/:id/cancel ;; POST /api/automation/ab-tests/{id}/cancel
DIAGRAM: present
DEFERRED: A UI control for cancel. The route exists; nothing in the frontend calls it. Owner:
UNCHANGED: `stop()` still computes a verdict — it is the correct action for a test that genuinely ran, so ~ The brake-layer claims. They assert nothing (`ok: null`), because neither the bridge caps nor ~ No version-bump rebuild. Repo and nest are 0.104.0; the API was not restarted for it. The next

==========================================================================
FILE 2026-09-30-992-option-b-session-recovery.md   [2026-09-30 infra/feature]
MISSING: none
WHAT: ⚠️ **Most of #992 was already built** (option A, the bridge's own watchdog, landed 2026-09-25 in `0db44af`) and the issue was never closed, so it read as open work. This lands **option B**: an API-side observer that recovers a bridge whose MT5 session died — …
AF.section=routes | AF.summary: MT5 session recovery is two mechanisms by design. The bridge's watchdog (A) recovers while it can still poll, bounded at 5 attempts then stops. The API's `Mt5SessionRecoveryService` (B) observes every 30s, acts only when a bridge `answered` but its session is gone, and is delimited by 3 consecutive observations, a 5-minute cool…
CAP: Automatic MT5 Session Recovery (API-side observer) | persist=ephemeral (in-memory tick state) ui=1 — `GET /api/providers/mt5/session-recovery` + `POST` to toggle. Not yet rendered in the UI; the manual reconnect already is (`Mt5StatusPage`). pipe=trading (availability, not decision-making) done=partial — **never observed recovering a real outage**
QA: [Providers / MT5] A bridge that answers with a dead session is recovered; one that does not answer is…
QA.proc: `GET /api/providers/mt5/session-recovery` with both bridges healthy → then stop one terminal's session (not the bridge) and watch `bridges[].consecutiveDown` reach 3, followed by a reconnect attempt. Kill a bridge process instead and confirm `unansw…
QA.exp: healthy → `totalAttempts: 0`, both `answered: true`. Session lost → an attempt at `consecutiveDown: 3`, logged once with the remedy. Bridge process down → `unansweringBrokerIds` contains it…
ROUTES: POST /api/providers/mt5/session-recovery ;; GET /api/providers/mt5/session-recovery
DIAGRAM: present
DEFERRED: #1000 — the bridge's blocking-native-call failure mode. B cannot cover it: the bridge answers
UNCHANGED: `reachable` — three services read it. Re-defining a field others use is how a fix becomes an ~ The bridge's 5-attempt cap — raising it would make A the unbounded loop it refuses to be.

==========================================================================
FILE 2026-09-30-994-927-floor-remeasured.md   [2026-09-30 risk/docs]
MISSING: CapabilityMap + ArchFramework
WHAT: No code changed. **#994 was re-measured and closed with a verdict**: the #927 declared-distance floor **is** holding, and the panel that reported "18 breaches" has two independent defects of its own.
AF.section=- | AF.summary: 
CAP:  | persist=- ui=- pipe=- done=-
QA: [Risk] The #927 floor panel reports no breach after a bot's `slPct` changes
QA.proc: Note the panel's breach count, change a bot's `slPct` via `PUT`/seed, re-open `/trading/stop-guardian`.
QA.exp: the count is unchanged and historical rows keep their verdicts. **Today it changes**, which is the defect in #1034.
ROUTES: NONE
DIAGRAM: ABSENT
DEFERRED: none
UNCHANGED: L1209's recorded basis — the writer is correct for what it says; the *detector* misreads it. ~ The 7 rows — left exactly as recorded. They are accurate history, and rewriting them would

==========================================================================
FILE 2026-09-30-add-symbol-notice-null-crash.md   [2026-09-30 ui/bugfix]
MISSING: CapabilityMap + ArchFramework
WHAT: The free-edition **Add Symbol** page (`/watchlists/add-symbol`) threw `TypeError: Cannot read properties of null (reading 'notice')` on its **first render** and took the entire page down. `ManualAddForm` dereferenced `msg.notice` **outside** the `msg` null gu…
AF.section=- | AF.summary: 
CAP:  | persist=- ui=- pipe=- done=-
QA: [UI] Add Symbol page renders without throwing on first load
QA.proc: Load `/watchlists/add-symbol` with a cleared browser console and do not type anything.
QA.exp: The Add Manually form renders (heading, Ticker / Name / Exchange inputs, Type select, Add Symbol button) and the console shows zero errors, warnings or asserts.
ROUTES: NONE
DIAGRAM: ABSENT
DEFERRED: none
UNCHANGED: No automated guard added for this class. A heuristic for "property read outside its null guard"

==========================================================================
FILE 2026-09-30-meta-stack-review-and-guards.md   [2026-09-30 infra/refactor]
MISSING: none
WHAT: An engineering review of META.Stack from start to finish, then the fixes it identified — plus two guards that close whole classes of defect rather than single instances. The review itself is `docs/meta-stack-structure-review.md`; this handoff covers the landi…
AF.section=status | AF.summary: Architecture-surface agreement guard — `scripts/validate-architecture-docs.cjs` enforces two invariants between `src/core/architecture-reference.js` (the ~23K agent chipboard, declared `@generated`) and `src/pages/architecture-framework.data.js` (the ~38K human page). `INV-ARCH-DOCS-1`: the `ARCHITECTURE_INDEX` section name set…
CAP: Architecture-surface agreement guard | persist=ephemeral ui=0 — it is a build-time/CLI check with no UI surface, stated as a finding pipe=none done=complete
QA: [Infrastructure] The query scanner does not report a false REFETCH
QA.proc: `node scripts/analyse-query-patterns.cjs --self-test` (expect 11/11), then `node scripts/analyse-query-patterns.cjs` and read the REFETCH section
QA.exp: self-test VALID; REFETCH reports 0 sites — the six it previously reported were verified by hand, 5 of 5 checked were false positives
ROUTES: NONE
DIAGRAM: present
DEFERRED: The remaining naming collisions — 21 of 25 remain (`Recommendation`, `TradeRecord`, `SessionInfo`, `MarketStatus`, `MarketSession`, `MarketBar`, `SwingPoint`, `Fres… ~ 3 oversized controllers — `trading/trade-history.controller.ts` (1,244 lines), `scoring/protocol-gating.controller.ts` (942), `automation/automation.controller.ts` … ~ 138 N+1 sites across 41 files — hot paths first: `trading-strategy.service.ts` (12), `backtest.service.ts` (10), `research-import.service.ts` (12). Owner: the revie…
UNCHANGED: `trading-strategy.service.ts:1707` and `:1776` still say `StopGuardianService` — considered and left, because they are CORRECT. Proven, not assumed: `automation/sto… ~ `validate-architecture-docs.cjs` is NOT in `prebuild` — `prebuild` is shared by every agent, and a gate that has run once is not yet a gate. Same reasoning as `vali… ~ `scripts/analyse-query-patterns.cjs` is not a build gate — its N+1 rule has a high false-positive rate by construction (it matches adjacency, not data flow). Every …

==========================================================================
FILE 2026-09-30-page-walkthrough-ui-review.md   [2026-09-30 ui/feature]
MISSING: none
WHAT: Added **Page Walkthrough** at `/development/ui-review` — one row per view in the app (141 rows), where the owner records **importance** (H/M/L), **hide now** (Y/N), **keenness** (1–3) and a free-text **note**, saving on every interaction. It exists so the fre…
AF.section=routes | AF.summary: Page Walkthrough — owner-facing curation surface at `/development/ui-review`. One row per view (141, built from `VIEW_META` + `NAV_TREE`) carrying importance / hide / keenness / note, saved per interaction to the `appsetting` store and mirrored to `nest/app-settings.json` so an agent can read the answers as a file. Endpoints: `…
CAP: Page Walkthrough (UI Review) | persist=stored ui=1 (`/development/ui-review`) pipe=none done=complete
QA: [UI] Page Walkthrough saves an answer and survives a reload
QA.proc: Open `/development/ui-review`, set a row's importance to **H** and type a short note. Wait for the row to show **saved**, then reload the page.
QA.exp: Importance reads **H** and the note is present after the reload.
ROUTES: PUT /api/system/settings/ui-review ;; GET /api/system/settings/ui-review
DIAGRAM: present
DEFERRED: No DELETE endpoint, and a stray `__selftest__` key left in the store by the round-trip
UNCHANGED: none

==========================================================================
REJECT - missing one of the three mandated entries:
  2026-09-27-1012-orphaned-history.md  ->  CapabilityMap + ArchFramework
  2026-09-29-1022-barcount-from-table-not-import.md  ->  CapabilityMap + ArchFramework
  2026-09-30-1028-1029-signal-class-integrity.md  ->  ArchFramework
  2026-09-30-1037-position-lifecycle-change-guide.md  ->  CapabilityMap + ArchFramework
  2026-09-30-994-927-floor-remeasured.md  ->  CapabilityMap + ArchFramework
  2026-09-30-add-symbol-notice-null-crash.md  ->  CapabilityMap + ArchFramework

SHAPE (has a ## Diagram): 20/25
FILES READ: 25