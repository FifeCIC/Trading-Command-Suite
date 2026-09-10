---
description: "META.Stack pipeline contracts — the invariants the pipeline depends on, the boundaries between stages, and where each contract must be mirrored. Read before changing how bars, time, cadence, scoring units, or gating work. Enforced at build time by scripts/validate-pipeline-contracts.cjs."
applyTo: "nest/src/**, scripts/**, src/**"
---

# META.Stack Pipeline Contracts

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
| `INV-BAR-WINDOW` | "Newest N bars" = `orderBy desc` + `take` **then reverse**; `asc + take` returns the *oldest* N | #751 — `loadBars()` scored AUDUSD on a window ending 2026-05-18 | `market-data.service.spec.ts` + scan |
| `INV-CANONICAL-LOADER` | Only `MarketDataService.getBars()` loads a bar window in a scoring/decision path | #751 — two hand-rolled queries lost the `timeframe` filter | scan (whitelist in the validator) |
| `INV-SINGLE-CADENCE` | One bar array = **one** timeframe; cadence comes from `selectBaseTimeframe(protocol.recommendedTimeframe)` | 35 of 187 symbols were fed `5m + 15m + 1h + 4h` in one array | `timeframe.spec.ts` + canary |
| `INV-UTC-TIMESTAMPS` | MT5 epochs are broker **server** time; `utc_iso()` subtracts the measured offset | #750 — bars ~3h in the future; the gate failed open | bridge canary + `bridge-clock-skew` alert |
| `INV-GATE-FAILS-CLOSED` | `computeMarketStatus` returns **closed** when freshness cannot be verified (future-dated, reordered, indeterminate cadence) | #750/#751 — three separate fail-open paths | `market-status.spec.ts` + canary |
| `INV-SCORE-MAGNITUDE` | A directive `score` is a magnitude in `[0, maxScore]`; direction lives in `signalClass`. Never clamp to 100 | the recurring "0–100 trap" that destroys protocol weighting | scan (`Math.min(x, 100)`) |
| `INV-NO-FUTURE-ROWS` | No MT5-sourced row is dated in the future | #750 — a future date silently defeats every staleness check | `nest/scripts/contract-probe.cjs` (live) |
| `INV-STABLE-DENOMINATOR` | A protocol percentage divides **earned** by **configured capacity**, never by the observed evidence sum. Direction-eligibility is decided per directive, so the denominator is fixed for the tick | #758 — an observed denominator made the same reading score differently between ticks, and a group contributing 0 produced `0/0 → 0% HOLD` that was counted as *scored* | canary + scan (`no-observed-denominator`) |
| `INV-MTF-BUNDLE` | Every `scoreWithGating()` call in a decision/analysis path passes the 4th argument — the `{ dayBars, hourBars, min15Bars }` bundle from `loadHigherTfBundle(symbolId, protocolId)`. A site with no bundle writes `// no-higher-tf: <reason>` | MST-004 / #735 — 12 call sites omitted it, so every multi-timeframe directive silently scored from base bars only and returned plausible numbers the live loop would never produce | scan (`no-bundle-less-scoring`) |

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

## Banned patterns (all detected at build time)

| Pattern | Why | Instead |
|---|---|---|
| `prisma.marketBar.findMany(...)` in a scoring/decision path | loses the timeframe filter, gets the order wrong, silently | `marketData.getBars(symbolId, cadence, count)` |
| `orderBy: { timestamp: 'asc' }, take: N` over bars | returns the **oldest** N, not the newest | `desc` + `take`, then `.reverse()` |
| `Math.min(score, 100)` | destroys the protocol weighting system | keep the magnitude; direction lives in `signalClass` |
| Removing the clock-offset conversion in the bridge | every timestamp shifts ~3h | keep `utc_iso()` subtracting the measured offset |
