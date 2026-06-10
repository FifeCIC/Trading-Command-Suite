# P12 — Skeleton-to-Real Top 5 Upgrade Picks

> Generated: 2026-06-10 | Sources: `plugin-tab-skeletons.js`, `skeleton-rollout.js`, `nav-tree.js`, SPRINT.md  
> Principle: SEES-first — every upgrade pick advances the scoring pipeline toward a real scored symbol in the cockpit.

---

## Current State: 19 Real Pages, 57 Skeletons

19 JSX pages exist. ~57 nav-tree views are still skeletons rendered by `PluginTabSkeletonPage` / `FeatureSkeletonPage`. The 15-item SEES-first rollout (`skeleton-rollout.js`) maps Phases 0–4 but only 7 of those 15 are real pages today.

---

## Top 5 Upgrade Picks (Ranked)

### 🥇 #1: `configure-directives` — Directive Configuration Editor

| Factor | Detail |
|---|---|
| **Phase** | Phase 1 (Decision) |
| **Current state** | Skeleton. `DirectivesManagerPage.jsx` exists as a stub (reads seed data, no mutation). |
| **Expected effort** | 1–2 sessions |
| **Risk** | Low |
| **Dependencies** | Task 4 directives implemented → `GET/PATCH /api/directives/:id/config` (T4-09) |

**Why now:** This is the single highest-leverage skeleton upgrade. Once Task 4 ships 5 directives, operators need a control surface to tune weights, thresholds, and enable/disable directives. Without this page, every weight change requires a database query. The backend contracts are already drafted (P06 T4-09: `GET /api/directives/:id/config`, `PATCH /api/directives/:id/config`).

**What to build:**
- Read current directive configs from `GET /api/directives`
- Weight sliders (0–100%) with live sum validation
- Threshold editors per directive (e.g., RSI oversold: 20–40)
- Enable/disable toggle per directive
- Save via `PATCH /api/directives/:id/config`
- Strategy preset selector (loads preset weight bundles)
- "Reset to MVP defaults" button

**Impact:** Unlocks T4-09 (configurable thresholds), enables the Algorithm Lab workflow, and is the first real mutation UI in the Scoring area.

---

### 🥈 #2: `active-symbols` — Active Symbol Set Manager

| Factor | Detail |
|---|---|
| **Phase** | Phase 0 (Foundation) |
| **Current state** | Partial. `SymbolsBrowserPage.jsx` lists symbols. No dedicated active/inactive toggle UI. |
| **Expected effort** | 1 session |
| **Risk** | Very low |
| **Dependencies** | Symbol CRUD endpoints (already live: `GET/POST/PATCH /api/symbols`) |

**Why now:** Scoring needs to know which symbols are "in play." The `ScoringService.rankAll()` already queries `WHERE active = true`. Without this page, activating/deactivating symbols requires direct DB access. Phase 0 foundation that blocks nothing but unlocks everything.

**What to build:**
- Table of all symbols with active/inactive toggle
- Bulk activate/deactivate
- Filter by exchange, type, active status
- "Active count" badge (feeds into scoring: "Scoring 12 of 50 symbols")
- Quick-add symbol flow (reuse existing create form)
- Link to provider freshness per symbol

**Impact:** Makes the symbol store operational. Currently 3 test symbols seeded — this page is how real watchlists get populated.

---

### 🥉 #3: `trading-strategies` — Strategy Execution Catalog

| Factor | Detail |
|---|---|
| **Phase** | Phase 2 (Execution) |
| **Current state** | Skeleton. No real page. |
| **Expected effort** | 2 sessions |
| **Risk** | Medium |
| **Dependencies** | Strategy CRUD (D-TICKET-08), ScoringService (D-TICKET-09), risk gate (D-TICKET-11) |

**Why now:** This is the bridge page between scoring output and trading action. After scoring ranks symbols, the operator needs a place to review entry signals, attach position intent, and send to execution queue. It's the "decision surface" — the most important page in the Trading area after SEES Live Stack.

**What to build:**
- Strategy card per active strategy showing: name, active directives, thresholds
- "Signals ready" count per strategy (entry signals from latest scoring run)
- Per-strategy symbol list with score, signal, confidence
- "Send to execution queue" action per symbol (delegates to T4-12 queue)
- Risk profile indicator per strategy (conservative/balanced/aggressive)
- Manual override: promote watch→entry, demote entry→watch

**Impact:** Completes the Phase 2 execution loop: directives score → strategies aggregate → operator reviews → execution queue. Without this page, scoring output has no consumer.

