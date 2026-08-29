# Trading Command Suite — Discussion & Prioritization Plan

> **Status:** Live working plan — updated by the Librarian as discussions resolve.
> **Purpose:** turn 39 open `discussion` issues into a prioritizable, phase-aligned plan, and ultimately feed the roadmap (#681).
> **Last updated:** 2026-08-29 (batch: phase redefinition #700, scoring-scale cluster #685/#624/#683).

---

## 1. How to read this plan

1. Every open `discussion` issue belongs to one of **7 themes** below.
2. Each has a **decision needed** — a concrete question to answer so it can move to a build issue or close.
3. Themes carry a **priority (P0–P3)** based on leverage, not size.
4. Resolved items land in the **Decision Log** (§8) and get removed from the open list.

---

## 2. Priority order

| Tier | Theme | Why now | Issues |
|------|-------|---------|--------|
| **P0** | The plan itself | Unblocks prioritization; #700 gives structure, #681 gives the tool, #685 says whether scoring means anything | #700, #681, #685 |
| **P1** | Financial edge | The stated direction; accuracy-critical; builds on live data (screener, earnings, FX) | #680, #679, #695, #692 |
| **P2** | Scoring / UX clarity | Quick decisions that restore user trust and UI clarity | #624, #683, #658 |
| **P3** | Everything else | Grouped and parkable; resolve opportunistically | #623, #657, #673, #538, #574, #640, #573, #706, #707, #710, #536, #591, #420, #266, #449, #260, #445, #458, #587, #246, #285, #286, #696 |

---

## 3. Theme 1 — The plan itself (P0)

| Issue | Decision needed | Status |
|-------|----------------|--------|
| #700 Phase redefinition (Phase 4 = Polishing; Phase 10 = Public Release) | Adopt + execute label/retag | ✅ **Executed 2026-08-29** (see §8) |
| #681 Dynamic Roadmap (kanban × gantt planning core) | Choose approach: build the reusable store/core vs. lightweight TCS view first | Proposed — see §7 |
| #685 Signal % ceilings — "is 36% actually good?" | Research-first: query `score_snapshot` distribution; calibrate thresholds after | Proposed — see §7 |
| #591 Dev-process review · #420 Agent self-awareness/alerting | Parked (meta) | Parked |

## 4. Theme 2 — The scoring scale (P2, but ripples widest)

| Issue | Decision needed | Status |
|-------|----------------|--------|
| #624 Terminology (rename Scoring Strategy / Trading Strategy) | Adopt a naming; surface "what am I looking at" | Proposed — see §7 |
| #683 wire `ScoringStrategy.gateConfig` or retire it | Wire vs retire (dead, unwired field) | Proposed — see §7 |
| #658 Surface the hurdle chain (multiplierChain + warnings) | Build the "which gates did this symbol clear/fail" view | Open |
| #657 Data-driven gates (configurable hurdles) | Design once #658/#683 decisions land | Open |
| #623 Score expiry / freshness metadata | Adopt stale-score handling | Open |
| #673 Position-aware scoring throttle | Adopt (entry-management dependent) | Open |
| #538 Liquidity/volume symbol prioritization | Adopt for evaluation order | Open |
| #621 SEES ladder filtering (per trading style) | Choose scoped-ladder option | Open |
| #573 Speed Scanner review (labels, protocol vs strategy clarity, A/B) | Review + decision | Open |

## 5. Theme 3 — The financial edge (P1)

| Issue | Decision needed | Status |
|-------|----------------|--------|
| #679 EPS Estimate Change vs Actual EPS (core earnings signal) | Design the signal (long & short prep) | Open |
| #680 Earnings Calendar Funnel (80/day → 10–15 strong) | Adopt funnel criteria + scoring | Open |
| #695 FX session pairs go-live checklist | Adopt the checklist before enabling demo execution | Open |
| #692 Rebuild news-sentiment signal on screener lean | Choose directive / Opportunity input / informational | Open |
| #246 Sunday/Monday planning workflow | Adopt pre-market + week-ahead views | Open |
| #285 Wyckoff Accumulation/Distribution detector | Adopt as directive | Open |
| #286 Fundamental Data Gap (DPS, debt ratios, momentum) | Scope data sources | Open |

## 6. Themes 4–7 (P3 — parkable, grouped)

- **Execution & risk:** #695 (→ P1 above), #696 Trading212 discontinued (evidence log & broker treatment), #574 Execution Queue semantics, #640 weekend-aware planning tools.
- **Observability & ops:** #706 summary-trace logging, #707 notification upsert, #710 log-table schema normalization, #536 structured META.Stack logging for AI.
- **AI advisor (user-facing):** #266 AI reviews portfolio changes, #449 advice generator / unified agent service, #260 Portfolio Change Reaction Center.
- **UX / content / training:** #445 trading glossary, #458 journal scrapbook, #587 Wall-Street predictions, #573 (→ theme 2), #445.

---

## 7. Decisions in flight (proposed, awaiting confirmation)

These recommendations were posted to the issues on 2026-08-29. Confirm or override, then they move to the Decision Log.

- **#685 — Signal % ceilings:** adopt research-first. Step 1: run the `score_snapshot` `compositePct` distribution query across active protocols (last 30d), split LONG vs SHORT-only, list the rarely-firing directives. Step 2 (after distribution): make `ENTRY_THRESHOLD`/`STRONG_PCT` per-protocol config. Fix the UI copy so the displayed (risk-gated) % isn't confused with the classification %.
- **#624 — Terminology:** adopt user-facing layer labels — **Trading Signals** (scoring + strategy layer) and **Trading Bot** (execution/decision layer) — while keeping the technical identifiers (protocol / ScoringStrategy / TradingStrategy) as-is in code. Add a one-line "what am I looking at" hint on ladder/protocol surfaces.
- **#683 — gateConfig:** **retire** the unwired field + seed values (dead weight, misleading) rather than wiring a 4th overlapping gate mechanism. If group-level gating is wanted later, design it inside #657 (data-driven gates).

## 8. Decision log

| Date | Issue | Decision |
|------|-------|----------|
| 2026-08-29 | #700 | Phase redefinition executed: `phase-4` → **Polishing** ("app trading live, hardening, onboarding"); new **`phase-10` = Public Release**; 2 backtesting issues (#456, #270) re-homed to phase-3; #514 tagged phase-10. *Note: phase-4 was actually "Backtesting", not "Public release prep" as #700 assumed — the backtesting work moved to phase-3.* |
| 2026-08-29 | #685/#624/#683 | Recommendations posted (§7) — awaiting confirmation. |

---

## 9. Next actions (suggested)

1. **#700** — done. Update the Architecture Framework roadmap view + Google Drive docs to the new phase structure (follow-up, tracked in #700).
2. **#685** — run the `score_snapshot` distribution analysis (data exists; research-only).
3. **#681** — decide the Dynamic Roadmap approach (build the reusable core vs. a lightweight prioritization view first).
4. Confirm **#624 / #683** recommendations → they close or become build issues.
5. Then start **P1 (financial edge)**: #680 → #679 → #695 → #692.

*This doc mirrors to the Google Drive documentation folder for long-term persistence.*
