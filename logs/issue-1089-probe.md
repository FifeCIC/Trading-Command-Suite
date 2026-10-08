## The 44-row residual — MEASURED: it is broker-3 TERMINAL history depth, not an app defect

Probe, run as flagged in the previous comment (raw saved to `logs/bridge-history-30d.json`):

| bridge | `/history/deals?days=30` returns | oldest deal |
|---|---|---|
| `:5000` (broker 2, MetaQuotes) | **482 deals** | **2026-09-08** — the full window honoured |
| `:5001` (broker 3, Pepperstone) | **17 deals** | **2026-10-05** — truncated to ~3 days |

The three sampled residual rows (`GER40 89649760` closed 09-16, `UK100 91105906`, `FRA40 91106221` both 09-23) have **no deals in the response at all**, while the request asked for 30 days and broker 2 answers it fully.

**So it is NOT an app bug and NOT the fan-out:** the Pepperstone terminal itself currently exposes only ~3 days of trade history to the bridge. No code path can price a close whose deal the terminal will not return.

### The unblock (owner action, ~2 minutes)

1. Open the **Pepperstone MetaTrader 5** terminal (`MT5_PATH_3`).
2. **Toolbox → History tab → right-click → Period → Custom**, set it to cover **2026-09-15 → now** (this makes the terminal download the older deals from the server).
3. Ask for the repair to be re-run:

```
POST http://localhost:3201/api/providers/repair-pnl?provider=mt5&limit=250
```

If the terminal now holds the deals, the fan-out reads them and the residual rows resolve with their real reasons, prices and times — the same path that already repaired 4 of the 48 and every FX row on broker 2. If they still do not appear, the verdict changes to "not on this server's history at all" and the `broker:unknown` rows stand as the honest record.

⚠️ The `closedAt` re-stamp defect (#1091) is fixed and deployed, so a re-run is now safe for the rows it cannot price.
