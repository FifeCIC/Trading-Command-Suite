# Why SPY / OIL / VIX / BTC don't score on the Ladder

**Investigated 2026-09-10** against the running stack (API v0.6.3, DB connected, MT5 bridges on
5000/5001). Everything below is from live data, not from reading intentions off the code.

## TL;DR — there are three different causes, not one

| Protocol family | Status | Cause |
|---|---|---|
| `spy-speed-v1`, `vix-spike-v1`, `qqq-speed-v1` | **Scoring, but invisible in the UI** | `/api/scoring/runs?limit=200` truncates them out (pagination by minute-bucket) |
| `spy-day-v1` | Scoring, visible, **always zero** | `composite = 0`, `signal = HOLD`, `signalPct` 0–37.5 — a scoring-quality problem, not a wiring problem |
| `oil-speed-v1`, `btc-speed-v1`, `btc-scalp-v1`, `oil-supply-v1` | **Switched off** | `active = false` in the protocol registry — no run is intended |
| `vix-short-v1` | Scoring, but stale (2026-09-08) | SHORT_ONLY; last snapshot 2 days old |

## Evidence

### 1. The loop is scoring them

`protocol_score_status` (written by the automation loop each tick) says:

```
spy-speed-v1   scoring  symbolsResolved=2  symbolsScored=2  lastTickAt=11:40:30
qqq-speed-v1   scoring  symbolsResolved=2  symbolsScored=2
vix-spike-v1   scoring  symbolsResolved=1  symbolsScored=1
vix-short-v1   scoring  symbolsResolved=1  symbolsScored=1
spy-day-v1     scoring  symbolsResolved=1  symbolsScored=1
```

And `score_snapshot` holds real history: `spy-speed-v1` 6,460 rows, `vix-spike-v1` 6,960,
`qqq-speed-v1` 6,894, `vix-short-v1` 3,958, `oil-speed-v1` 2,220, `btc-scalp-v1` 2,402.

### 2. But the runs endpoint only returns 8 protocols

`GET /api/scoring/runs?limit=200&groupBy=protocol` → `total: 2963`, and the 200 most recent runs
belong to exactly eight protocols:

```
xau-speed-4h 25 · xau-speed-1h 25 · xau-speed-m15 25 · xau-speed-m5 25
forex-session-v1 26 · gold-macro-v1 26 · qqq-day-v1 24 · spy-day-v1 24
```

`spy-speed-v1` is **absent from the response entirely** even though the loop reports it scoring
right now. **Root cause** (`nest/src/modules/scoring/score-history.service.ts`):

- a run = one group of `Score` rows bucketed to the minute
  (`ts.setSeconds(0,0)`, key = `${minuteIso}::${protocolId}`);
- the query takes the newest **10,000 rows**, then groups, then slices the page
  (`allRuns` is sorted newest-first, then `slice(offset, offset + pageSize)`).

Every tick writes one bucket per protocol per symbol. `forex-session-v1` alone writes **7 symbols
× 1/minute = 420 rows per tick**, so 10,000 rows covers only ~24 minutes of recent data. With ~17
protocols × 25 min ≈ 425 buckets before pagination, a `limit=200` request fills up with the
families that score the most symbols per minute, and the low-volume protocols are cut off before
the slice. Their scores are in the DB; the endpoint never reaches them.

**This is the same root cause as the Ladder card in `2026-09-10-ladder-score-join.md`** — that fix
(protocol-family fallback) only worked because `spy-day-v1`/`qqq-day-v1`/`gold-macro-v1` happen to
sit inside the returned 200. `spy-speed-v1` cannot be fixed client-side: the data never arrives.

### 3. `spy-day-v1` scores, but always zero

Latest snapshot rows:

```
SPY  spy-day-v1  composite=0  trading_signal=HOLD  signalPct=0     11:41:51
SPY  spy-day-v1  composite=0  trading_signal=HOLD  signalPct=37.5  11:27:46
```

Persistently `composite = 0` with occasional `signalPct` between 0 and 37.5. So the card can show a
timestamp and still have nothing meaningful to say. `signalPct` being populated while `composite`
is 0 is worth a look in its own right (they should agree — see the gating layer).

### 4. `oil-speed-v1` / `btc-*` are deliberately inactive

```
oil-speed-v1    active=false  symbols=[USOIL, UKOIL, NATGAS]
btc-speed-v1    active=false  symbols=[BTCUSD]
btc-scalp-v1    active=false  symbols=[BTCUSD, BTC-USD, ETHUSD, ETH-USD, SOLUSD]
oil-supply-v1   active=false  symbols=[USOIL]
```

`oil-speed-v1`'s last snapshot is **2026-08-13** and `btc-speed-v1` holds just 5 rows — consistent
with being switched off, not broken. Note their last writes land around 09:20 on 2026-09-10, so
they were briefly active this morning before being turned off.

## What to fix, in order

1. **Server** — `/api/scoring/runs` must return the newest N runs *per protocol*, not the newest
   rows globally. Candidates: query `score_snapshot` (already one row per protocol×symbol per
   tick, and it is what `rankFromDb` uses), or paginate per protocol, or push the `limit` into SQL
   with a window function instead of slicing in JS after a 10k row cap.
   **Until this is fixed, no client-side change can show SPY Speed / VIX / QQQ Speed scores.**
2. **Server** — why `spy-day-v1` produces `composite = 0` / `HOLD` while `signalPct` varies.
3. **Registry** — confirm `oil-*` / `btc-*` are *meant* to be inactive; if so the Ladder should
   hide or badge them rather than showing a blank card.

## Useful endpoints for re-checking this

```
GET /api/scoring/gated/protocols          # active flag + resolvedSymbols per protocol
GET /api/scoring/gated/protocols/status   # merges the loop's protocol_score_status rows
GET /api/scoring/runs?limit=200&groupBy=protocol
GET /api/scoring/runs?limit=200&groupBy=protocol&strategyId=<protocolId>   # per-protocol escape hatch
```

`protocol_score_status` (MySQL) is the loop's own reason code per protocol — the fastest way to
answer "is this protocol scoring?" without guessing.
