# Handoff: Scoring Paths Audit (#497)

**Agent:** DeepSeek V4 Pro
**Date:** 2026-07-29
**Issue:** #497 — [Discuss] Scoring paths audit — 4 endpoints, which is canonical?

## Decision

**All 5 scoring surfaces are accepted as canonical.** They serve different purposes and are not accidental duplication.

### Scoring Surface Map (canonical as of 2026-07-29)

| # | Endpoint | Role | Cost | Frontend files |
|---|----------|------|------|----------------|
| 1 | `GET /api/scoring/ranked` | Flat overview / dashboards | Free (cached) / Heavy (fresh) | 21 |
| 2 | `POST /api/scoring/gated/batch` | **Canonical META.Stack** trading decisions | Moderate (~14 directives) | 20 |
| 3 | `GET/POST /api/signals/ladder` | Signal quality / trust assessment | Moderate (wraps gated) | 7 |
| 4 | `POST /api/speed/scan` | Micro-trend scalping | Heavy per symbol, few symbols | 12 |
| 5 | `GET /api/backtest/benchmark` | Analytics — buy-and-hold comparison | Free (no directives) | 0 (new) |

### Performance Analysis

- Protocol gating reduces directive count from 104 → ~14 (~7× cheaper)
- Per-tick memoization in `directivesService.runAll()` prevents re-running same directive+symbol in same tick
- 15s cache on `/ranked` avoids recomputation on dashboard refreshes
- Even at 50 protocols × 10 symbols = ~7,000 evaluations/tick, manageable on modern hardware
- The unfiltered `rankAll?fresh=true` (104 directives) is the only dangerous path — documented as such

## What was updated

### Controller header comments (canonical roles)
- `scoring.controller.ts` — Flat Ranked (workhorse, dashboards)
- `protocol-gating.controller.ts` — META.Stack Canonical (trading decisions) ★
- `signals.controller.ts` — Signal Quality Layer (trust assessment)
- `speed-scan.controller.ts` — Micro-Trend Scalping (speed trading)
- `backtest.controller.ts` — Analytics (not scoring)

Each header now includes: canonical role, cost profile, use cases, cross-reference to other paths.

### DiagramsPage
New "Scoring Paths (5 Surfaces)" Mermaid diagram showing:
- 5 entry points → 5 pipelines → frontend consumers
- Visual hierarchy: gated/batch highlighted as canonical (green)
- Signals→gated delegation shown as dotted line

### architecture-reference.js
All 5 scoring route contracts updated with canonical status, cost notes, and role descriptions. Changed `/ranked` status from `migration` to `active`.

## Files changed

| File | Change |
|------|--------|
| `nest/src/modules/scoring/scoring.controller.ts` | Canonical role header |
| `nest/src/modules/scoring/protocol-gating.controller.ts` | Canonical role header |
| `nest/src/modules/signals/signals.controller.ts` | Canonical role header |
| `nest/src/modules/scoring/speed-scan.controller.ts` | Canonical role header |
| `nest/src/modules/backtest/backtest.controller.ts` | Canonical role header |
| `src/pages/DiagramsPage.jsx` | New scoring paths diagram |
| `src/core/architecture-reference.js` | Updated 5 route contracts |
