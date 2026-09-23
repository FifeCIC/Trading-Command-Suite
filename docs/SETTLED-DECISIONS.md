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
| 15 | **Bot `mode` is the only dispatch authority** | `trading_strategy.mode` decides dispatch; `metastack_snapshot.mode` carries the scoring STYLE and must never be read as a trading mode. The #929 fix flips A/B from intent-only to real dispatch — ships as its own change under owner visibility | #929 | 🔴 UNGUARDED |
| 16 | **The exposure breaker measures what the gate measures** | Open-position count (`positionCount` on the payload; `totalExposure` REMOVED from it — the count no longer shares a name with the weekend checklist's notional). Fires at `> cap` — **EXCLUSIVE, corrected 2026-09-23 after reading the implementation**: at-cap is the normal full-book state and a permanently-tripped breaker is #950's alarm-fatigue class; the trigger means "cap BREACHED". `> 80` against a cap of 5 could never fire — decoration, not protection. Notional re-design is NOT settled (couples to #943) | #852 | 🟡 boundary spec **canaried both directions** (fails when flipped to `>=`); live-endpoint demo pending a buildable tree |
| 17 | **A score is never rendered without its protocol label** | SymbolPage: one score card **per assigned protocol** (from `/api/symbols/:ticker/protocols`); AutomationDashboard: protocol travels with the run/row data; ActivityLogs: protocol **as recorded on the row**. A silent default protocol is REJECTED | #925 | 🔴 UNGUARDED |
| 18 | **Bot 'Hourly Triple-Directive Control' SUBSCRIBES to `hourly-3dir-v1`** | Applied via seeder + correct `role` + round-trip proof; `create()` should create-or-refuse (class fix, still open). ⚠️ Implementation deferred — seed files mid-edit by another agent (#833) | #874 | 🔴 UNGUARDED |
| 19 | **`global_setting` is seeded with CURRENT values** | Persistence, not re-sizing. First run = dry-run with `changes` read before writing. Per-instrument sizing stays a maths change (#943) | #836 | 🔴 UNGUARDED |
| 20 | **Long-only stays where genuinely long-biased — recorded per protocol** | Each of the 16 LONG_ONLY protocols tagged "by design" (with rationale) or "oversight" (a finding). SHORT path proven by ONE controlled experiment bot — not a bulk flip | #765 | 🔴 UNGUARDED |
| 21 | **Guardian early-exit is maths — an A/B copy required** | Stop guardian tightening (#927) is the suspect mechanism; its effect on winners (0.448 realised vs 1.0–2.0 configured) is NOT an intended outcome. Mechanism must be isolated first; the policy change ships as a copied configuration with a falsification test (#944) | #916 | 🔴 UNGUARDED |
| 22 | **Licensing enforcement is DEFERRED until launch** | "Polite gating, not a security boundary" is the stated position; revisit when a priced tier + distribution exist (commercial decisions first) | #809 | 🟡 stated on the licensing surface; no code guard (none is possible pre-pricing) |
| 23 | **"A/B" names SIX different things — disambiguated. Only the snapshot trial needs two live positions** | The distinct instruments: **(1) UI variant** (`ABSwitcher`, `?variant=A`, ProtocolsPage A/B) — which *page design* is better; **(2) Protocol comparison** (`/lab/ab-testing` #373, `ChartComparisonPage`) — how two protocols READ the same market, signal agreement/divergence, no money; **(3) Strategy variant pair** (`/trading/ab-strategies`, `AbLadderPage`) — two bots on the SAME symbol differing in one field, compared on realised P&L (the owner's own model); **(4) Snapshot trial** (`ab_test` + `dispatchSideTrade`, #482/#929) — the ONLY instrument requiring two simultaneous live positions; **(5) Lineage** (`trading_strategy.duplicatedFromId` — **0 rows**, never used; `protocol.derivedFrom` — 7) — a parent/child record, produces no measurement; **(6) Labels, not testing at all** (`Tier A/B`, "#638 Phases A/B/C"). ⚠️ **Also: the word "strategy" carries two meanings** — row 12 says a strategy IS a bot's whole configuration, while the META.Stack plan uses "strategy" at plan level. A/B inherits the ambiguity twice over. ⚠️ **Measured 2026-09-23:** MT5 **nets**, so (4) cannot produce a result, and (3) cannot separate two PARALLEL same-symbol bots — same-symbol being a *requirement* of (3). **Netting breaks the EXIT, not the entry**: both side orders got their own `trade` row, but the position that closed was the merged one (vol 0.04 = bot 0.02 + A 0.01 + B 0.01), so both went `exit-unknown` with `pnl = NULL`. An independent outcome can come from (a) one side live at a time, (b) separate accounts, or (c) scoring both sides against stored bars — (c) being what `PROTOCOL-THEORY.md` already describes ("score them side-by-side with v1, and activate only the winner"). ⚠️ **"Hedging account" was offered as the fix and is RETRACTED** — MT5 hedging is an account TYPE (position accounting), unrelated to long/short strategy; conflating the two is itself an instance of this row's problem | owner question 2026-09-23 ("is it possible different notions of A/B testing have merged?") | 🔴 **UNGUARDED** |

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

---

## Related

- `scripts/detect-circular-work.cjs` — flags re-opened areas
- `scripts/diff-seed-vs-db.cjs` — seed vs DB drift
- `scripts/validate-directive-group-kind.cjs` — INV-GATE-MEMBERSHIP guard
- `.github/instructions/meta-stack-contracts.instructions.md` — invariants that ARE enforced
- `.github/instructions/development-status.instructions.md` — pre-release policy
- `…\Trading-Command-Suite-Documentation\handoff\` — per-change handoffs, dated (central store, not the repo)
