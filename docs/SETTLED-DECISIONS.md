# SETTLED-DECISIONS — read before re-opening an area

> **Created 2026-09-11.** This file exists because of a specific, measured problem the project
> owner raised: *"I'm struggling to understand why there's so many issues despite AI looking
> over and working on these areas many times over."*

---

## Why this file exists (read this part)

The question was investigated on **2026-09-11** and the answer was uncomfortable: **most of the
churn is not new bugs — it is old decisions being re-opened without anyone being told they were
already settled.**

Hard evidence, from GitHub issue history:

| Area | First settled | Re-opened | Gap |
|---|---|---|---|
| **Gate vs score separation** | **#638** — closed 2026-08-16, checklist asserts *"flat constants removed"* | **#789 / #790** — 2026-09-11 | **26 days** |
| Signal denominator | #758 — fixed, then **fixed again** (first fix still read a runtime value) | #761 — still open | 1 day |
| Classification thresholds | #638 removed the constants | #761 asks to recalibrate them | 26 days |

And the mechanism that made it silent:

> **#638 was closed on INTENT, not on ENFORCEMENT.** Its pre-close checklist ticked
> *"flat constants removed"*. `ENTRY_THRESHOLD = 40` is **still live** in
> `protocol-gating.service.ts` today (L324), with a code comment beside it recording that this
> exact constant already caused an incident on 2026-08-12. The box was ticked; nothing enforced it.

**A checklist box is a claim. A build-time guard is a fact.** That distinction is the whole point
of this file.

---

## The three loop-generators (each makes the next worse)

### 1. An issue is closed on intent, not on enforcement

An agent does the work, verifies it by reading the diff, ticks the boxes, and closes. Nothing
prevents the next change from undoing it, and nothing re-checks it later. The decision lives in a
closed issue body that no future agent reads.

**Countermeasure:** every settled decision below names either (a) a build-time guard, or
(b) explicitly says **UNGUARDED**. An unguarded decision is one that WILL be re-opened.

### 2. A fix in the seed file is not a fix in the database

`ProtocolDbService.seedProtocolsToDatabase()` is **upsert-only** — it creates and updates but
**never deletes**. Therefore:

- removing a directive from the seed does **not** remove its DB row
- moving one between groups does **not** move its DB row
- **re-seeding cannot converge them**

The diagnostic lies: the seed endpoint returns `entries: N`, which counts rows **upserted**, not
rows that **exist**. It reads exactly like a successful removal.

**Measured 2026-09-11** (`scripts/diff-seed-vs-db.cjs`, before the fix):

```
seed     : 47 protocols, 419 placements
database : 45 protocols, 449 placements
ORPHAN   : 30 rows — live config that the seed no longer contains
```

`rsi-overbought` accounted for **28** of them: removed from the seed for `LONG_ONLY` protocols,
still live in 30. Because it is `directionBias: 'bearish'` and those protocols are `LONG_ONLY`,
it was excluded from **both** numerator and denominator — so it did not read as a zero, it
silently lowered the **reachable ceiling** of 28 protocols by 140 points each (**3,920 points**).
That is issue **#792**, and the orphans were the mechanism that made it live.

**Countermeasure:** `scripts/diff-seed-vs-db.cjs` (run it after ANY seed edit). Explicit SQL for
removals — the seeder has no delete path.

### 3. Nothing recorded which areas were settled

The contracts doc lists invariants that **are** guarded. There was no companion list of decisions
that are settled but **NOT yet enforceable** — which is exactly the set that gets re-opened.

**Countermeasure:** this file, plus `scripts/detect-circular-work.cjs`.

---

## Settled decisions — consult before changing the area

**Legend:** 🟢 enforced by a build guard · 🟡 partially guarded · 🔴 **UNGUARDED — will be re-opened**

