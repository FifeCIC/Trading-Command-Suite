**Live recurrence measured 2026-10-07 — the running pair is producing these failures right now.**

| Time (UTC) | What happened |
|---|---|
| 09:44:04 | A + B both filled (two XAUUSD positions, same entry 4119.77) |
| 09:45:57 | **B's row closed `exit-unknown` (position vanished; pnl NULL)** — the arms merge on the netting account and the second leg's record is destroyed ~1m53s after opening |
| 09:46 / 10:05 | Further A fills → each closed `exit-unknown` within ~2 min. **Three XAUUSD rows lost their P&L today this way** — caught by `validate-pnl-integrity.cjs`'s recurrence check ("the exit-unknown fault returning") |
| 09:48–10:38 | **~64 rejected rows in ~50 minutes** — the runner re-fires A+B every ~2 minutes and the broker refuses almost all; every attempt is recorded and none is rate-limited |
| 12:30:35 | The original A row closed at the broker for **−134.71** — one row carrying a merged two-leg position |

**Two things this proves, both measured:**
1. **The experiment cannot hold its arms on a netting account** — #965's blocker 3, happening live: B's record is destroyed, and the surviving row reports the merged position's whole P&L.
2. **The runner's cost is unbounded** — it re-fires every ~2 minutes through an all-reject window; the duplicate guard that would stop a bot does not apply to it.

Measured alongside (same minute): while the pair holds, `Gold Day-Trade M15 (copy)` is duplicate-blocked (09:44:04.740).

**Ask:** decide this pair's fate — stop it, or keep it and fix under this issue (guards + per-leg bookkeeping before it runs again). Per #965 the measurement path is the backtest.
