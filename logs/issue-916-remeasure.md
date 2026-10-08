## Re-measured 2026-10-07 — the batch-closer STOPPED on 10-02 · the guardian is NOT the winner-truncator · the shortfall is structural

### 1. The external batch-closer has not acted since 2026-10-02

`broker:terminal` closes by day: **daily 1–13 every active day from 09-11 → 10-02 … then ZERO for 10-03 → 10-07** (five days). Last batch: 10-02 (3 closes: GOOGL, GBPUSD, AUDJPY). Before it: 12 on 09-29, 12 on 09-30, 6 on 10-01.

Closes continued every day since (10-04: 3 · 10-05: 7 · 10-06: 7 · 10-07: 17) — labelled `system:time-stop` / `broker:unknown` / `broker:sl`, and none batched in the same second through the terminal channel. Recorded neutrally: it stopped the same day the 10-02 diagnosis was published; **coincidence or cause is NOT asserted**. The owner question is filed as **R46** in the review queue.

### 2. The guardian is NOT truncating winners — isolated, not asserted

Winners split by whether the position ever carried a `stop_adjustment`. ⚠️ The join must go through `brokerTicket` — `trade.ticket` is NULL on these rows and a join on it matches **0 of 274**:

| group | closed | winners | avg %ofTP (winners) | avg hold (winners) |
|---|---|---|---|---|
| **guardian adjusted the stop** | 163 | 74 | **18.5%** | 13.0h |
| no adjustment | 111 | 50 | **14.5%** | 21.9h |

Adjusted winners captured **more** of their target and exited **sooner** — the opposite of the 09-23 hypothesis. Row 21's *"guardian tightening is the suspect"* is **not supported**; amended in the register today. ⚠️ Association, not a randomised comparison — but the direction refutes "guardian tightening causes the shortfall", so it must not be used to justify an A/B without a new measurement.

### 3. The truncation is universal and structural

274 closed valid-P&L trades (90d) — winners capture a **median 11.1% of their own TP distance**:

| actor | closes | win% | med %ofTP (its winners) |
|---|---|---|---|
| `broker:terminal` (the stopped batcher) | 93 | 71 | 9.2% |
| `system:time-stop` (ours, 12h deadline) | 81 | 35 | 12.3% |
| `broker:unknown` | 50 | 28 | 18.4% |
| `broker:sl` | 37 | 16 | 5.9% |
| `broker:tp` | **1** | 100 | 100% |

No actor gets winners meaningfully toward target — and with the batcher now gone, winners closed by **our own time stop** still capture ~12%. Hold histogram for time-stop closes: min 12.0h, median 15.8h, 69 of 81 inside 12–24h.

**So the mechanism is scale, not villainy:** targets (`tpPct` 1.0–2.0%) sit ~10× the favourable excursion these instruments deliver inside a 12–24h hold. That is a **calibration question for the strategy-by-strategy review** — maths, A/B-gated, never an in-place edit.

### Item status

1. ✅ close-reason recording + surface — shipped (v0.51.2/.3); re-verified in today's data.
2. ⚠️ mechanism: reclassified by measurement — the external actor is **inactive since 10-02** (R46 asks the owner); what remains truncating winners is the structural scale above, not the guardian.
3. ❌ payoff ratio in the bot rating — still **#894's** work; nothing here implemented it.

Nothing in scoring, maths or config was changed by this comment. Register row 21 amended; R46 filed; the earlier measure scripts (`logs/measure-916*.cjs`) rerun unchanged.
