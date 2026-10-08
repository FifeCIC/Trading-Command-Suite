## CLOSED 2026-10-08 — re-verified on live data, and the guard for this class is now REAL

The 09-28 fix (two causes: the `resolveCadence` fall-through *and* the `|| 200`-truthy literal in `signal-envelope`) was re-measured today before closing. It holds — and one weak spot in its own test suite was fixed as part of this close.

### Live re-verification (measured 2026-10-08, `tradingcs.score`, last 24h, 217 ticks)

| directive | before (issue) | now |
|---|---|---|
| `bollinger-band-squeeze` (needs 72) | 246/247 ticks starved | **217/217 scored** (avg 34.8) |
| `volume-confirmation` (needs 21) | 246/247 | **217/217** (avg 26.6) |
| `support-resistance-levels` (needs 35) | 246/247 | **184/217** (avg 12.7) |
| `session-open-effect` (needs 30) | 246/247 | **43/217** (avg 10.1) |
| `Insufficient data: need N bars` reason | on 99.6% of ticks | **0 occurrences in 24h** (protocol AND whole table) |

`Opportunity` now peaks at **698** (427 pre-fix, 490 at the fix); `Signal` still rides on `btc-halving-cycle` alone — that is the directive-*choice* question, not this defect.

### The guard was a decoration — now it can fail

`protocol-runner-cadence.spec.ts` carried its own **hand-kept mirror** of the count rule, and its comment admitted the consequence: *"if the mirror ever diverges the suite passes while the real runner is wrong"*. A suite that cannot fail when its code regresses is not a guard.

- Extracted the rule to an **exported, pure** `resolveBaseBarCount()` in `protocol-db.service.ts`; `getBaseBarCount()` and the spec now call the **real** function.
- **Canaried both directions (observed):** restoring the old fall-through fails the suite (**2 tests**); making the fallback unconditional fails it (**4 tests**). Restore verified byte-for-byte (SHA256).
- Full suite: **177 suites / 1659 tests pass**; `tsc` clean.

### Pre-close checklist

| gate | observed |
|---|---|
| Structural | `tsc -p tsconfig.build.json` clean; full jest run green |
| Contract | `INV-BAR-WINDOW` exercised by the cadence suite, now against real code |
| State | live SQL: 0 starvation reasons in 24h; the four directives scoring again |
| Behaviour | the exact symptom (`have 20` on 99.6% of ticks) is gone from live data |

### Deliberately unchanged / tracked elsewhere

- **`social-buzz` scores 0 with a different reason** (`No recent social sentiment data` — a data-import gap, neutral class, cannot affect the composite): tracked by **#912**.
- **`btc-halving-cycle` over-declares `{'1d': 365}` while reading one bar** — the retention/need mismatch is **#1070**; changing the declaration is a separate blast radius.
- `required['1d']` remains **overloaded** (generic "bars of my cadence" for 74 directives vs 365 literal daily bars for one) — recorded, not changed here.

🤖 Closed by primary — 2026-10-08. Handoff: `2026-10-08-1013-cadence-guard-real.md`
