# Sprint — UI/UX: finish the Page Walkthrough backlog and the defects it exposed

Created at the owner's direction, 2026-10-08: *"Create a UI/IX sprint out of all those issues and
outstanding matters on the review page. Then once done I will prompt you to work through all of it
without stopping."*

This issue is the **work list**. It is ordered, self-contained, and written so it can be worked straight
through without a decision per item.

---

## Ground rules — how this sprint is worked

These exist because the owner's standing complaint is that progress keeps stopping:

1. **Batch by phase, not by item.** Finish a phase, run `npm run build` **once**, move on. Do not
   build-verify after every edit.
2. **Mark the walkthrough rows as you go.** `PUT /api/system/settings/ui-review` with
   `{viewKey, patch:{noteApplied:true}}`. A `✅` means *the asks in that note are done* — nothing else.
3. **Only stop for a genuine fork** — one that measurement cannot settle and that changes what gets
   built. Everything else gets decided, with the reasoning written down.
4. **Never claim a cause you did not isolate.** Three hypotheses were refuted by measurement during the
   session that created this issue; each is recorded rather than quietly dropped.
5. **Do not change the maths.** Thresholds, weights, sizing, gates and cadences need a copied
   configuration and a monitored comparison
   (`maths-change-requires-ab.instructions.md`). Where an item looks like maths, it stops at *presentation*.
6. **Report at the end, briefly** — one table, what changed, what did not.

---

## Phase 1 — the three remaining Page Walkthrough rows

| # | View | The ask | Notes |
|---|---|---|---|
| 1.1 | `/education/candle-patterns-guide` | *"Depictions of candles are not good enough. The first image uses very thin lines and it looks dull. The larger TradingView based chart shows very wide candles... I do think we need our own approach to consuming any of the chart tech."* | **The biggest item in the sprint.** See 2.3 — it is the same problem |
| 1.2 | `/research/research-notes` | *"When AI is fully integrated I would add a toggle for automatic AI response to note submission but we arent in the AI phase yet."* | Blocked on **#1097**. Do not build a stub |
| 1.3 | `/research/stock-investigation` | *"This is essentially like a report on a stock. It will require the AI phase to be started."* | Same block |

**Phase 1 done when:** 1.1 renders candles that read as candles at every size, or is filed as its own
scoped issue with the blocker named; 1.2 and 1.3 are marked applied **only if** #1097 is settled, else
they stay `❌` with the dependency stated.

---

## Phase 2 — defects found during the session, still open

| # | Defect | Evidence | Where |
|---|---|---|---|
| 2.1 | **~50 pages have an invisible, unclickable ℹ control** | `src/index.css:1813` sets `.main-stage h1 { display: none }`, so any `PageInfoPopover` inside a page `h1` cannot be seen or focused | Measured earlier; ⚠️ **not yet filed as an issue** — file it as part of this work |
| 2.2 | **Signals Overview still ships the legacy card** | `?variant=A` reaches `OpportunityCard`; the owner's standing rule is *"if there is ever an A/B test involved, go with B"* | `src/pages/SignalsOverviewPage.jsx` + `src/components/SignalCard.jsx`. Delete the old variant as the Protocols Registry old design was deleted |
| 2.3 | **Charts are not unified** | `SpeedChart.jsx` is a *"unified lightweight-charts wrapper"* and `src/components/charts/ChartAdapter.js` exists — but `createChart` is imported **directly by ~12 surfaces**: CandlePatternsGuidePage, PatternScannerPage, SnapshotLibraryPage, SnapshotReplayPage, SupportResistancePage, SymbolDetailPage, VolatilityAnalysisPage, ChartComparisonPage, BacktestChart, EquityCurveChart, CandlePatternChart, TrailingStopDemo | This is the architectural half of 1.1. ⚠️ Also: `ChangeStat.jsx` claims *"lightweight-charts is the app's only chart library"*, which is false — `CanvasCandlestickChart.jsx` and a uPlot adapter exist |
| 2.4 | **`validate-decisions.cjs` false positive** | A status emoji in *prose* inside the guard cell is counted as a second status. Row 58 has one real status; its second emoji is the words *"Not 🟢: …"* | Recommended fix (not made): count a status mark only at the **start** of the guard cell |
| 2.5 | **The journal has no per-symbol history** | `/api/journal/stats` returns `bySymbol` present but **0 rows**, so the new *Past profit* ordering on Signals Overview is deliberately rendered disabled | This is a **data** gap, not a code one. Decide: leave disabled, or widen the journal's scope |
| 2.6 | **A registered symbol does not survive a reinstall** | `symbol` has a seeder (`seed-symbol-onboarding.ts`) and the new register overlay writes only to the database | `database-seed-discipline.instructions.md`. A user registering their own symbol is runtime data — so the *right* answer may be "nothing to do", but it must be **decided and recorded**, not left implied |

