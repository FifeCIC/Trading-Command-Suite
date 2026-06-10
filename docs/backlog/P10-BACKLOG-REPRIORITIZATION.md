# Backlog Reprioritization — Now / Next / Later

> Generated: 2026-06-10 | Task: P10 | Agent: DeepSeek V4 Pro
> Source: `exit-wordpress/backlog/00-IMPLEMENTATION-BACKLOG.md` + current sprint state
> Principle: SEES-first — prioritize anything that puts a real scored symbol into the SEES cockpit.
> Full artifact: `Trading-Command-Suite-Documentation/docs/backlog/P10-BACKLOG-REPRIORITIZATION.md`

## Summary Table

| Priority | ID | Item | Effort | Blocks | Blocked By |
|---|---|---|---|---|---|
| **NOW** | N1 | Real Alpaca adapter | 3-4h | N2, X1-X4 | — |
| **NOW** | N2 | Task 4: 5 directives (P06 tickets) | 6-8h | N3 | — (fixtures OK) |
| **NOW** | N3 | Strategy aggregator | 2-3h | X1 | N2 |
| **NOW** | N4 | SEES QA matrix (P08) | 2-3h | — | — |
| **NEXT** | X1 | Real SEES ranking endpoint | 2-3h | X2 | N2, N3 |
| **NEXT** | X2 | SEES UI loop (P01/P02) | 3-4h | — | X1 |
| **NEXT** | X3 | API health panel UI | 2-3h | — | N1 |
| **NEXT** | X4 | Second real adapter | 3-4h | — | N1 |
| **NEXT** | X5 | Directive test fixtures | 2-3h | — | N2 |
| **LATER** | L1 | Score explanation quality | 1-2h | — | N2 |
| **LATER** | L2 | Retry/backoff policy | 2-3h | — | N1 |
| **LATER** | L3 | Caching policy | 2-3h | — | N1 |
| **LATER** | L4 | Additional directives | 4-6h | — | N2 |
| **LATER** | L5 | Multi-TF composite scoring | 4-6h | — | X2 |
| **LATER** | L6 | Position monitoring | 4-6h | — | N1, N2, X2 |
| **LATER** | L7 | Portfolio views | 3-4h | — | L6 |

## Recommended Execution Order (Next 5 Sessions)

1. **N1**: Real Alpaca adapter → unblocks all real-data work
2. **N2**: Directives (T4-01 through T4-05) → core scoring logic
3. **N3 + N4**: Strategy aggregator + QA matrix → validation
4. **X1**: Real ranking endpoint → pipeline wired
5. **X2**: SEES UI loop → visible SEES output

## Dependency Graph

```
Data Model ✅ → Freshness ✅ → Provider Adapters 🔄 → Directives → Aggregator → Ranking → UI
                                                    ↘ mock OK for dev ↗
```
