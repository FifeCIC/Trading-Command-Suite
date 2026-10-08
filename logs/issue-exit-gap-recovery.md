## Owner direction (2026-10-08)

> *"I'm not reading something that stands out as a long term fix — the whole 'Toolbox → History tab → right-click → Period → Custom' falls way outside the automation this app is designed to offer. How about we implement an optional prompt with button where/when there is a gap in the information and the user feels they need that data OR SOMETHING"*

**R48's manual terminal ritual is rejected as the fix.** The app must own this: detect the gap, offer a button, attempt recovery, and report honestly.

## The gap it addresses

44 closed broker-3 trades (2026-09-16 → 10-02) have no readable exit record — `closeReason=broker:unknown`, snapshot price/pnl — because the Pepperstone terminal serves only ~3 days of deals (measured: 17 deals for a 30-day request, oldest 10-05; broker 2 returns 482, oldest 09-08). No app-side code can price a close whose deal the terminal will not return.

## Design

| Layer | What |
|---|---|
| **Bridge** | `POST /history/recover` — re-requests the range, plus **per-position** `history_deals_get(position=…)` for each missing ticket, with bounded retries/delay; returns exactly what became visible (`perPosition`, `recovered`, `stillMissing`). This is the ONE lever the app has over terminal-side history, and the endpoint MEASURES whether it works before any UI promises anything. |
| **API** | `GET /api/providers/exit-data/gaps` → the current gap set (count, by symbol, samples). `POST /api/providers/exit-data/recover` → runs the bridge recovery for the gap tickets, re-derives reason/price/pnl/closedAt for whatever became visible (the `allowClosed` finaliser path, with `broker:unknown` treated as re-derivable since it is the ABSENCE of evidence), returns `{requested, recovered, stillMissing}`. |
| **UI** | A compact notice + button, rendered ONLY when gaps exist: "N closed trades have no recorded exit — [Try to recover]". After an attempt: honest counts; if nothing was recovered, one muted line says the broker terminal does not serve it and the manual step is the last resort. Where it sits: the trading desk (Mt5TradingPage) for v1. |

## Rules this must respect

- **Optional, not nagging** — visible only when a gap exists; never blocks anything.
- **Honest outcomes** — "recovered 0 of 44" must render as plainly as "recovered 12 of 44"; no fake progress.
- **One mechanism** — the recover path reuses the repair finaliser; it does not grow a second pricing pipeline.
- **Measured before promised** — the bridge endpoint is probed against the real 44-row gap BEFORE the UI text commits to what the button can do.

## Not in scope

- Automatic/scheduled recovery runs (note for later: the repair could re-attempt on a timer once one working button proves the path).
- Replacing R48 entirely — if the probe shows the terminal genuinely will not serve the data to any programmatic call, the manual step remains the documented LAST resort and the prompt says so.
