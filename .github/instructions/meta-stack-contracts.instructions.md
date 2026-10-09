---
description: "META.Stack pipeline contracts — the invariants the pipeline depends on, the boundaries between stages, and where each contract must be mirrored. Read before changing how bars, time, cadence, scoring units, or gating work. Enforced at build time by scripts/validate-pipeline-contracts.cjs."
applyTo: "nest/src/**, scripts/**, src/**"
---

# META.Stack Pipeline Contracts

> **Name:** `M.E.T.A.` = **M**odular **E**xpert **T**rading **A**rchitecture. The brand spelling is
> **META.Stack**; write `M.E.T.A.` (with the expansion) only where the term is being defined,
> and META.Stack everywhere else. Not to be confused with `MetaStack` = one assembled unit of
> watchlist + protocol + scoring strategy + trading strategy. **The naming rule is settled as
> ADR-015** (`Trading-Command-Suite-Documentation/docs/architecture/DECISIONS.md`) — this block is
> the canonical definition, that ADR records why it is not to be re-litigated.

**Purpose:** stop the pipeline's *substrate* being quietly re-invented.

The macro architecture (watchlists → protocols → directives → scoring strategies → trading
strategies → execution) is settled. What keeps breaking is the substrate: how bars are
loaded, what order they are in, which cadence they represent, what a score unit means, and
when a gate may say "safe to trade". Each of those has been re-derived locally at least
once, and every re-derivation produced **plausible numbers with no error** — which is why
they survived.

This file is the signpost hub. If you are about to write a helper that loads bars, converts
a broker timestamp, decides a cadence, clamps a score, or answers "is this market
tradeable" — **read the matching contract first.** The canonical mechanism probably exists.

> **Enforcement:** `nest/scripts/validate-pipeline-contracts.cjs` runs in `prebuild`, so it
> gates every build and every CI run. It is **zero-tolerance** — no warning budget. If it
> fails, you have either broken a mechanism or introduced a second way of doing a settled
> job. Fix it or raise the question; do not add your file to the whitelist silently.

---

## ⚠️ Before you change scoring, directives, gating, or capacity — read the ADRs

This file guards the pipeline's **structure**. It cannot guard its **intent**, because a
re-decision usually *satisfies* every invariant while violating the reasoning behind it.

Worked example: `capacityMax += maxScore` satisfies `INV-STABLE-DENOMINATOR` perfectly — the
denominator is stable — while breaking the percentage, because the **numerator only accepts
directional scores** and the denominator counts everything. No invariant can catch that.

**The settled scoring decisions are recorded as ADR-010 … ADR-014 in**
`Trading-Command-Suite-Documentation/docs/architecture/DECISIONS.md`:

