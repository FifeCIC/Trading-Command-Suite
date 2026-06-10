# Skeleton-to-Real Top 5 Upgrade Picks

> Generated: 2026-06-10 | Task: P12 | Full artifact: `Trading-Command-Suite-Documentation/docs/backlog/P12-SKELETON-UPGRADE-PICKS.md`

## Current State
- 43 nav views defined | 11 real pages | 7 skeleton wrappers | 25 completely missing

## Top 5 — Ranked by Impact ÷ Risk

| Rank | Page | Effort | Risk | Why Now |
|---|---|---|---|---|
| 1 | `api-endpoints` | 2-3h | Very Low | Renders P04 catalog (72 endpoints, 6 providers) — zero backend changes |
| 2 | `configure-directives` | 3-4h | Low | Task 4 prep — operator control surface for directive weights & thresholds |
| 3 | `scoring-overview` | 3-4h | Low-Med | System scoring health dashboard — complements per-symbol SEES cockpit |
| 4 | `directives-status` | 2-3h | Very Low | Task 4 progress tracker — visualizes P06 ticket implementation status |
| 5 | `provider-health` | 2-3h | Very Low | Backend endpoint exists. Shows adapter health. Ready for N1 (real Alpaca). |

## Recommended Order
```
A: api-endpoints (zero deps) → B: directives-status → C: configure-directives → D: provider-health → E: scoring-overview
```

## Dependency Chain
```
P04 ✅ → Rank 1    |    P06 ✅ → Rank 2 + Rank 4    |    N2 🔜 → Rank 3    |    N1 🔜 → Rank 5
```
