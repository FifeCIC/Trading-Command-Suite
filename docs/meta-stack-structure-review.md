---
description: "META.Stack engineering & architecture review — structure, naming, file concerns, and avoidable database work. Measured 2026-09-30 with scripts/analyse-query-patterns.cjs and validate-duplication.cjs."
---

# META.Stack — Engineering & Architecture Review

> **Owner request, 2026-09-30:** *"I want an engineering and architecture review of META.Stack from
> start to finish… renaming something that shares a similar name, addressing files that share too
> many different concerns and are large, and especially places in code where we can avoid additional
> database queries by checking for a loaded object already… I want to be sure that we have some sense
> in our app's file and code structure before we try to polish it into profit."*

**Method: everything below is measured, not eyeballed.** Findings carry the command that produced
them. Where I could not verify something, it says so.

---

## 1. The headline: the architecture is sound; the *naming and file seams* are not

The pipeline's **substrate** is genuinely well-governed — 20+ named invariants, each with a build gate
and a QA entry (`meta-stack-contracts.instructions.md`). That discipline is unusual and it is working.

What is *not* governed is the layer above it: **what things are called, where a file stops, and what a
name promises.** Those are the defects that make the code hard to work in, and none of them are caught
by any existing gate — because every one of them is *syntactically valid*.

| Dimension | Measured | Verdict |
|---|---|---|
| Pipeline invariants | 20+ IDs, each with a guard | 🟢 **Excellent** |
| Duplication discipline | tool-annotated deliberate vs not | 🟢 **Excellent** |
| Naming collisions | **25** exported names in ≥2 files | 🔴 **Needs work** |
| Dead / duplicated modules | **6** files unreachable | 🔴 **Needs work** |
| File size / mixed concerns | **2** files >2,400 lines; **3** controllers >800 | 🟠 **Needs work** |
| Avoidable DB queries | **137** N+1 sites / 41 files; **6** refetch; **22** redundant reads | 🟠 **Needs work** |

---

## 2. 🔴 Naming collisions — the highest-value fix, and the code already confesses to it

**The tell.** `nest/src/modules/automation/stop-guardian.service.ts:15`:

```ts
import { StopGuardianService as StopAdjustmentRecorder } from '../trading/stop-guardian.service';
```

**Two different classes, both named `StopGuardianService`, and one is aliased on import to dodge the
collision.** Somebody already knew this was wrong; they worked around it rather than fixing it. The
aliased name — `StopAdjustmentRecorder` — is the correct name and is already written down.