**Phase 2 done when:** 2.1 is filed, 2.2's old variant is deleted, 2.3 has all direct `createChart` callers
routed through one wrapper **or** a scoped issue naming each caller, 2.4 is fixed with a canary in both
directions, and 2.5/2.6 each carry a recorded decision.

---

## Phase 3 — follow-ups from work landed this session

| # | Item | Reference |
|---|---|---|
| 3.1 | **The score denominator is still wrong in the API** — ranked reports `maxPossibleScore: 100` for every row while the protocol declares 1010 and a raw score exceeds 100 | **#1090** — the UI is fixed and honest; the API value is a contract decision (three consumers read `score`) |
| 3.2 | **Five more bot-layer pipeline steps** — 5 of the 10 from the review were added to Meta.Stack Explorer; the remainder are queue expiry/freshness detail, direction authority, and the exit-attribution split | **#1094** |
| 3.3 | **The scoring programme** — the mechanics panel covers the gated/signal path only. *"We will do this with every approach to scoring"* is a programme, not one view | **#1095** §1 |
| 3.4 | **QA feedback loop** — designed, not built: record pass/fail + note per QA entry, in the `appsetting` store the walkthrough already uses | **#1095** §2 — needs the owner's sign-off on the stored shape |
| 3.5 | **Levels before limit orders** — a Levels view for visual testing, *then* a limit-order path. Do not start at the limit orders | **#1095** §3 |
| 3.6 | **GitHub Pages traffic counter** — GitHub reports repo views/clones only, **not Pages visits**, so a cookie-free counter (GoatCounter) is the only way to see the traffic the free-edition move was meant to attract | Answer given; no counter installed |
| 3.7 | **`MetaStackPipelinePage.jsx` is still named *Page*** but is now a component rendered inside Pipeline Graph Lab | Cosmetic; rename touches 3 imports |

---

## Phase 4 — the AI phase is a DECISION, not code

**#1097** collects five existing requests that depend on it (stock reports, news analysis,
earnings-calendar analysis, automatic note responses, register-symbol suggestions) and the four
questions that must be answered first: provider/boundary, unavailable-as-a-state, provenance, cost.

⚠️ **Do not start any of the five before the four are answered.** The two blocked walkthrough rows are
blocked by these, not by effort.

---

## Definition of done for the whole sprint

- Every row in `/development/ui-review` that this sprint covers reads `✅`, or carries a stated reason it
  cannot (an AI-phase dependency, an owner decision).
- `npm run build` green; `verify-view-meta-routes`, `validate-decisions` and the free-edition generators
  all clean after the final change.
- **One** handoff at the end summarising the phase, not one per item.
- A closing comment listing what was **not** done and why.

## ⚠️ Known traps for whoever works this

- **The build can go green while the page renders nothing.** A missing `useRef` import during this
  session threw at runtime, left `document.scrollWidth` reading *correct*, and was caught only by
  counting the elements. **Count the thing; do not only measure the symptom.**
- **`build:api` (the backend) is a shared resource.** Another agent may hold it. Land frontend work and
  let the API come back rather than fighting for the port.
- **A failed `build:api` leaves the API stopped and `dist/` deleted.** Completing that build is the
  unblock, not an optional step.
- **PowerShell mangles JSON.** Use `node -e` for anything that reads API payloads.
