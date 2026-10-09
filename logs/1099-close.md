## Pre-close checklist — #1099

**Root cause (measured):** one maturation sweep of 250 rows ran per 15 minutes — a ceiling of ~24k/day against ~31k/day inflow — so the frontier FROZE at 2026-10-06 while ~90k rows queued. Every trade evaluation read stale outcomes. The sweep's own report line never reached `tcs-<date>.log` (Nest logger → stdout only), which is why nobody could see the backlog.

### The fix

- `computeOutcomes()` is now a **tick-level drain**: `@Cron('*/5 * * * *')`, in-flight guarded, up to **6 × 250-row passes** per tick (`MATURATION_MAX_ROWS_PER_TICK = 1500`) within a 150s budget, 5s yield between passes (`setTimeout`, unref'd).
- `MATURATION_BATCH` stays **250** — deliberately: a 1000-row batch once produced ~2,000 serial queries over 57s and starved the 13-connection pool.
- The summary line (`visited / filled / finalised / passes / backlog A -> B`) now goes to **BOTH** `this.logger.log` AND `this.syslog?.info('OutcomeTrackerService', …, 'scoring')` — the canonical `nest/logs/tcs-<date>.log`.

### Evidence (live, canonical log)

```
22:00:40  tick: visited 1500, filled 1500, finalised 1500 in 6 pass(es) — backlog 75245 -> 73756
22:10:41  tick: visited 1500, filled 1500, finalised 1500 in 6 pass(es) — backlog 73809 -> 72309
22:15:41  tick: visited 1500, filled 1500, finalised 1500 in 6 pass(es) — backlog 72327 -> 70827
```

- Backlog trajectory: **90,011 at deploy → ~70,827 now** (~19k drained), on the 5-minute cadence.
- Frontier moved off 2026-10-06 (17:54 → 18:47 observed at deploy time).
- Specs: **14/14** across the tracker suites; the saturated-batch path driven with `maturationYieldMs = 0`; clean process exit.

### What this does NOT claim

- Drain rate (1,500/tick ≈ 432k/day ceiling) exceeds daily inflow (~31k) by design, but the **queue is not yet empty** — it is now converging at a measurable rate rather than frozen. That is the acceptance: *can converge*, demonstrated live.
- `MATURATION_BATCH = 250` and the yield budget are **deliberately unchanged from the fix** (pool health); do not raise them to clear the backlog faster without re-measuring pool impact.
