## Diagnosed 2026-10-08 — three candidate causes eliminated by measurement, and the defect is FRA40-SPECIFIC

The issue's premise holds: **FRA40 trades, and never gets its stop managed.** What follows is what it is *not*,
so the next pass starts from a much smaller space.

### The measurement

| metric | value |
|---|---|
| FRA40 trades | **7**, all closed, 2026-09-21 → 2026-10-01 |
| FRA40 `stop_adjustment` rows | **0** |
| every FRA40 trade vs its adjustments | **0 for all 7** (`brokerTicket` 90753126 … 92748259) |

Meanwhile the mechanism is plainly working elsewhere — EURJPY **180**, AUDJPY **169**, USDCAD **144**,
EURCAD **136**, GBPCAD **133**, NZDJPY **124**, EURCHF **111**, XAUUSD **111**, USDCHF **98**, EURGBP **88**,
GBPJPY **88**, GBPUSD **72**.

### Cause 1 — eliminated: it is NOT the bridge

⚠️ **Tested because the position filled as `[broker 3]`**, and #1030/#1033 are both about reads that address one
bridge. It is a good hypothesis and it is **false**:

| symbol | brokerId | adjustments |
|---|---|---|
| US500 | **3** | **22** |
| GER40 | **3** | **14** |
| VIX | **3** | **12** |
| UK100 | **3** | **6** |
| **FRA40** | **3** | **0** |

Four instruments on the *same* bridge are managed. FRA40 is the only one that is not.

### Cause 2 — eliminated: it is NOT the bot's configuration

| bot | symbol | tf | minComposite | slPct | tpPct | baseSize | maxHold | adj |
|---|---|---|---|---|---|---|---|---|
| US SPY Speed | US500 | 1h | 9 | 3 | 6 | 0.1 | NULL | 22 |
| DAX Index Tick Scalp | GER40 | 5m | **10** | **0.4** | **0.6** | **0.1** | NULL | **14** |
| VIX Spike Short | VIX | 5m | 0 | 2 | 40 | 0.1 | NULL | 12 |
| FTSE Index Tick Scalp | UK100 | 5m | **10** | **0.4** | **0.6** | **0.1** | NULL | **6** |
| **CAC Index Tick Scalp** | **FRA40** | 5m | **10** | **0.4** | **0.6** | **0.1** | NULL | **0** |

**GER40 and UK100 are byte-for-byte identical to FRA40 on every field shown** and are managed 14 and 6 times.
Whatever differs is not in `trading_strategy`.

### Cause 3 — eliminated: it is NOT a threshold the guardian is quietly declining on

The guardian logs its refusals (`DECLINED <SYM> … outcome=below-threshold consensus=0`), so a FRA40 position it
evaluated and declined would leave a line. **On 2026-10-01 — FRA40's last trade — the entire log for that symbol
is two lines:**

```
[2026-10-01T07:47:58Z] [ORDER] [MT5Adapter]    FRA40 BUY ×0.1 → FILLED (ticket 92748259) [broker 3]
[2026-10-01T07:47:58Z] [TRADE] [TradeRecorder] [strategy] mt5 buy 0.1×FRA40 [open] …
```

…and nothing else until it closed at 08:31. **43 minutes open, zero guardian lines.** The guardian did not
*decline* FRA40 — it never considered it.

### ⚠️ What I have NOT established, stated so it is not assumed

**Why the guardian does not consider FRA40.** The remaining space is narrow — symbol resolution, FRA40's bar
coverage for the directives the guardian reads, or a name/route match that fails only for this symbol — but I
have not tested any of them, and I am not going to guess. **State the cause only with a command beside it.**

⚠️ **One confound to be aware of on the next pass:** FRA40 has held **no open position since 2026-10-01** (172
blocks on 10-07 were the portfolio/daily-loss caps, today only queue pacing), so *recent* logs prove nothing.
The evidence has to come from 2026-09-21 → 10-01.

**Not closing this issue.** The defect is confirmed and three causes are ruled out; the cause itself is still open.
