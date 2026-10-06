## The `b50727ee` run is healthy — and its `composite=0` was a CLOSED MARKET, not a broken runner

Follow-up measurement after restarting the run at 20:36Z on 2026-10-06. No code changed.

### The open question

The restarted run produced `decision_log` rows for both arms with `composite=0`. Two candidate explanations, with opposite responses:

1. the runner is skipping silently — a defect, fix the runner;
2. the runner is scoring a market that is shut — no defect, wait.

### Answer: 2, and the runner is fine

Rows landed at tick 16 (20:37:28Z) for both arms:

| strategyId | decision | compositeRaw | `signal` |
|---|---|---|---|
| `ab-test:A` | SCORED | 0 | **NO_DATA** |
| `ab-test:B` | SCORED | 0 | **NO_DATA** |

`NO_DATA` is **not HOLD**, and that distinction is the whole answer. `protocol-gating.service.ts`
L1024 returns it when `!hasDirectionalEvidence` — a tick with no directional evidence at all,
deliberately distinct from a real zero so a phantom zero cannot read as a neutral reading (**#758**).
The runner is not scoring 0; it is finding nothing to score.

An earlier hypothesis in my own handoff — that `runAbTest` skips silently at
`if (!bars || bars.length < 20) continue;` — is **refuted**. That line is not the cause. There is
nothing to change there.

### Why there was nothing to score — gold's session had ended

| Measure | Value |
|---|---|
| XAUUSD newest 1m bar | **19:59Z** (47 min stale at measurement) |
| XAUUSD newest 15m bar | 19:45Z |
| EURUSD / GBPUSD / EURJPY / US30 / BTC / ETH newest 1m bar | 20:42Z — **4 min** |
| The test's `startAt` | 20:36Z |

**XAUUSD is the only symbol that stopped, and the test was started 37 minutes after gold closed.**

Corroborating gaps in the same 1m series, from `marketbar`:

| Gap start | Resumes | Minutes |
|---|---|---|
| 2026-10-06 19:59 | 2026-10-06 22:00 | 121 |
| 2026-10-05 19:59 | 2026-10-05 22:00 | 121 |
| 2026-10-01 20:58 | 2026-10-01 22:00 | 62 |

That is gold's daily session break (01:00–23:00 server = **22:00–20:00 UTC** at GMT+3), not a feed
fault. Three independent checks agree:

- the bridge's own `/candles` for XAUUSD returns nothing past 19:59 — storage is faithful to source;
- `BarRefreshService` is healthy (`running`, `mode: live`, last run 20:42:54Z, 54,165 rows upserted
  across 53 symbols);
- XAUUSD is **not** in the refresh service's `starvedSymbols` list.

⚠️ One inference had to be retracted. I first read a live-looking quote (XAUUSD `bid 4169.30`,
`timestamp 20:45:54Z`) as proof the market was open. **It is not proof.** The bridge's `/quote`
handler returns `'timestamp': utc_now_iso()` — a timestamp generated at *request* time, not MT5's
tick time — and `last` was exactly the 19:59 close (4169.30), i.e. a frozen tick re-stamped. A quote
endpoint that manufactures its own freshness cannot be used as evidence of a live market.

### Consequences for this experiment

- **The runner needs no fix.** It will evaluate again when gold reopens at **22:00Z**.
- **The evidence window is the gold session only.** The threshold arithmetic below stands, and the
  usable minutes per day are fewer than a 24-hour reading implies.
- **The verdict is safe.** `computeResults()` reads `trade` rows filtered by `abTestId` +
  `pnlInvalid: 0` + `status !== 'rejected'`, and attributes by `trade.abTestSide`. It never reads
  `decision_log`, so `NO_DATA` rows cannot inflate or bias a result (#931, #1039).
- **A `NO_DATA` tick is persisted as decision `SCORED`.** #758's own note says callers may "skip this
  rather than storing it as a result", so this caller has not adopted it. Recorded here as a
  **labelling note, not an issue** — the information is not lost (`signal=NO_DATA` is on the row) and
  no verdict reads it. Per the issue-creation rule in `development-status.instructions.md`: no
  measured cost on a money path, so it does not earn an issue.

### The window requirement, unchanged and re-stated

Measured over 14 days of XAUUSD `xau-speed-m15` scores:

| Threshold | Clears | Rate |
|---|---|---|
| ≥ 10 (variant) | 2437 / 3490 | **69.8%** |
| ≥ 55 (control) | **374 / 3490** | **10.7%** |

Not uniform — **zero clears on 5 of 11 sampled days**. ⚠️ A 3-day window reads min 8 / max 31 and
would wrongly conclude 55 is unreachable; 7-day and 14-day read max 96 / 128.

⚠️ `POST /:id/stop` logs **accumulated** P&L (`control=-117.04 variant=-121.69` are the
**2026-09-30** figures), so a short run *looks* like it produced a result. Read `/results`, not the
stop line.