---

### #4: `trade-history` — Execution Audit Trail

| Factor | Detail |
|---|---|
| **Phase** | Phase 3 (Controls) |
| **Current state** | Skeleton. No real page. |
| **Expected effort** | 1 session |
| **Risk** | Low |
| **Dependencies** | Execution queue (D-TICKET-12), Score table (already exists) |

**Why now:** Minimum viable controls page. Every execution must be auditable. This is a read-only table — the simplest kind of page to build. Low risk, high necessity. Without it, there's zero visibility into what the system actually did.

**What to build:**
- Table: timestamp, ticker, strategy, signal, score, dispatch status, broker response
- Filter by date range, strategy, ticker, status
- Expand row → full directive breakdown at execution time
- Export CSV (reuse pattern from existing pages)
- Link to strategy and symbol detail

**Impact:** First page in the Controls phase. Establishes the audit pattern that risk controls and platform comparisons will follow.

---

### #5: `api-endpoints` — Endpoint Catalog Viewer

| Factor | Detail |
|---|---|
| **Phase** | Phase 0 (Foundation) |
| **Current state** | Skeleton. No real page. |
| **Expected effort** | 1 session |
| **Risk** | Very low |
| **Dependencies** | Endpoint catalog seed data (P04 — already Done: 72 endpoints, 0 broken refs) |

**Why now:** The data exists. P04 built a complete endpoint catalog with 72 endpoints across 6 providers, validated with 0 broken cross-references. This page just needs to render it. Read-only, no mutations, no backend changes needed. Fastest win in the skeleton list.

**What to build:**
- Provider selector tabs (Trading 212, IBKR, Alpaca, Alpha Vantage, Polygon, Tradier)
- Per-provider endpoint table: method, path, category, confidence badge, rate limit, payload class
- Expand row → full endpoint detail (params, response shape, auth requirements)
- Confidence color coding (confirmed=green, likely=yellow, uncertain=red)
- Rate limit category visual indicator
- Cross-reference link to provider health status

**Impact:** Makes the P04 investment visible. Operators can browse what each provider offers without reading JSON. Foundation for provider comparison decisions.

---

## Why These 5?

| Principle | How These 5 Deliver |
|---|---|
| **SEES-first** | #1 (directives config) and #3 (trading strategies) are the two SEES operator surfaces |
| **Dependency chain** | #5 (endpoints) → #2 (symbols) → #1 (directives) → #3 (strategies) → #4 (history) |
| **Maximize impact** | #1 unlocks weight tuning. #2 unlocks scoring pipeline. #3 unlocks execution decisions |
| **Minimize risk** | #5 and #2 are read-mostly. #4 is read-only. Only #1 and #3 have mutations |
| **Existing contracts** | All 5 have backend contracts already drafted or live |
| **Build momentum** | #5, #2, #4 are 1-session each → fast wins → confidence for #1 and #3 |

---

## What NOT to Upgrade Yet

| Skeleton | Reason to Defer |
|---|---|
| `sees-ready` / `sees-pro` | Premature — need directives + strategies working first |
| `algorithm-lab` | Needs configurable directives (#1) as prerequisite |
| `manual-trading` | Needs execution queue (D-TICKET-12) working first |
| `focus-priority` | Phase 4 — ML overlay, post-MVP |
| `performance-lab` | Phase 4 — needs historical scoring data (months) |
| `calculators` | Useful but not blocking — independent utility |
| `portfolio-overview` | Needs position data from broker adapters (Task 3) |

---

## Execution Order

```
Session A: #5 api-endpoints     (1 session, read-only, P04 data ready)
Session B: #2 active-symbols    (1 session, CRUD endpoints live)
Session C: #1 configure-directives (1-2 sessions, needs Task 4 directives)
Session D: #3 trading-strategies   (2 sessions, needs strategies + scoring)
Session E: #4 trade-history       (1 session, needs execution queue)
```

**Parallel opportunity:** Sessions A and B can run in parallel (no shared dependencies).

---

## Risk Register

| Risk | Likelihood | Mitigation |
|---|---|---|
| Task 4 directives not ready when #1 starts | Medium | #1 can load seed directive configs and work in read-only mode until API is live |
| Strategy config schema changes during #3 build | Low | Contracts already drafted in P06/P07 — lock schema before starting #3 |
| Execution queue not ready for #4 | Medium | #4 can display scored signals as "intended trades" before queue is live |
| Provider catalog schema drifts after P04 | Low | #5 is a read-only viewer — schema changes are additive |