| # | Collision | Files | Why it costs |
|---|---|---|---|
| 1 | **`StopGuardianService`** | `automation/` (90 KB, the guardian) · `trading/` (7 KB, the recorder) | 🔴 One is aliased at import. A reader cannot tell which "stop guardian" a reference means |
| 2 | **`TimelineService` + `TimelineEvent` + `TimelineController`** | `automation/` (13 KB, wired) · `timeline/` (3 KB, wired) | 🔴 **Two live implementations of one concept** — ADR-014's exact prohibition |
| 3 | **`ScenariosModule` + `ScenariosService`** | `scenarios/scenario.*` (wired) · `scenarios/scenarios.*` (**dead**) | 🔴 Singular vs plural in one folder |
| 4 | **`MarketStatus`** | `calendar/market-calendar.service.ts` · `directives/market-status.ts` | 🟠 The contracts file names `market-status.ts` as *the* tradeability authority — two types share its name |
| 5 | **`MarketSession` / `SessionInfo`** | `calendar/` · `trading/` | 🟠 The contracts file already warns these are **three different axes** (#851) |
| 6 | **`ChaikinMoneyFlowDirective`** | `chaikin-money-flow.directive.ts` · `mt5-indicators.directives.ts` | 🟠 Which class registers the directive? |
| 7 | **`Mt5Account`** · **`BrokerPosition`** · **`TradeRecord`** · **`Recommendation`** · **`SwingPoint`** | 2 files each | 🟠 Two shapes, one name |
| 8 | **`FreshnessStatus` + `FreshnessResult`** | `freshness.service.ts` · `market-data.service.ts` | 🟠 **Both duplicated inside ONE module** |

**Evidence:** `node logs/z-review3.cjs` (exported-symbol scan) + `grep` for the aliasing tell.

**Recommendation — do #1 first.** It is a **pure rename** (`StopAdjustmentRecorder`), the correct name
already exists in the codebase, and it removes an import alias. Zero behaviour change, immediately
clearer. #2 and #3 need a decision about which implementation survives — **that is an owner call, not a
rename.**

---

## 3. 🔴 Dead and duplicated modules

| Finding | Evidence | Note |
|---|---|---|
| `scenarios/scenarios.controller.ts` + `.service.ts` + `.module.ts` | **0 references** anywhere (`scenarios.module` is not in `app.module`) | ⚠️ The dead copy has **more** features (`addHistory`) — it may be a *newer* implementation that was never wired, or an abandoned fork. **Decide before deleting** |
| `automation/timeline.*` vs `timeline/*` | ⚠️ **BOTH live** — `automation.module.ts:21,28` (relative) and `app.module.ts:36` | Not dead. **Two timelines, one name** |

⚠️ **A mistake I made and corrected, recorded because it is the trap in this review.** My first grep
required a path containing `automation/timeline` and returned **zero** imports, which would have read as
"13 KB of dead code". The file is imported **relatively** (`./timeline.service`). **A relative import is
invisible to a path-shaped search.** I only caught it by re-running the search inside the folder.

---

## 4. 🟠 File size and mixed concerns

**Backend — largest non-spec files:**

| Lines | File | Concern |
|---|---|---|
| 2,530 | `trading/trading-strategy.service.ts` | **12 N+1 sites** — the worst single file for avoidable queries |
| 2,467 | `automation/automation-loop.service.ts` | The pipeline's main loop — bot resolution, gates, dispatch, recovery in one class |
| 2,109 | `backtest/backtest.service.ts` | |
| 1,745 | `signals/signal-envelope.service.ts` | |
| 1,604 | `automation/stop-guardian.service.ts` | |
| 1,557 | `scoring/protocol-gating.service.ts` | |

**Controllers — these should be thin:**

| Lines | File |
|---|---|
| **1,244** | `trading/trade-history.controller.ts` |
| **942** | `scoring/protocol-gating.controller.ts` |
| **826** | `automation/automation.controller.ts` |

A 1,244-line controller is a strong signal that **business logic lives in the transport layer**. This is
the clearest "too many concerns in one file" finding in the repo, and it is cheap to confirm: a
controller should map HTTP → service call and back.

**Frontend — largest code files (data files excluded):**

| Lines | File |
|---|---|
| 1,822 | `src/pages/DiagramsPage.jsx` |
| 1,417 | `src/pages/ArchitectureFrameworkPage.jsx` |
| 1,317 | `src/core/view-meta.js` |
| 1,166 | `src/pages/ViewStrategyPage.jsx` ← *the file currently open in the editor* |
| 1,110 | `src/components/ScreenOptions.jsx` |
| 1,063 | `src/App.jsx` — the router and the shell |

---

## 5. 🟠 Avoidable database work — the owner's specific concern

**New tool: `scripts/analyse-query-patterns.cjs`** (self-test **7/7**, including four
false-positive guards — it cannot fire on a comment, on a different model, or on a call *after* a loop).
Run it with `--top N`.

| Pattern | Count | What it costs |
|---|---|---|
| **N+1** — a Prisma call inside a loop | **137 sites / 41 files** | One round trip **per element** |
| **REFETCH** — a read immediately after a write on the same model | **6** | `create`/`update`/`upsert` **already return the row** |
| **REDUNDANT** — the same read twice in one function | **22** | |

### 🔴 The verified worked example (and its honest size)

`automation-loop.service.ts:1214`, inside the per-bot loop at L1187:

```ts
const dbSym = await this.prisma.symbol.findFirst({ where: { ticker: strat.symbol } });
```

**Measured:** 39 active bots · 31 distinct symbols · **31 of 31 symbols already in the registry** · 101
loop ticks per 24 h · **1** direct Prisma call in that loop window.

| | |
|---|---|
| Queries today | **39 per tick ≈ 3,939 / day** |
| Queries after a `findMany({ ticker: { in: [...] } })` + Map | **1 per tick ≈ 101 / day** |
| Saving | ~3,838 queries/day |

⚠️ **Stated plainly: this is a pattern defect, not a performance emergency.** At ~1 ms per indexed
lookup that is seconds per day. **I am not going to dress it up as a bottleneck.** Its value is that
the loop's cost currently scales with *how many bots you add*, and the fix is four lines. The same
four-line shape applies to the other 136 sites, several of which sit in genuinely hot paths
(`trading-strategy.service.ts`×12, `score-history.service.ts`×7, `decision-chain.service.ts`×5).

**REFETCH is the cheapest win** — each of the 6 is a query that returns data the caller already holds:

```
providers/position-sync.service.ts:355      update()  then findFirst()
scoring/stack-performance.service.ts:256    upsert()  then findUnique()   ← META.Stack rating path
screener/screener.service.ts:619            create()  then findFirst()
trading/trading-strategy.service.ts:714     delete()  then count()
backtest/backtest-period.service.ts:390     createMany() then count()
decoder/decoder.service.ts:180              create()  then findMany()
```

---

## 6. Duplication — the repo already measures this well

`node scripts/validate-duplication.cjs --report` annotates every pair as **deliberate** or not. That is
the right design and I found no reason to change it. The **NOT deliberate** pairs it already names:

| Windows | Pair | Status |
|---|---|---|
| 27 | `ProtocolTrailPage.jsx` ↔ `SinglesMonitorPage.jsx` | Extraction candidate, **not done** |
| 20 ×2 | `architecture-manifest.controller.ts` ↔ `architecture-reference.js` / `architecture-framework.data.js` | One pipeline described in **three** places |
| 13 | `SupportResistancePage.jsx` ↔ `VolatilityAnalysisPage.jsx` | |
| 12 | `BacktestChart.jsx` ↔ `EquityCurveChart.jsx` | |
| 10 | `deepseek.service.ts` ↔ `gemini.service.ts` | AI adapter shape |

⚠️ **The one UNGUARDED thing the report itself flags:** the 1,023-window sanctioned pair
(`architecture-reference.js` ↔ `architecture-framework.data.js`) has **nothing failing the build if one
surface is updated and the other is not.** They diverged once already (batch #17) and only a human
reading both found it. **That is a missing guard, not a duplication problem** — and it is the highest-
leverage *guard* on this list.

---

## 7. What I did NOT do — stated plainly

- **Did not change one line of application code.** This is a review; every recommendation needs its own
  decision, several need the owner's (which timeline survives, which scenarios copy is canonical).
- **Did not audit the 137 N+1 sites individually.** I verified the highest-value one and read the
  REFETCH list. The rest are **places to look**, and the tool says so in its own output.
- **Did not review the frontend's architecture** beyond file sizes — `App.jsx` (1,063 lines) owns routing
  and the shell, and that deserves its own pass.
- **Did not run the perf/EXPLAIN path.** No query was timed against the database; the "~1 ms" is an
  order-of-magnitude estimate, not a measurement, and is labelled as such.
- **Did not evaluate the invariants themselves** — whether the 20+ IDs are the *right* 20. That is a
  different review and a bigger one.

---

## 8. Recommended order, cheapest-and-safest first

| # | Action | Effort | Risk | Why first |
|---|---|---|---|---|
| 1 | Rename `trading/stop-guardian.service.ts` → `StopAdjustmentRecorder` | **S** | none | Pure rename; the correct name already exists; deletes an import alias |
| 2 | Delete `scenarios/scenarios.*` **after** confirming which copy is intended | S | low | 3 dead files; ⚠️ needs a decision — the dead copy is *newer* |
| 3 | Fix the 6 REFETCH sites | S | low | Each deletes a query that returns data already in hand |
| 4 | Convert the 3 oversized controllers to service calls | **M** | low | 1,244-line controller is the clearest mixed-concern signal |
| 5 | Add a guard for the two-surface docs agreement | M | low | The duplication report asks for it in its own text |
| 6 | Sweep the N+1 sites, hot paths first | **L** | low | 137 sites; start with `trading-strategy.service.ts` |
| 7 | Resolve the two `TimelineService`s and the `MarketStatus`/`MarketSession` names | M | **med** | Needs a decision on which concept wins — #851 already warns they are different axes |

---

## Tooling added by this review

**`scripts/analyse-query-patterns.cjs`** — N+1 / REFETCH / REDUNDANT scanner.

```
node scripts/analyse-query-patterns.cjs               # report
node scripts/analyse-query-patterns.cjs --top 25
node scripts/analyse-query-patterns.cjs --self-test    # 7/7 — proves each rule fires AND the false-positive guards hold
```

⚠️ It is a **report, not a build gate** — deliberately. It cannot see caching, a bounded loop, or a
deliberate re-read, so gating on it would fail builds for correct code, and an allowlisted guard is
worse than none.
