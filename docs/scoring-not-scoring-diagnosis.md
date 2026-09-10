# Why SPY / OIL / VIX / BTC aren't scoring — corrected findings

**2026-09-10, second pass.** The first pass (#757) concluded "endpoint truncation". That
conclusion was **wrong** — the corrected root cause is below. #757 is still a real, smaller bug,
but it was not what was stopping these protocols.

## Correction: the data is NOT there

My earlier claim was that the loop was scoring `spy-speed-v1` and the API was hiding it. The
opposite is true. `MAX(timestamp)` per protocol from the `Score` table:

```
forex-session-v1  11:53:49   <-- writing now
gold-macro-v1     11:53:47   <-- writing now
qqq-day-v1        11:53:47   <-- writing now
spy-day-v1        11:53:47   <-- writing now
xau-speed-{m5,m15,1h,4h}  11:53:21   <-- writing now
--------------------------------------------------------------
ftse-speed-v1     08:16:11   stopped 3.5h ago
xau-speed-v1      07:57:00   stopped 4h ago
spy-speed-v1      07:56:59   stopped 4h ago   <-- the one the user reported
vix-spike-v1      07:56:59   stopped 4h ago
qqq-speed-v1      07:56:59   stopped 4h ago
vix-short-v1      2026-09-08   stopped 2 days ago
cac-speed-v1      NULL        never wrote a score
dax-speed-v1      NULL        never wrote a score
```

The endpoint is not truncating them — **they have not written a score since ~07:57**. The API is
correctly reporting the newest rows it can find.

## The real cause: `rawMax: 0`

The last rows `spy-speed-v1` wrote:

```
ticker  value  timestamp              breakdown (truncated)
SPY     0      2026-09-10 07:56:59.509  {"rawMax": 0, "signal": "HOLD", "source": "protocol-gating",
                                         "breakouts": {"risk": [{"name": "Liquidity Check", "score": 93, ...}]}}
```

`rawMax: 0` means the engine computed a **maximum possible score of 0** for the protocol, so the
normalised percentage is `x / 0` and the result collapses to 0 / `HOLD`. A protocol whose maximum
is zero can never produce a meaningful signal — which is exactly what `spy-day-v1` shows too
(persistent `composite=0`, `HOLD`).

Two distinct failures follow from one arithmetic condition:

1. **Protocols with a bot** (`spy-day-v1`, the four `xau-speed-*`) keep writing `composite=0`
   rows every tick — the loop runs, the maths yields nothing, so the card shows a fresh timestamp
   and a 0.
2. **Protocols without a bot** (`spy-speed-v1`, `vix-spike-v1`, `qqq-speed-v1`) stopped writing
   entirely after ~07:57.

## Separately: the loop reports "scoring" for protocols that write nothing

`protocol_score_status` — the app's own answer to "is this protocol scoring?" — says:

```
spy-speed-v1   scoring  symbolsResolved=2  symbolsScored=2   <-- last write 07:56 (4h ago)
vix-spike-v1   scoring  symbolsResolved=1  symbolsScored=1   <-- last write 07:56
qqq-speed-v1   scoring  symbolsResolved=2  symbolsScored=2   <-- last write 07:56
ftse-speed-v1  scoring  symbolsResolved=1  symbolsScored=1   <-- last write 08:16
cac-speed-v1   scoring  symbolsResolved=1  symbolsScored=1   <-- never wrote at all
dax-speed-v1   scoring  symbolsResolved=1  symbolsScored=1   <-- never wrote at all
```

…and the loop log confirms `17 of 17 active protocols ready for scoring`. So the operator-visible
health signal is misleading: it reports `scoring` from *intent* (the protocol was eligible this
tick), not from *evidence* (a score row was written). That gap is why this looked like a UI
problem for four hours.

## OIL and BTC: absent entirely

`oil-speed-v1` — **`active = false`**, last score 2026-08-13.
`btc-speed-v1` / `btc-scalp-v1` — **`active = false`**.

**VIX is not a data problem:** `VIX` has 5,430 bars, newest **2026-09-10 11:50**. But `USOIL`,
`UKOIL`, `NATGAS`, `BTCUSD` and `TECH100` return **no rows** in `marketbar` (BTCUSD's last bar is
2026-07-18), so an enabled OIL/BTC protocol still could not score.

## What to fix

1. **`rawMax: 0` in the protocol-gating path** — the primary bug. A protocol with directives
   configured must not compute a zero denominator; if it legitimately has no included directives
   it should report `no-data` / a named reason rather than writing `HOLD` at 0 forever. Trace next
   in `protocol-gating.service.ts` where `rawMax` is derived.
2. **`protocol_score_status` should require evidence.** A protocol reporting `symbolsScored > 0`
   while having written no `Score` row in N minutes is `stalled`, not `scoring`. That one change
   turns a 4-hour silent outage into a visible badge.
3. **Bar coverage for `USOIL` / `UKOIL` / `NATGAS` / `BTCUSD` / `TECH100`** — no rows in
   `marketbar`.
4. **`cac-speed-v1` / `dax-speed-v1`** report `scoring` with a resolved symbol but have never
   written a score row — same evidence gap as (2). Both also carry the config warning
   `Directive "session-open-effect" appears in more than one group — double-counted`.

## ⚠️ The two stores disagree

`score_snapshot` (what `rankFromDb` and the Ladder read) has rows for `spy-speed-v1` at **11:41**,
while the `Score` table — which `/api/scoring/runs` reads — stopped at **07:56**. Whichever is
authoritative, one of them is stale, and the UI reads a mixture of both. Establish which before
trusting either.

## Re-checking this

```sql
-- is a protocol actually writing scores? (the honest signal)
SELECT JSON_UNQUOTE(JSON_EXTRACT(breakdown,'$.protocolId')) AS protocolId,
       MAX(timestamp) AS lastWritten
  FROM Score GROUP BY protocolId ORDER BY lastWritten DESC;

-- what does the loop claim?
SELECT protocolId, state, symbolsResolved, symbolsScored, lastTickAt FROM protocol_score_status;

-- do the symbols have fresh input bars?
SELECT s.ticker, COUNT(*), MAX(m.timestamp) FROM marketbar m
  JOIN Symbol s ON s.id = m.symbolId
 WHERE s.ticker IN ('SPY','SPX500','TECH100','QQQ','VIX','USOIL','BTCUSD')
 GROUP BY s.ticker;
```

⚠️ The bar table is `marketbar`, not `bar`.
