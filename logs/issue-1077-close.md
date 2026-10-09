## CLOSED 2026-10-09 — owner ruled "B": the directive is REPLACED. Implemented, canaried, deployed.

Answered in chat after review-queue **R50** was presented with the measured evidence. Ruling recorded in the three homes: DECISION marker at the directive · register **row 75** · this comment; queue R50 moved to DONE with the verdict.

### What changed

| | |
|---|---|
| Directive | `SuperTrendDirective` now calls `computeSuperTrend()` — the canonical ratcheting SuperTrend, **ONE home** in `directives/utils/supertrend.ts` (the arithmetic the shadow validated over 2 measured days) |
| Mapping | direction → `bullish`/`bearish` at a **flat score 55** — the measured comparison assumed 55 |
| Third state | an unestablished trend is **neutral, named in the reason** — the old code never had this; every tick became a coin-flip call |
| Removed | the unreachable `score 75` branches — **not re-invented** (a new strength threshold would be tuning beyond the ruling); the shadow module is **deleted** (per its own contract: replaced incumbent ⇒ the shadow would only duplicate it) |
| Versions | directive 1.1.0 → 1.2.0 · product → 0.121.5 |

### Verification (observed, not asserted)

- **Canaried both directions.** Restoring the old one-bar formula fails **1** spec case — *the pullback case, which is the exact defect*; disabling the ratchet fails **2**. Restore verified byte-for-byte (SHA256 unchanged).
- The fix case, concretely: a rising book with one red bar whose close (154.9) sits below its own midpoint (156.0) — OLD: `bearish`, discarding the trend; NEW: `bullish` while the ratified line (~148) holds. A close **through** the ratified line (~148) flips to `bearish` — and that test fails with a dead ratchet.
- Full suite: **177 suites / 1662 tests** pass; `tsc` clean; register validates at 75 rows / 30 markers.

### Pre-close checklist

| gate | observed |
|---|---|
| Structural | `tsc -p tsconfig.build.json` clean; suite green |
| Contract | pipeline-map regenerated (files added/deleted); register + markers validated |
| State | deployed via `build:api` (full chain: validators → rimraf → prisma generate → tsc → restart → health); API healthy; `dist` carries `computeSuperTrend` and no `shadowSupertrend` |
| Behaviour | guardian runs on the new build; the DECLINED line no longer carries the retired `shadow=[supertrend:…]` field |

### Scope, stated

- **Blast radius = the exit path only**: `supertrend` references **0 protocols**, so nothing in scoring changes; the guardian consumes its class through the normal ≥55 consensus — and the evidence says the practical footprint is small (475 gate-crosses → 9 real stop-moves → none reached, over the measured window).
- **The retired shadow field**: `DECLINED` lines lose `shadow=[supertrend:…]` — deliberately, since it would now repeat the incumbent's class. The evidence it collected stands (posted 2026-10-09).
- **Monitoring after the change**: the guardian's own `DECLINED`/`MANAGED` lines carry the canonical class in `aligned`/`opposing`; re-run the outcome parse on a fresh window when a decision needs it.

🤖 Closed by primary — 2026-10-09. Handoff: `2026-10-09-1077-supertrend-canonical.md`