| ADR | Settled decision |
|---|---|
| ADR-010 | Directive scores are **magnitudes**, not percentages; direction lives in `signalClass` |
| ADR-011 | ONE **stable, config-derived** denominator (`configuredSignalMax`) |
| ADR-012 | Direction eligibility comes from **config**, not the tick |
| ADR-013 | Group **weights are not applied** in assembly (aspirational until #718) |
| ADR-014 | **One implementation per concept** — a fork must name what it replaces |

Each ADR lists the **symptom to expect if someone re-opens it**, so it doubles as a
diagnostic. These are settled, **not frozen** — re-opening is allowed and has a protocol
(named above, in the ADR file). What is not allowed is re-deciding *by accident*.

### The one question that catches drift

> **"Which ADR does this touch — and am I fixing a bug, or re-deciding an approach?"**

A **bug fix** implements a settled decision correctly. A **re-decision** changes it. Both are
legitimate; confusing them is how the denominator acquired three definitions, how two
functions came to compute "capacity" differently, and how the same file ended up with 74
references to 8 competing percentage concepts.

If the answer is "re-deciding", say so explicitly in the issue/PR **before** writing code.

## Boundaries — who owns what

| Stage / concern | Owning file(s) — the contract lives here | Do not re-implement in |
|---|---|---|
| Bar loading (window, timeframe, order) | `nest/src/modules/market-data/market-data.service.ts` → `getBars()` | scoring, directives, automation, signals, pages |
| Cadence from a protocol | `nest/src/common/utils/timeframe.ts` → `selectBaseTimeframe()` | any module that reads `recommendedTimeframe` |
| Bar order at the directive boundary | `nest/src/modules/directives/directives.service.ts` → `normalizeDirectiveBars()` | individual directives |
| Tradeability / freshness | `nest/src/modules/directives/market-status.ts` → `computeMarketStatus()` | gates, directives, pages |
| MT5 time conversion | `scripts/mt5-bridge/mt5_bridge_v2.py` → `utc_iso()` + `detect_server_utc_offset()` | NestJS adapters |
| Score units | directive `maxScore` in the directive class; direction in `signalClass` | UI display code, aggregators |
| Clock-offset regression watch | `nest/src/modules/alerts/alert-trigger.service.ts` → `bridge-clock-skew` | a second health page |

---

## Invariants

Each ID is checked at build time, and (for the QA column) must appear in
`src/data/qa-checklist.js`. **A new invariant needs all three: an ID here, a guard, and a
QA entry.**

| ID | Invariant | Incident it prevents | Enforced by |
|---|---|---|---|
| `INV-BAR-ORDER` | Bar arrays reaching directives are **oldest → newest**; the directive boundary sorts them | #751 — a descending array made "current price" the *oldest* bar | `directives.service.spec.ts` + canary |
| `INV-BAR-ALIGNED` | Every stored `1h`/`4h`/`1d`/`1w` bar timestamp sits on a **valid cadence boundary**, aligned at import by `alignBarTimestamp()`. `1d` is judged **per provider** (mt5 21:00, binance 00:00, yahoo 07:00) because the daily boundary is a property of the market, not of UTC. Import floors to the boundary; a misaligned input is a reject, never a new row | #783 — `importBars()` stored timestamps verbatim and deduped solely on the exact `(symbolId, timeframe, timestamp)` key, so a back-fill that stamped a bar 30 minutes differently wrote a **second row for the same period**: `13:30` ≠ `13:00`, so `P2002` never fired and the constraint could not help itself. Measured: **~27,376 phantom bars of 266,890 (~10%)**, and 1,227 of 1,256 mt5 `1d` rows at 21:30 were byte-identical duplicates of the real 21:00 bar. Worse than duplicate rows: the 30-minute offset made the series' **median interval** read `30m` on a *daily* series, and `computeMarketStatus()` derives `effectiveCadenceMs` from that median — so a fake cadence silently resized the staleness window for every `1h`/`4h`/`1d` protocol. Plausible numbers, no error. ⚠️ This is the ONE bar invariant that inspects **data** rather than code markers — the rest verify a helper *exists* and cannot see that the rows are wrong, which is exactly how this survived | `timeframe.spec.ts` (unit: alignment arithmetic, idempotence, null-coercion) + probe (live: no NEW misaligned row) |
| `INV-BAR-WINDOW` | "Newest N bars" = `orderBy desc` + `take` **then reverse**; `asc + take` returns the *oldest* N | #751 — `loadBars()` scored AUDUSD on a window ending 2026-05-18 | `market-data.service.spec.ts` + scan |
| `INV-CANONICAL-LOADER` | Only `MarketDataService.getBars()` loads a bar window in a scoring/decision path | #751 — two hand-rolled queries lost the `timeframe` filter | scan (whitelist in the validator) |
| `INV-SINGLE-CADENCE` | One bar array = **one** timeframe; cadence comes from `selectBaseTimeframe(protocol.recommendedTimeframe)` | 35 of 187 symbols were fed `5m + 15m + 1h + 4h` in one array | `timeframe.spec.ts` + canary |
| `INV-UTC-TIMESTAMPS` | MT5 epochs are broker **server** time; `utc_iso()` subtracts the measured offset | #750 — bars ~3h in the future; the gate failed open | bridge canary + `bridge-clock-skew` alert |
| `INV-GATE-FAILS-CLOSED` | `computeMarketStatus` returns **closed** when freshness cannot be verified (future-dated, reordered, indeterminate cadence) | #750/#751 — three separate fail-open paths | `market-status.spec.ts` + canary |
| `INV-SCORE-MAGNITUDE` | A directive `score` is a magnitude in `[0, maxScore]`; direction lives in `signalClass`. Never clamp to 100 | the recurring "0–100 trap" that destroys protocol weighting | scan (`Math.min(x, 100)`) |
| `INV-NO-FUTURE-ROWS` | No MT5-sourced row is dated in the future | #750 — a future date silently defeats every staleness check | `nest/scripts/contract-probe.cjs` (live) |
| `INV-NO-STALE-SCORING` | The **one** writer of `directiveoutcome` is unreachable while a symbol's bars are stale. `SignalEnvelopeService.buildEnvelope()` must call `everyCadenceStale()` — which requires **EVERY** cadence to be stale — and return early, **before** `outcomeTracker.recordOutcomes()`. Exactly one call site may exist, and the guard must precede it | #827 — a symbol with a dead feed still scored, and because the directives evaluate an old window (or hit the zero-bar fallback returning `composite: 50`) the number was **plausible**, so nothing downstream could tell a live prediction from a stale one. BTCUSD held 177 hourly bars ending 2026-07-18 (7 weeks) with no `15m` and no `1d` at all, and appeared in the UI as "scoring" while returning nothing. ⚠️ The **base-cadence-only** variant is the dangerous repair and nearly shipped: gating on the base cadence alone skipped **11 symbols that were alive on 5–6 other timeframes** (SPY `1m`=12h stale but `5m`=0.1h fresh; XAUUSD `1m`=8.6h but `15m`=0.0h), i.e. it silently reclassified healthy symbols as dead. Measured on 456 live pairs, tolerance held: 18 pairs under 1d, **zero** in the 1–3d band, 117 at 3–30d, 116 beyond 30d. Evidence for *why* it hid: retention pruned on `predictedAt`, a DERIVED value, so the mis-stamped rows deleted themselves and the issue could only ever observe "33 rows in a 3-hour window" | scan (`no-stale-scoring` — checks cardinality **and** source position) + `timeframe.spec.ts` (`everyCadenceStale`) + `signal-envelope-stale-symbol.spec.ts` |
| `INV-ENDPOINT-BUDGET` | Every endpoint that **aggregates over per-table queries** responds within a latency budget — `health-summary`, `health-dashboard`, `bars/refresh/status`, `gated/thresholds`. Enforced live by `contract-probe.cjs`, which warms each endpoint then measures it | #841 — a retention-config change moved `directiveoutcome` onto an **unindexed** column. The retention code was correct and every build stayed green; the fault instead surfaced three files away as `GET /api/system/health-dashboard` returning **504 after 32,298 ms** against a 30,000 ms gateway timeout, leaving `/status/health-check` stuck on a permanent loading skeleton. Nothing objected for a whole session because **no build check could**: the API is STOPPED during `prebuild` (`prisma generate` holds the query-engine DLL), and the documented session-start script `scripts/health-check.ps1` probes `/api/system/health-summary` — **14 ms**, a completely different code path — while the 5–180 s timeouts already in the probe are *give-up* limits, not assertions. The missing capability was never a code check but the question “does the running system still **respond**, in reasonable time, for the queries that scan every table?” ⚠️ Budgets are set an order of magnitude above observed cost (dashboard ~50 ms vs a 5,000 ms budget) so this fails on a **regression** and never on a busy machine — a guard that cries wolf gets ignored | `scripts/contract-probe.cjs` (live; warm call then measured call per endpoint) |
| `INV-STABLE-DENOMINATOR` | A protocol percentage divides **earned** by **configured capacity**, never by the observed evidence sum. Every percentage for a reading — the `BUY/HOLD/SELL` classification, the `signalPct` shown on a card, `meta.maxScore`, the Arena consensus, and the persisted `rawMax` — uses the SAME denominator: `configuredSignalMax`. Direction-eligibility is decided per directive **from config**, so the denominator is fixed for the tick and identical across symbols | #758 — an observed denominator made the same reading score differently between ticks (it *shrinks* when a directive reads neutral, so a quieter tick inflates the percentage), and gave one protocol two different maxima for two symbols in the same tick. `#758` fixed only the persisted `rawMax` and left `signalPct` observed-based, so a card could read `STRONG_BUY 17%` — label from one denominator, percentage from another. A group contributing 0 also produced `0/0 → 0% HOLD` that was counted as *scored* | canary + scan (`no-observed-denominator`) |
| `INV-MTF-BUNDLE` | Every `scoreWithGating()` call in a decision/analysis path passes the 4th argument — the `{ dayBars, hourBars, min15Bars }` bundle from `loadHigherTfBundle(symbolId, protocolId)`. A site with no bundle writes `// no-higher-tf: <reason>` | MST-004 / #735 — 12 call sites omitted it, so every multi-timeframe directive silently scored from base bars only and returned plausible numbers the live loop would never produce | scan (`no-bundle-less-scoring`) |
| `INV-QUEUE-TERMINAL-STATE` | A queue entry is consumed **only** by a real `EXECUTED`. `QUEUED` stays `pending`; `executing` is a transit state, never a resting one, and a row left in it past the grace period is returned to `pending` | #759 — the code wrote `executing` for QUEUED as well as EXECUTED and nothing read it back, so a signal awaiting confirmation stranded permanently and silently removed the bot from trading that symbol (observed: GBPUSD stuck from 13:07 with no ticket) | `automation-loop.service.ts` recovery pass + QA procedure |
| `INV-GATE-RECONCILED` | The pre-trade gate may only be **lowered** to the lowest participating bot's `minComposite`, and never when a `signals.gate.<protocol>` override is set. A blocked signal names the gate's provenance | #759 — `forex-session-v1` used a style-derived gate of 65 while its bots declared 55–60, so USDJPY/USDCAD/USDCHF scoring 50–60 were dropped by a bar no bot had asked for | `reconcileGateWithBots()` + QA procedure |
| `INV-SESSION-VISIBLE` | A bot held shut by the session gate is reported in `/api/automation/status` → `sessionGatedBots`, with a name-vs-window verdict. A CITY name over a session-tag window is reported `ambiguous` (both readings stated), never silently assumed to be a clock | #759 — three of six forex bots were gated to 19:00–04:00 ET with a single deduped log line as the only evidence, so AUDUSD scored 100% STRONG_BUY with zero blockers and produced no order while every surface looked idle | `auditNameVsWindow()` + status payload + QA procedure |
| `INV-CADENCE-COVERAGE` | Every cadence `selectBaseTimeframe()` can **return** is one `BarRefreshService.TIMEFRAMES` actually **fetches**. The fetched set must be a superset of the resolvable set | #758 follow-up — `'5s–30s'` resolves to `1m`, `1m` was never fetched and the DB held ZERO `1m` bars, so seven active protocols asked for a non-existent cadence, received an empty array, produced no scores, and reported `scoring` with `symbolsScored: 2` for ~6 hours | scan (`timeframe-refresh-coverage`) + probe (live: every wanted cadence has FRESH bars) |
| `INV-PROVIDER-REACHABLE` | Every ACTIVE symbol assigned to a protocol is served by a provider that can actually deliver it — the registry ticker must be one the provider recognises, AND an adapter must be wired to fetch it | #760 — two silent variants: `SPX500`/`TECH100`/`DJI30`/`USOIL` were not the provider's names (zero bars, ever, blocking four active protocols), and crypto was binance-sourced while the refresh loop hardcoded MT5 (aged out over 16–54 days). Both present identically: an empty result | probe (live: assigned symbols have delivered bars) + scan (`timeframe-refresh-coverage`) |
| `INV-NO-SYMBOL-GUESSING` | The hint tables `SINGLE_SYMBOL_HINTS` / `WATCHLIST_HINTS` are **EMPTY**, and every ACTIVE protocol resolves its symbols through a declared relationship — a `symbol_protocol_assignment` row or a `watchlist.protocolId` FK. A protocol may never have its symbols inferred from its own slug text | #761 → #764. **#761** renamed stale targets (`BTCUSD`/`USOIL`/`DOGEUSD`/`CHN50`) — fixing the symptom. **#764** swept all 46 protocols and found 20 (10 ACTIVE) depended on the guess tables and nothing else, i.e. a protocol's symbols were inferred from its name. A guess cannot survive a rename, cannot report that it broke, and is indistinguishable from a working relationship once bars arrive. The tables were emptied and all 20 protocols wired by FK | `symbol-hint-validity.spec.ts` (tables empty, no guessing, warning preserved) + probe (nothing guesses) + `scripts/audit-hint-dependency.cjs` |
| `INV-WATCHLIST-IDENTITY` | A protocol reaches its watchlist through `watchlist.protocolId` (a FOREIGN KEY). Any surviving name-based lookup must pin its ordering deterministically. No watchlist NAME may resolve to more than one row | #763 — two faults with one cause. **(a)** Resolution matched the watchlist NAME against the protocol's slug text (normalising only `-`/`_`), so a genuine rename broke the link and the protocol silently fell through to name-guessing. **(b)** Five watchlists existed twice — slug-shaped id AND UUID — and the query ended `LIMIT 1` with no `ORDER BY`, so which row a protocol read depended on storage order. The pairs were NOT identical: `dxy-sensitive` held 12 symbols under its UUID and 10 under its slug, missing `USDCNH`/`USDSEK` — a coin-flip that silently dropped two currency pairs from the DXY basket | `watchlist-identity.spec.ts` (unit: FK preferred, ordering pinned, fallback loud) + probe (live: no ambiguous name) |
| `INV-QUEUE-TERMINAL-STATE` | A queue entry is consumed **only** by a real `EXECUTED`. `QUEUED` stays `pending`; `executing` is a transit state, never a resting one, and a row left in it past the grace period is returned to `pending` | #759 — the code wrote `executing` for QUEUED as well as EXECUTED and nothing read it back, so a signal awaiting confirmation stranded permanently and silently removed the bot from trading that symbol (observed: GBPUSD stuck from 13:07 with no ticket) | `automation-loop.service.ts` recovery pass + QA procedure |
| `INV-GATE-RECONCILED` | The pre-trade gate may only be **lowered** to the lowest participating bot's `minComposite`, and never when a `signals.gate.<protocol>` override is set. A blocked signal names the gate's provenance | #759 — `forex-session-v1` used a style-derived gate of 65 while its bots declared 55–60, so USDJPY/USDCAD/USDCHF scoring 50–60 were dropped by a bar no bot had asked for | `reconcileGateWithBots()` + QA procedure |
| `INV-ONE-ROW-PER-RUN` | One `(symbol, protocol, minute)` owns **one** authoritative `Score` row. A second writer must **adopt** the existing row (reusing its id), never `create` a shadow duplicate with a thinner `breakdown` | the Ladder's ragged cards — `signals-workbench` created a thin 8-key row 0.2–4.5 s *after* the 21-key `protocol-gating` row, so the `(minute, protocol)` grouping read the newer thin row and lost `rawMax` (no percentage) and `marketStatus` (closed markets read as live). ~47% of `Score` rows were thin duplicates | scan (`shadow-score-writer`) + `collapseDuplicateWrites()` in `score-history.service.ts` |
| `INV-ADAPTIVE-TARGET-MONOTONIC` | A protocol's optional Adaptive Target peak (`protocol.adaptiveTargetMax`) may **only ever increase**. It is a high-water mark, never a rolling window, never decayed toward recent readings, never lowered on a quiet period. Enabled → the captured peak is **bounded by a floor** (25% of configured capacity) so a near-dead protocol cannot read as healthy | #685 — a protocol's structural ceiling is far below its configured capacity because directives are mutually exclusive, so `raw / configured` reads ~20% on a best day (max ever recorded: 32%). A *falling* target would let a directive that quietly stopped working lower the bar to match and the card would still read healthy — the "plausible numbers, no error" class | `adaptive-target.spec.ts` (explicit monotonicity assertions) |
| `INV-NO-FABRICATED-READING` | **Absence of evidence must never become a number, a direction, or a veto.** A directive that cannot take a reading returns `score: 0` **with `unmeasured: true`** — never a constant baseline, never a direction derived from the sign of a near-zero quantity. An unmeasured directive contributes nothing to the composite and can never trip a risk gate. Corollary: a `readiness: 'ready'` directive must not return a stub baseline | **Three separate live incidents, one cause.** **(a)** `analyst-adjustments` returned `score: Math.round(30 + accelerating*5)` with `signalClass` from the SIGN of `accelerating`. Measured: 1,125 `bullish` readings averaged 30.9 with a minimum of **exactly 30**; 630 `bearish` averaged 29.7 with a maximum of **exactly 30** — 94% of 1,755 readings sat inside a fabricated 27–50 band. On `forex-session-v1`, **97% of readings (589/605) came from that branch and 275 cleared the 65 gate** — the app was trading on invented conviction. **(b)** `liquidity-check` returned `score: 0` when its stale-data guard tripped; `RiskGatingEngine` derived `severity = 1.0` and tripped a HARD GATE, zeroing the composite and blaming *"Symbol liquidity too low"*. `spy-day-v1`, `qqq-day-v1` and `spy-speed-v1` were gated shut on **every tick** for 45 minutes. **(c)** `stubResult()` presented "not implemented" as a real zero. All three produced **plausible numbers with no error** | `risk-unmeasured-gate.spec.ts` + `analyst-adjustments-honesty.spec.ts` (both proven to fail when the guard is removed) + scan (`no-fabricated-baseline`) |
| `INV-NO-UNMEASURED-CALENDAR-CLAIM` | **A dated bias must be MEASURED or silent.** A directive that branches on the calendar (day-of-week / month / year getters) and emits any non-zero score must carry a `MEASURED` citation in its source; an unmeasured dated claim is retired to `score: 0, unmeasured: true`. Structural uses of the getters (market-open gates, session mechanics, settlement windows) are whitelisted **by name with a reason**, and the whitelist may only shrink | **The entire calendar family asserted biases nobody had measured, and the one that was tested did not reproduce.** `friday-drift` claimed *"~58% of the time"* — measured **50.7% against a 52.7% baseline** (the wrong direction). The same difference-in-differences method then refuted `monday-effect` (**+0.44pp, t=0.36**) and `turnaround-tuesday` (**+0.35pp, t=0.30**) — **0 of 45 symbols at the honest 3.2σ threshold**. 17 claims retired to explicit zero (including permanent floors of 2-10 points on non-event days); 5 structural uses whitelisted. Canaried both directions: a false calendar claim fails the build (#879) |
| `INV-GATE-MEMBERSHIP` | A group with `isRiskGate: true` may contain **only** `category: 'structural'` directives — the interface's own definition of a gate (*"'structural': Risk gates, regime checks. Modifier, not signal score."*). A `pattern`/`oscillator`/`ratio` directive in a risk gate is a directional **voter** whose reading the scorer discards | #789 — `session-open-effect` (a directional `pattern` predictor, maxScore 60) sat in the `risk` gate of **14 protocols**, contributing no score, no direction and no capacity in any of them. In 10 of those a lower-`sortOrder` `technical` copy happened to save the signal, so the ONLY visible symptom was a duplicate-directive boot warning — a *different* fault that produces the same message, which is why it read as a config nit for so long. The guard then found **4 more of the same class**, including `btc-halving-cycle` (maxScore **200**, the highest weight in the system) and `earnings-momentum` — all with **zero** scoring-group copies, i.e. entirely dead rather than merely double-counted. Nothing reported any of them: `ProtocolHealthService` names duplicates, never the inert one | `validate-directive-group-kind.cjs` (scan: seed × directive classes) + `test-gate-membership-guard.cjs` (proves the guard bites) |
| `INV-SEED-DB-CONSISTENT` | **Gate 3 (STATE).** The running database's directive-placement counts must agree with the seed file that describes them. `ProtocolDbService.seedProtocolsToDatabase()` is **UPSERT-ONLY** — it creates and updates but never deletes — so a removal or a move in the seed is a **silent no-op** in the DB, and re-seeding **cannot** converge them | #789 / #792 — measured `seed 419 placements / database 449 / **30 ORPHAN**`. The orphans were live config, not dead data. `rsi-overbought` accounted for **28** of them: a `directionBias: 'bearish'`, 140-point directive left present in 28 `LONG_ONLY` protocols, where the direction rule excludes it from **both numerator and denominator** — so it did not read as a zero, it silently lowered the **reachable ceiling** by **3,920 points**. Compounding defect: the seed endpoint reports `entries: N`, which counts rows **UPSERTED**, not rows that **EXIST** — so the diagnostic *reads exactly like a successful removal*. This is the class that build gates CANNOT catch: `tsc`, eslint and the contract validators all passed while the live system was unchanged | probe (`contract-probe.cjs` → `INV-SEED-DB-CONSISTENT`) + `scripts/diff-seed-vs-db.cjs` (full per-group comparison) |
| `INV-TRADEABLE-ROUTE` | A symbol offered for trade resolves to a broker that will **accept** it — `tradeMode === 4` (MT5 `SYMBOL_TRADE_MODE_FULL`) and a size at or above that broker's `volumeMin`. **Listed ≠ tradeable.** `symbol_route` chooses the broker, and an ABSENT route silently falls back to the primary broker, which is indistinguishable from a deliberate choice at the call site | **#US500 (2026-09-15).** US500 had **no `symbol_route` row at all**, so its orders (and its feed) fell back to the primary broker, MetaQuotes `:5000` — which reports US500 as `tradeMode 0` (trading DISABLED), while Pepperstone `:5001` reports `4` under `Retail\Indices\Majors\US500`. The Signals card showed the setup as fully actionable because every gate asked only whether the symbol was **LISTED**, and the bridge's refusal — *"US500 not tradeable (trade mode: 0)"* — surfaced only AFTER the click. **Second fault, same class, same symbol:** `volumeMin` is **0.1 lots on BOTH bridges** while the manual-trade default size is **0.01**, so a route-only fix simply moves the refusal one gate along. `tradeMode` is a property of **broker × symbol**, never of the symbol alone — the same ticker is listed on both bridges and tradeable on one | canary (`symbol-not-tradeable` + `getSymbolTradability`) + probe (live: a symbol whose routed broker refuses it while another broker accepts it) |
| `INV-ARCH-DOCS-1` | The architecture has **ONE section index**. `src/core/architecture-reference.js` (the AI-readable map) and `src/pages/architecture-framework.data.js` (the human-facing page) must list the **SAME section names** — neither may gain a section the other lacks | **batch #16** — a section was added to one surface and not the other, and it was caught by a **human, one batch late**. The two files are hand-maintained mirrors of the same index, so they drift silently: each reads correctly on its own and nothing reports a difference | `scripts/validate-architecture-docs.cjs` (pure `checkSectionParity`, driven in BOTH directions by `--self-test`) + canary |
| `INV-ARCH-DOCS-2` | Every `export const NAME` in `architecture-reference.js` must have a counterpart on the page. **One-way** (reference → page) | same batch — the reference is what agents read, so an export with no page counterpart lets an agent "see" a capability the owner **cannot**. The one-way direction is deliberate: page-only exports are permitted (the page carries framing the reference does not), so asserting parity here would fire constantly and get allowlisted | `scripts/validate-architecture-docs.cjs` (pure `checkReferenceIsDerived`, `--self-test`) + canary |

---

## The four-page mirror

Wiring is mirrored in four places, and **the QA checklist is machine-checked** — this is
what turns the mirror from a convention into a contract:

| Page | Route | Mirror (what belongs there) |
|---|---|---|
| Architecture | `/builder/architecture-framework` | boundaries + data-flow changes (`src/pages/architecture-framework.data.js`) |
| Capability Map | `/status/capability-map` | new/changed capability rows |
| **QA Checklist** | `/development/qa-testing` | **a testable procedure per invariant** (`src/data/qa-checklist.js`, entry field `invariant: 'INV-…'`) — **required, build fails otherwise** |
| Diagrams | `/lab/diagrams` | flow diagrams when the shape of the pipeline changes (`DiagramsPage.jsx`) |

The validator **fails** if an invariant has no QA entry, and prints a coverage summary for
the other three pages so gaps are visible without blocking work. Rationale: the QA page is
the only one of the four that can express a *procedure* ("do this, expect that"), so it is
the one worth gating on. The others describe, and descriptions cannot fail.

---

## Changing a contract

1. **Find the plan.** A substrate change belongs to a phase/epic — check the phases on
   GitHub and the roadmap before inventing a new mechanism
   (`development-status.instructions.md` holds the full scope rule).
2. **Change the canonical mechanism**, not a copy. If the mechanism is unreachable
   (private function, wrong module), *promote it* — an unreachable helper is what causes
   duplication in the first place (that is literally how #751 happened: `selectBaseTimeframe`
   was module-private).
3. **Update the invariant row**, its guard, and its QA entry in the same change.
4. **Delete the superseded path.** No dual paths, no feature flag.
5. **Write a handoff** so the Librarian mirrors it in the four pages.

---

## The silent-empty rule — read this before adding a list, mapping, or resolver

**Four separate incidents in this codebase share one shape.** Each was a value produced by one
module and consumed by another, with nothing asserting the two still agreed. Both halves looked
individually correct, so nothing flagged, and every one presented as **an empty result** — which
is indistinguishable from a correct result that happens to be empty, and therefore produces no
error, no warning, and no row.

| Incident | Producer ↔ consumer that were never compared |
|---|---|
| `INV-STABLE-DENOMINATOR` (#758) | configured directional capacity ↔ the denominator actually used |
| `INV-MTF-BUNDLE` (#735) | timeframes a directive *declares* ↔ the bundle a caller *supplies* |
| `INV-CADENCE-COVERAGE` (#758) | cadences a protocol *resolves to* ↔ cadences actually *fetched* |
| `INV-PROVIDER-REACHABLE` (#760) | symbols *assigned* to protocols ↔ symbols a provider *delivers* |
| `INV-NO-SYMBOL-GUESSING` (#764) | symbols a protocol *declares* by FK ↔ symbols *inferred* from its slug text |
| `INV-WATCHLIST-IDENTITY` (#763) | the watchlist a protocol *asks for by name* ↔ the one it *reads by FK* |

**The rule:**

> When a value is produced by one module and consumed by another, something must assert the two
> still agree. A list that is only ever **written** will drift from the list that is **read** —
> and an empty result hides the drift, because empty is a legitimate state.

**How to apply it.** When you add or change any list, mapping, or resolver, ask: *who reads this,
and does anything check that what I produce is what they expect?* If not, add the assertion —
a canary, a scan, or a live probe — **in the same change**. Specifically:

- **A produced list** (cadences, providers, symbols, bar counts) needs a check that its consumers
  can still resolve every entry they ask for.
- **A consumed list** needs a check that the producer still emits what it needs.
- **Prefer failing loudly over defaulting silently.** A `?? 200` default, a `catch { return [] }`,
  and an empty array are the exact mechanisms that hide this class of fault. Where a default is
  genuinely correct, name it in a comment so the next reader can tell a decision from an accident.

**Why this is a rule and not four fixes:** each incident cost hours of investigation, and the
mechanism was identical every time. Recognising the shape is what makes it findable — the symptom
is never "the data is wrong", it is **"nothing happened, and nothing said why."**

---

## Banned patterns (all detected at build time)
| Pattern | Why | Instead |
|---|---|---|
| `prisma.marketBar.findMany(...)` in a scoring/decision path | loses the timeframe filter, gets the order wrong, silently | `marketData.getBars(symbolId, cadence, count)` |
| `orderBy: { timestamp: 'asc' }, take: N` over bars | returns the **oldest** N, not the newest | `desc` + `take`, then `.reverse()` |
| `Math.min(score, 100)` | destroys the protocol weighting system | keep the magnitude; direction lives in `signalClass` |
| Removing the clock-offset conversion in the bridge | every timestamp shifts ~3h | keep `utc_iso()` subtracting the measured offset |