| # | Decision | What it means | Settled | Guard status |
|---|---|---|---|---|
| 1 | **A directive `score` is a MAGNITUDE**, not a percentage. Direction lives in `signalClass` | Never `Math.min(score, 100)`. `maxScore` expresses weight; the protocol total is the sum of `maxScore`s | ADR-010 | 🟢 `no-score-clamp` scan |
| 2 | **ONE stable, config-derived denominator** = `configuredSignalMax` | Percentage = earned ÷ **configured** capacity. Never divide by an observed sum (it shrinks when a directive goes quiet, so the same conditions score differently each tick) | ADR-011, #758 (fixed twice) | 🟢 `no-observed-denominator` scan + `INV-STABLE-DENOMINATOR` canary |
| 3 | **Direction eligibility comes from CONFIG, not the tick** | So the denominator is identical across symbols in the same tick | ADR-012 | 🟢 `INV-STABLE-DENOMINATOR` |
| 4 | **A risk gate may contain only `category: 'structural'` directives** | A directional voter in a gate is **erased, not downgraded** — no score, no direction, no capacity, and nothing reports it | **#638 (2026-08-16)** then **INV-GATE-MEMBERSHIP (2026-09-11)** | 🟢 `validate-directive-group-kind.cjs` |
| 5 | **Gate capacity is excluded from the denominator** | `if (!isGateGroup) capacityMax += maxScore` — a gate expresses a hurdle, not conviction | #758 | 🟢 `INV-STABLE-DENOMINATOR` |
| 6 | **Absence of evidence must never become a number or a veto** | An unmeasurable directive returns `score: 0` **with `unmeasured: true`**. It contributes nothing and can never trip a gate | #766 / #755 | 🟢 `no-fabricated-baseline` scan + 2 specs proven to fail without the guard |
| 7 | **Group weights are NOT applied in assembly** | Aspirational until #718. Do not assume weights affect the composite | ADR-013 | 🔴 **UNGUARDED** |
| 8 | **Re-seeding is ADDITIVE-ONLY** | Any removal/move needs explicit SQL. `entries: N` is not proof of a removal | #789 (2026-09-11) | 🟡 `diff-seed-vs-db.cjs` (manual run, not gated) |
| 9 | **`!isGateGroup` alone is correct for capacity — do NOT add a `directionBias` test** | Tried and **reverted** 2026-09-10: declared bias massively understates what directives emit (e.g. `macd-crossover` declares `neutral`, fired directionally 5,252×). Gating on declaration excludes the directives doing the real work | #761 comment, ADR-011 | 🟢 `directional-capacity-contract.spec.ts` (5 tests; **proven to fail** when the reverted bug is reintroduced — 2 tests fail) |
| 10 | **Classification thresholds must not be recalibrated while the denominator is moving** | Bands (#761's 80/40) were invalidated by the #758 denominator change. Recalibrating before freezing the denominator is the loop | #761 (OPEN) | 🔴 **UNGUARDED — actively contested.** No guard is possible until the denominator is frozen and measured |
| 11 | **A bar gap after a bridge restart is EXPECTED during development — it is not a defect. It also self-heals.** | `BarRefreshService` re-fetches **by count** (200 bars ≈ **16.7h** at `5m`, 3.3h at `1m`), so a normal re-fetch reaches back **past** any plausible development gap and refills it. Nothing needs to be built to obtain the data. A gap is only unrecoverable if it **exceeds the fetch window**, or if a symbol stops being refreshed entirely | #795 (filed `priority-high`, **closed as NOT-A-BUG** 2026-09-11) | 🟡 `INV-BAR-ORDER` in `contract-probe.cjs` now **distinguishes** a data gap (passes, reports) from a scoring bug (fails) |
| 12 | **A strategy IS a bot's whole configuration** — protocol + role + **market** + broker + execution policy. Any difference at all makes a different strategy; two byte-identical bots are a **DUPLICATE (a defect), not a merge** | Identity is `strategyKey = sha256(protocolId \| role \| symbol \| brokerId \| canonicalTreatment)`, 16 hex. `symbol` and `sessionWindow` are **in** the key: excluding `symbol` collapsed **26 strategies to 18**, and omitting `sessionWindow` gave **15**. Both were real errors by real agents, both are recorded in the guard. Canonicalisation is **behavioural, not textual** — `1` and `1.0`, bare `london` vs `["london"]`, and alias `sydney`→`asian` must all hash identically | `docs/trading-bot-model.md` **§1c / §1d**, owner-confirmed **2026-09-18**; #876 (derivation) / #875 (naming) | 🟡 `nest/scripts/verify-strategy-derivation.ts` — drives the **REAL** service against the **REAL** database and asserts the canonicalisation rules (24 pass). **Manual, not gated** — it needs a live DB and `ts-node`, which `prebuild` does not have, so this is by design and **not** an oversight. ⚠️ Its fixture counts are **dated**: measured **27** strategies on 2026-09-22 against the fixture's **26**; every invariant holds, so the movement is a bot being added, not an identity regression. The guard's own rule is *"if they move, that is a finding, not a test to update"* |

---

## Settled 2026-09-23 — decision pass (agent, under delegated autonomy; owner ratification pending)

> Recorded as issue comments on the day (owner unavailable; "work autonomously and make good
> decisions"). The owner may reverse any row in review — none imply anything irreversible.
> **All rows are 🔴 UNGUARDED until their guards ship** — that is the point of listing them:
> an unguarded decision is one that WILL be re-opened.

| # | Decision | What it means | Settled | Guard status |
|---|---|---|---|---|
| 13 | **The manual trade path runs the SAME risk gate as bots** | `placeManualTrade()` must call `assessGlobalRiskLimits()` before `broker.placeOrder()`; refusal = `TCS-RISK-*` notice naming cap + number. Sub-decisions: notional + margin shown in account currency **before the click**; `assessBookAtRisk()` evaluates **existing + incoming**. The margin-vs-risk arithmetic (§3) is explicitly NOT settled here | **#945** | 🔴 **UNGUARDED** — guard ships with fix: any path reaching `broker.placeOrder()` must route through the gate |
| 14 | **Manual positions count against the same cap — explicitly, never silently** | The block reason and UI show slot holders split by origin; cap scope stays global; the VALUE is #943's business (maths → A/B) | #773 | 🔴 UNGUARDED |
| 15 | **Bot `mode` is the only dispatch authority** | `trading_strategy.mode` decides dispatch; `metastack_snapshot.mode` carries the scoring STYLE and must never be read as a trading mode. The #929 fix flips A/B from intent-only to real dispatch — shipped 2026-09-23 as its own change under owner visibility | #929 | 🟢 `nest/scripts/validate-ab-inputs.cjs` **rule 1** (prebuild). Canaried 2026-09-23: planting `controlCfg.mode` failed the guard; restored byte-for-byte. Also covered by 12 spec tests canaried the same way (reinstating the snapshot read failed 6 of 16 with exactly `Expected: "auto", Received: "score"`) |
| 16 | **The exposure breaker measures what the gate measures** | Open-position count (`positionCount` on the payload; `totalExposure` REMOVED from it — the count no longer shares a name with the weekend checklist's notional). Fires at `> cap` — **EXCLUSIVE, corrected 2026-09-23 after reading the implementation**: at-cap is the normal full-book state and a permanently-tripped breaker is #950's alarm-fatigue class; the trigger means "cap BREACHED". `> 80` against a cap of 5 could never fire — decoration, not protection. Notional re-design is NOT settled (couples to #943) | #852 | 🟡 boundary spec **canaried both directions** (fails when flipped to `>=`); live-endpoint demo pending a buildable tree |
| 17 | **A score is never rendered without its protocol label** | SymbolPage: one score card **per assigned protocol** — protocols resolved via `GET /api/symbols/:ticker/focus` (⚠️ NOT `/protocols`, which is dead — see #926); AutomationDashboard: protocol travels with the run/row data; ActivityLogs: protocol **as recorded on the row**. A silent default protocol is REJECTED. The shared resolver is `src/core/hooks/useSymbolEnvelope.js` | #925 | 🟡 `scripts/validate-envelope-callers.cjs` in `prebuild` — any new caller of `/api/signals/envelope/` without a protocol FAILS the build (self-tested both directions); three pages verified 2026-09-23 (two live in-browser, one API-sequence + clean load) |
| 18 | **Bot 'Hourly Triple-Directive Control' SUBSCRIBES to `hourly-3dir-v1` — PROVEN by round-trip 2026-09-23 (#874 closed)** | DELETE the row → re-seed → `subscriptionsRepaired: 1` recreates it identically (`role: long`). The seeder repairs missing subscriptions for ANY seeded bot, so "a bot with no subscription" is no longer a survivable state after a seed run; `?dryRun=true` previews repairs. The bot's cannot-trade property is `active: 0` + `mode: manual` (audit: `INACTIVE — nothing blocking`), NOT a missing subscription. ⚠️ The seed comment claiming "NO subscription is intended" contradicts the repair (flagged on AGENT-ATTENTION for the in-flight seed work). `create()` still neither subscribes nor refuses — named gap | #874 | 🟡 seeder self-repairs + dry-run previews; `audit-bot-activation.cjs` classifies per bot; no prebuild gate possible (DB condition) — stated, not silent |
| 19 | **`global_setting` is seeded with CURRENT values** | Persistence, not re-sizing. First run = dry-run with `changes` read before writing. Per-instrument sizing stays a maths change (#943) | #836 | 🔴 UNGUARDED |
| 20 | **Long-only stays where genuinely long-biased — recorded per protocol** | Each of the 16 LONG_ONLY protocols tagged "by design" (with rationale) or "oversight" (a finding). SHORT path proven by ONE controlled experiment bot — not a bulk flip | #765 | 🔴 UNGUARDED |
| 21 | **Guardian early-exit is maths — an A/B copy required** | Stop guardian tightening (#927) is the suspect mechanism; its effect on winners (0.448 realised vs 1.0–2.0 configured) is NOT an intended outcome. Mechanism must be isolated first; the policy change ships as a copied configuration with a falsification test (#944) | #916 | 🔴 UNGUARDED |
| 22 | **Licensing enforcement is DEFERRED until launch** | "Polite gating, not a security boundary" is the stated position; revisit when a priced tier + distribution exist (commercial decisions first) | #809 | 🟡 stated on the licensing surface; no code guard (none is possible pre-pricing) |
| 23 | **"A/B" names SIX different things — disambiguated. Only the snapshot trial needs two live positions** | The distinct instruments: **(1) UI variant** (`VariantSwitcher`, `?variant=A`) — which *page design* is better; **(2) Protocol comparison** (`/lab/ab-testing` #373, `ChartComparisonPage`) — how two protocols READ the same market, signal agreement/divergence, no money; **(3) Strategy variant pair** (`/trading/ab-strategies`, `AbLadderPage`) — two bots on the SAME symbol differing in one field, compared on realised P&L (the owner's own model); **(4) Snapshot trial** (`ab_test` + `dispatchSideTrade`, #482/#929) — the ONLY instrument requiring two simultaneous live positions; **(5) Lineage** (`trading_strategy.duplicatedFromId` — **0 rows**, never used; `protocol.derivedFrom` — 7) — a parent/child record, produces no measurement; **(6) Labels, not testing at all** (`Tier A/B`, "#638 Phases A/B/C"). ⚠️ **Also: the word "strategy" carries two meanings** — row 12 says a strategy IS a bot's whole configuration, while the META.Stack plan uses "strategy" at plan level. A/B inherits the ambiguity twice over. ⚠️ **Measured 2026-09-23:** MT5 **nets**, so (4) cannot produce a result, and (3) cannot separate two PARALLEL same-symbol bots — same-symbol being a *requirement* of (3). **Netting breaks the EXIT, not the entry**: both side orders got their own `trade` row, but the position that closed was the merged one (vol 0.04 = bot 0.02 + A 0.01 + B 0.01), so both went `exit-unknown` with `pnl = NULL`. ⚠️ **The (a)/(b)/(c) menu that stood here is REMOVED.** Owner, 2026-09-23: *"We aren't doing a/b/c so any mention of that needs ended — it's too complex."* **What is settled instead:** the outcome is **manually reviewed PROFIT over a configurable window**, with an OPTIONAL automatic rule as a later layer (owner's example: *"if after 3 months B is profiting by 10% more than we trash A"*). ⚠️ **"Hedging account" was also offered as a fix and is RETRACTED** — MT5 hedging is an account TYPE (position accounting), unrelated to long/short strategy; conflating the two is itself an instance of this row's problem. ⚠️ **THE COLLISION IS THE COMMON CASE, NOT THE EDGE CASE** — owner, 2026-09-23: *"most A/B protocols will score similar at least if the changes are minor, which means two signals for trading at the same time."* A/B exists to test a MINOR change, so the two sides usually signal together and merge into one position almost every time. **The live pair (row 25) is therefore a LOCK, not a measuring instrument** — see row 26 for where the measurement went | owner question 2026-09-23 ("is it possible different notions of A/B testing have merged?") | 🔴 **UNGUARDED** |
| 24 | **The vocabulary — three words, one meaning each** | **Snapshot** = a frozen, versioned, fingerprinted copy of a scoring config (`metastack_snapshot`: payload + fingerprint + change log). **An ANALYSIS artefact** — for version comparison and config-drift detection. It is not a test and it does not trade. **A/B** = a **LOCKED PAIR** (row 25) — two protocols, or two bots, active together over one period, differing in ONE declared field, compared on outcomes. Nothing else is "A/B". **Design variant (Old / New)** = two renderings of one page; presentation only (`VariantSwitcher`, param `?variant=A`). ⚠️ The `ab_test` table + `AbTestService` + the `TCS AB-A` / `TCS AB-B` broker tags are the **snapshot TRIAL** — the one instrument that ran two simultaneous live positions. It is **reframed OUT of "A/B"** and its structural rename is scoped separately: **87 references across 30 files**, and they are **two different things** — `/lab/ab-testing` is the protocol-comparison page, `ab_test` is the snapshot trial — so a blind rename would conflate them further. ~22 references are historical docs/changelog that must **not** be rewritten | owner direction 2026-09-23 → **#962** | 🔴 **UNGUARDED** — rename not yet done |
| 25 | **An A/B pair is LOCKED — this is the definition, not a nicety** | Owner, 2026-09-23: *"protocols will have A/B testing in a way that locks both protocols to ensure that activity matches"* — **and the same for strategies.** A comparison is valid only if: **(1)** both sides are registered as a pair with a direction (which one is the incumbent); **(2)** both are `active = 1` for the whole comparison; **(3)** the SAME symbol set — the symbol is the constant, never the variable; **(4)** exactly ONE declared difference, named at registration; **(5)** activate/deactivate **together** — a lifecycle change applies to both sides; **(6)** neither side's config is edited while running, and the falsification test (#944) is recorded **before** it starts; **(7)** neither side is deleted until the comparison reports. Substrate that already exists: `trading_strategy.duplicatedFromId` (**0 rows** — but the copy path `TradingStrategyService.duplicate()` **DOES** set it, preserves both lineage links, inherits the symbol exactly and gives the copy a working subscription; **0 rows means nobody has ever run a copy, not that the code is missing**), `protocol.derivedFrom` (**7 protocols**), and `/trading/ab-strategies`, which already compares realised P&L per side (#894) with `—` never `0`. **The genuine gap is the LIFECYCLE — activate/deactivate together, and refusing an edit mid-comparison** | owner direction 2026-09-23 → **#963** | 🟡 **Enforced at RUNTIME, not by a build guard.** `startPair()` activates both sides in ONE InnoDB transaction and registers `ab_pair.state='running'`; while running, `update()` **REFUSES any behavioural field on either side** ("behavioural" taken from the canonical `BOT_RULES` minus `NON_BEHAVIOURAL_COLUMNS`, so a field added later is covered automatically); `stopPair()` deactivates both. 23 specs in `trading-strategy-pair.spec.ts`; the GROUP guard and the freeze guard were each canaried. ⚠️ No build-time gate exists, so a future second write path to `trading_strategy` could bypass it |
| 26 | **A/B is MEASURED by BACKTEST, not by the live pair** | Owner, 2026-09-23: *"running strategies in a way that still tells us which is marginally better, without having to wait or them colliding because their trades won't be real, just calculated."* In a backtest there is **no broker**, so there is no merging, no collision and no "who owns the closing" — both sides are scored over the **identical** bars, which is fairer than any live test, and in minutes rather than three months. The live pair (row 25) keeps its LOCK and becomes the **final confirmation step**, not the instrument. Measured 2026-09-23: `/api/backtest` is real and populated — **11 runs / 391 persisted trades**, with `optimize`, `walk-forward`, `benchmark`, `runs/compare` and a UI at `/education/backtest`. ⚠️ **But the comparison NAMES A WINNER ON 3 TRADES** — `best: {metric: sharpeRatio, value: 42.31}` on a 3-trade sample, with **no minimum-sample bar**. That is the very defect `AB_MIN_TRADES_FOR_VERDICT` was added for in the snapshot trial ("noise wearing a result's clothes"), and it is the FIRST thing to fix before any backtest verdict is trusted. ⚠️ Also measured: `compare` disagrees with the run result (`netPnl −0.0009` vs `totalPnl 0`; `maxTradeDrawdown −0.0003` vs `maxDrawdown 27`). ⚠️ `BacktestRunRequest` takes a `protocolId` — there is **no bot id and no pair id**, so "backtest a strategy" and "backtest a pair" are not yet expressible. ⚠️ Work belongs to **#816** (existing sprint epic) and **#823** (workstream), with the replay view in **#819** and indicator rendering in **#606** — **NOT a new sprint** | owner question + direction 2026-09-23 | 🔴 **UNGUARDED** — a backtest verdict can be issued on 1 trade |

| 30 | **A drawdown percentage is stated only when the arithmetic is possible** *(renumbered from a duplicate “26” on 2026-09-24 — `validate-decisions.cjs` found two rows sharing the number)* | `computeDrawdownDetail` (now `common/trading/drawdown.ts` — ONE definition, shared with bot-performance; #954 consolidated two disagreeing copies): `pctOfPeak` is `null` when `peak <= 0` **or when `currency > peak`** — a ratio above 100% means the denominator is not a capital base (measured live 1,566–2,050% on four ordinary shapes). Baseline is **0**, not the first cumulative value. The warning text distinguishes the two null causes. Live: breaker TRIPPED(1,611.5%) → READY, ratio null, currency 61.18 still stated | #954 | 🟡 canary `drawdown.spec.ts` proven both directions (suite fails when the bound is removed); boundary inclusive at exactly 100% |

| 27 | **The manual trade path runs the SAME portfolio risk gate as bots** | `placeManualTrade()` calls `assessGlobalRiskLimits()` before `broker.placeOrder()`; refusal = `TCS-RISK-001` naming cap + number; durable alert written (never gating the refusal). Live-proved 2026-09-23: size 5 on XAGUSD → refused by the gate, broker never reached. NOT yet done, named in the close: notional+margin preview before click; portfolio-level incoming-order inclusion for `maxPortfolioRisk`; three exempt order paths (raw MT5 endpoint, speed-scan, A/B dispatch) remain ungated by decision of their owners | #945 | 🟡 `validate-manual-trade-gate.cjs` in `prebuild` — new `.placeOrder()` paths without the gate FAIL the build (exemptions printed); refusal + wiring canaried in `signal-actions.service.spec.ts` |

| 28 | **The rating's risk condition is an ABSOLUTE CURRENCY allowance per bot — and "not set" is a NAMED blocker, never a pass** | `trading_strategy.allocationAmount` (double, **account currency** — the same unit as `trade.pnl`; deliberately NO currency-code column, which would duplicate `fund_allocation.currency` and drift). It is the denominator for `realisedPct` and `maxDrawdownPct`; the drawdown limit is applied ONLY when it is positive, and the comparison is **EXCLUSIVE** (`> 25` fails, exactly 25 passes). With none set the rating is withheld as `allocation_not_set` — the two former blockers (`drawdown_unverifiable`, `no_allocation_basis`) are REMOVED, being one cause with one name. **Why currency and not a percentage — measured 2026-09-23:** no maintained account-capital base exists to divide by (`bridge_event.balance`: 71,156 rows, **0 populated**; `portfolio_snapshot_position`: empty; `fund_allocation`: **0 rows in its whole life**), and a percentage would need re-deriving whenever equity moved, with no writer to do it. Currency keeps both figures derivable, so nothing is lost. **Rejected:** B (currency adverse excursion — not comparable across bots with different allowances) and C (expectancy + samples only — contradicts #894's own "a drawdown condition is not optional") | owner, 2026-09-23: *"What do you recommend? I was thinking A based on the working of the Note"* → A agreed, **with the unit corrected to currency** | #894 | 🟡 `bot-rules.ts` declaration + `validate-bot-rules.cjs` in `prebuild` (a new column with NO declaration fails the build — observed: `columns=34 declared=30`); 36 specs including the exclusive boundary **canaried both directions** (flipping `>` to `>=` failed exactly the boundary test); seed convergence declares ONE bot only (dry-run: 1 change, 26 unchanged). ⚠️ NOT guarded: nothing compares `schema.prisma` against the generated Prisma client, so a column can exist in the DB **and** the schema and still be rejected at runtime (measured on this very change) |

| 29 | **An OBSERVATION is marked as one — the decision VALUE is the claim, not an empty column** | `decision_log.decision` now distinguishes what used to be one word: **`OBSERVED`** = the ladder scored this symbol and **NOTHING consumes the row** (no bot is subscribed, so nothing will ever trade it); **`SCORED`** = a bot scored a signal it may act on; **`BLOCKED`/`SKIP`** = a consumer existed and **refused**; **`QUEUED`/`EXECUTED`/`FAILED`** = the signal reached the order path. Before this the ladder wrote `'SCORED'` with `strategyId: ''`, so "nothing reads this" had to be **inferred from an empty column** — measured 2026-09-23: **706 no-bot rows today, 539 of 577 scored rows in the issue's own measurement**. ⚠️ **History is NOT rewritten**: `strategyId = ''` on a `SCORED` row IS the historical marker, and `src/core/decision-display.js` reads it as an observation — so the distinction is answerable for the whole table without touching log history. **One vocabulary, one palette, one reader** (`src/core/decision-display.js`): three pages had three private decision colour maps (Decision Trail, Symbol Focus, Execution Queue) and adding a marker meant editing three silent places | owner sprint #960 Tier 0 prerequisite → **#971** | 🟡 **Two-sided, canaried, and partly gated.** Backend: `automation-loop-decision-units.spec.ts` asserts an `OBSERVED` row has **NO** `strategyId` (writing a bot's row as OBSERVED would hide a real signal) and still declares its score unit — canaried **both** directions (`OBSERVED`→`SCORED` failed `Expected: >= 1`; a bot id on the observation row failed `Expected: true`), restored byte-for-byte. Frontend: `decision-display.test.js` asserts an observation and a signal differ in **label AND colour** (both directions) — canaried by giving OBSERVED the signal colour (`fail 1`). ⚠️ **The frontend test runs only via `npm run test:decision-display`; it is NOT in a prebuild gate**, so it is partial, not gated |

| 31 | **The primary agent is the arbiter, and every decision has THREE homes** | Owner direction 2026-09-24: the Max-thinking primary chat may **override any other agent** and decides freely, but a decision is not recorded until it is in **all three** of — (1) a `DECISION (date, agent)` comment at the code site, (2) a row **here**, (3) the issue. The point is **reversibility**: the owner reverses by reading, so a decision nobody can find is one nobody can undo. ⚠️ **#919 is the worked example of a TWO-home decision** — the work landed in `38147f1` citing the issue and the code was correct, but this register was never written and the issue stayed open three days, long enough to block sprint #924. The **Development area is confirmed as the EXPERIMENT SANDBOX**: an agent may build a competing approach there, but it must end in a decision, registered in `src/data/theories.js` with a **falsification test**, and with `evidence.basis` graded (`measurement` / `code-read` / `cited`) so a citation can never masquerade as a measurement | owner direction **2026-09-24** | 🟡 `scripts/validate-decisions.cjs` + `scripts/validate-theories.cjs` — both canaried (`--self-test`: 8 and 13 cases, every rule observed to fail) — ⚠️ but both are **ON DEMAND, not in `prebuild`**, stated rather than implied |

| 32 | **`'group-weighted'` KEEPS its historical name — the field is declared inert, not renamed** | Owner ruling 2026-09-24, answering review row **R17** with *"Keep"*. #919 asked to rename `'group-weighted'` → `'configured-capacity'` on the grounds that *"it selects a denominator"*. **It selects nothing:** `weightStrategy` is only echoed into the payload, and the denominator is hardcoded `'configured-capacity'` (`protocol-gating.service.ts` L1152). Measured — the composite is IDENTICAL for `'group-weighted'`, `'maxscore-weighted'` and a deliberately bogus value. **The rename was rejected as cosmetic**: it would have made the documentation read correctly while the control stayed dead, which is the defect #919's own item 4 names (*"a registry field that reads as a control and has no effect"*). ⚠️ Cost was measured BEFORE the ruling: **44 references across 17 files + 28 stored rows** (a rename without the DB update would silently rescore). The dead control is fixed by DECLARING it — the service doc states **IS INERT**, group weights read *· not applied* on 5 surfaces, and META.Stack Explorer reports the real `denominatorMode` instead of passing merely because the field exists | owner, 2026-09-24 (review **R17**) | 🟡 `nest/src/modules/scoring/weight-strategy-inert.spec.ts` (6 tests, canaried both directions) — ⚠️ **NOT** in `prebuild` |

| 33 | **Design observations have their OWN register, and every row must name what would make us RECONSIDER** | Owner answered review row **R21** on 2026-09-24 with *"new register"* — choosing a dedicated register over a second section of the review queue, and accepting that observations should be able to **accumulate BEFORE they become decisions**. Trigger: **#990**, where a finding (*"the mechanism that locks in profit had no surface on the bot page"*) landed in a **code comment** — durable, and invisible to the one person who reconsiders designs. ⚠️ The field that makes this a register rather than a grievance log is **`reconsiderIf`**, **required on every row** and the direct analogue of a theory's falsification test; without it an observation is a preference. `evidence.basis` is graded exactly as in `theories.js` (`measurement` / `code-read` / `cited`) so a citation can never pass as a measurement. **Not** a defect report (that is an issue) and **not** a decision (that is the review queue) — it is a design tension held open on purpose. Readable at `/development/design-observations` | owner, 2026-09-24 (review **R21**), **#990** | 🟡 `scripts/validate-design-observations.cjs` — canaried (`--self-test`: **8** rules each observed to fail on a broken copy, and the real register observed to pass) — ⚠️ **ON DEMAND, not in `prebuild`**, matching `validate-theories.cjs` |

---

## How to use this file

Before changing anything in a listed area, answer:

1. **Which row does this touch?**
2. **Am I fixing a bug, or re-deciding the approach?**
   - A **bug fix** implements a settled decision correctly → go ahead.
   - A **re-decision** changes it → **say so explicitly first** (issue or handoff), with what
     changed that invalidates the original reasoning. The original is in the `Settled` column.
3. **Is it 🔴 unguarded?** Then you are very likely to be re-opening it by accident. Read the
   original issue before writing code.

### ⚠️ Before filing an issue: is it actually a bug?

**Added 2026-09-11 after #795 was filed `priority-high` and closed as NOT-A-BUG the same session.**

Ask **"what is the cheapest piece of evidence that could falsify this?"** For #795 that was the
bridge log — one file read — and it showed a restart at `20:52`, three minutes before the gap. The
*pattern* (29 symbols, simultaneous) was real; the inference from it was wrong.

| Symptom | Ask FIRST | Expected during development |
|---|---|---|
| **Bar gap in the DB** | Did a bridge/API restart just happen? (`scripts/mt5-bridge/bridge-broker*.log`, last lines) | **YES** — and it **self-heals** on the next refresh (design decision **row 11**) |
| Bars stale / `asOf` behind | Do bars **exist** in the missing window? | If **no bars exist** → data gap, not a scoring bug (the probe now reports this separately) |
| Feed reading `closed` | Is the market actually closed? | **YES** — a market closure and an outage look identical |

**A guard that fails on an expected condition gets switched off, which is worse than no guard because
it looks like coverage.** That applies to *issues* as much as to code: an over-filed non-bug spends
human attention and teaches distrust of the reporting.

### The check that catches most loops

```
node scripts/detect-circular-work.cjs            # all watched areas
node scripts/detect-circular-work.cjs risk-gate  # one area
node scripts/diff-seed-vs-db.cjs                 # seed vs DB drift
```

If `detect-circular-work` shows an area with both CLOSED and OPEN issues, you are probably in case
(b) — a re-opening — and should cite the earlier decision rather than re-derive it.

---

## Open reconciliations (documented contradictions — do not implement against these)

| Contradiction | Where | Status |
|---|---|---|
| Checklist says "flat constants removed"; `ENTRY_THRESHOLD = 40` is live | #638 closure vs `protocol-gating.service.ts` L324 | Documented here 2026-09-11. The constant is percentage-based now (not the old absolute bug), so the *claim* was loose rather than false — but the checklist did not verify it |
| "Duplicate directive" warning means two opposite things | `ProtocolGatingService` L671 | Resolved in #789: real double-counting vs a valid copy shadowing a **dead** one. Only the group **kind** distinguishes them |
| `signals-workbench` is `active: 1` with **0 groups** | `protocol` table + `protocols-seed-data.ts` L2450 | **RESOLVED 2026-09-11 — NOT a defect.** It is a *workbench* protocol populated by `SignalEnvelopeService.persistScores()` (`score-history.service.ts` L54), not scored through the gated pipeline. The `ProtocolHealthService` "no risk-gate group" warning is therefore expected, not a fault. It has no groups **in the seed either** — seed and DB agree |
| `060ed261-…` protocol whose **slug is a UUID**, 0 groups | `protocol` + seed L2439 | **RESOLVED 2026-09-11 — abandoned placeholder.** A real protocol row ("Conviction Dip Accumulation", created 2026-07-26) that was never configured: `active: 0`, **0 groups in BOTH the seed and the DB**, and nothing references it. Seed and DB agree, so there is **no drift**. Left in place deliberately — deleting a `protocol` row is a data decision, and it is harmless (`active: 0`) |
| 34 | **Post-entry exit management is PER-BOT DATA** (R20 = A) | `GUARDIAN_RULES` + `StopGuardianService` + `trading_strategy.simTsl*` | 🟡 **PARTIAL** — the per-bot columns exist and the observer is guarded, but NOTHING acts on a decision point and no test fails if a bot is armed without effect |

---

## Related

- `scripts/detect-circular-work.cjs` — flags re-opened areas
- `scripts/diff-seed-vs-db.cjs` — seed vs DB drift
- `scripts/validate-directive-group-kind.cjs` — INV-GATE-MEMBERSHIP guard
- `.github/instructions/meta-stack-contracts.instructions.md` — invariants that ARE enforced
- `.github/instructions/development-status.instructions.md` — pre-release policy
- `…\Trading-Command-Suite-Documentation\handoff\` — per-change handoffs, dated (central store, not the repo)
