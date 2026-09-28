## What is already built (uncommitted — verify before rebuilding)

`ExitConsensusService` — a dedicated evaluation of **open** positions, separate from entry scoring. It exists because every mechanism that could have protected an open position was measured inert or advisory on 2026-09-28:

- the 5 exit directives live in `mt5-technical-core-v1`, which is `active = 0` — they have **never run**
- `simTsl` records a decision point and places/moves nothing (by design)
- `ExitSignalService` is advisory, was dark (a ticker passed where a `symbolId` is required — fixed), and reads the **Trading 212** book rather than the 40 bot-managed MT5 positions

| File | State |
|---|---|
| `nest/src/modules/scoring/exit-consensus.service.ts` | new |
| `nest/src/modules/scoring/exit-consensus.controller.ts` | new — `GET /api/scoring/exit-consensus` |
| `nest/src/modules/scoring/scoring.module.ts` | service + controller registered |
| `nest/scripts/validate-close-attribution.cjs` | allowlist entry **with a reason** (the build gate flagged the file; it only reads) |

⚠️ **All of the above is UNCOMMITTED.** It is advisory only — it places nothing, moves no stop, closes nothing. Acting on a verdict is a **maths change** and needs a copied configuration and a monitored comparison first (`maths-change-requires-a-b.md`).

## 🛑 The blocker — one change is UNVERIFIED and may have broken the verdicts

To fix the exit directives being fed 5m bars when they declare `minTimeframe` of D1/H1/M15, each directive was switched to fetch bars at its **own declared cadence**. The suitability registry spells those `D1`/`H1`/`M15`; `marketbar.timeframe` is keyed `1d`/`1h`/`15m`.

**The wrong key returns an empty array and no error.** Measured live: every directive was skipped and `conviction` collapsed to `NO_DATA` on all 9 open positions — a worse failure than the mismatch it was fixing.

A translation (`toStoreTimeframe()`) was added. It typechecks (`tsc` exit 0) and the build was launched, but **the change was never confirmed against the running endpoint** because the terminal stopped returning fresh output.

**First action: `GET /api/scoring/exit-consensus` and read `barsTimeframe` on each verdict.** Populated = fixed. Still absent or `NO_DATA` = the fix did not land, and the `action` field is currently meaningless.

⚠️ **Correction to a claim made in that session:** an earlier statement that *"`market_bar` holds no D1/H1/M15 bars for these symbols"* was **false**. That table does not exist; the real table is `marketbar`, and it holds 15m/1d/1h/4h/5m/1m for both XAUUSD and GOOGL. The vocabulary mismatch was the sole cause.

## Second action — the owner's explicit ask, not started

> *"alright it makes sense to do that and have a page that I can review exiting on"*

Point the **Exit Signals page at the bot book.** Today `GET /api/portfolio/exit-signals` reads the **Trading 212** book through `PortfolioService`, which is a data-import concern. The owner's direction (2026-09-28) is explicit: *"I don't want any Trading212 bot activity going forward. Only data import and updates on the status of the portfolio."*

Files: `src/pages/ExitSignalsPage.jsx`, `src/core/view-meta.js` (api: `GET /api/portfolio/exit-signals`).

## Honoured constraints

- **Trailing stop must TIGHTEN on profit-decay, never relax.** A HOLD with profit open is a give-back risk.
- Trading 212 excluded from all bot activity.
- The peak is **derived from bars since `openedAt`**, not remembered — that survives restarts and sidesteps the ticket-namespace mismatch in **#1014** (an in-memory watermark keyed on `trade.brokerTicket` would be wrong for scale-ins).

## Acceptance criteria

1. `GET /api/scoring/exit-consensus` returns a verdict per open position with `barsTimeframe` populated.
2. `conviction` is not `NO_DATA` for a symbol whose `marketbar` rows exist.
3. The Exit Signals page reads the bot book, not Trading 212.
4. A test asserts the endpoint returns an assessment for a known-open position — the "does it still work" guard, not just "does it compile".
