---
date: 2026-09-10
area: trading
type: bugfix
---

## What Changed

Fixed the reported sign inconsistency in position P&L (XAUUSD `pnl +56.13` beside
`pnlPct −1.70%`) and the data-integrity defects behind it.

1. **New canonical P&L helper** — `nest/src/common/utils/position-pnl.ts`.
   `resolvePositionPnl()` returns a `(pnl, pnlPct)` pair that always agrees in sign:
   side-aware maths (`sell` → −1), prefers the broker amount, overrides a stale
   stored amount when the side is known, and withholds the percentage when the side
   is unknown rather than publishing a self-contradicting pair.
2. **Six long-only percentages replaced** — `mt5.adapter` (the source of every MT5
   row), `trading212.adapter`, `symbols.service.getPositionMap` (the reported
   endpoint), `portfolio-price.service`, `portfolio.service` DB fallback,
   `global-diversification.service`. The frontend already had this right
   (`PositionsTable.jsx`), so the backend was the outlier.
3. **Phantom-position root causes in `position-sync.service`** — the closure scan no
   longer hides legacy rows (`accountId NULL`), a legacy row superseded by a ticketed
   row is finalized, the closing deal is resolved from the **Trade** side (a NULL
   Position side used to select the opening deal), `closedAt` comes from the broker
   deal, and the symbol-deal fallback only runs when the window holds one lifecycle.
4. **`symbols.service` field bugs** — `getPositionMap`/symbol detail read
   `symbolTicker` and `unrealizedPnl`, neither of which exists on `Position`, so
   positions were missed and P&L always read 0.

Data repaired (broker-verified): two phantom `Position` rows deleted, two app trades
closed from real MT5 deals (XAUUSD short 4478.47 → 4403.27 = +55.49 on 2026-09-07;
AUDUSD 0.7206 → 0.72175 = +0.95). Open trades 22 → 20.

## Files Changed

- nest/src/common/utils/position-pnl.ts — NEW helper
- nest/src/common/utils/position-pnl.spec.ts — NEW (11 cases)
- nest/src/modules/providers/adapters/mt5.adapter.ts — side-aware P&L
- nest/src/modules/providers/adapters/trading212.adapter.ts — side-aware P&L + emits `side`
- nest/src/modules/providers/position-sync.service.ts — closure scan + closing-deal resolution
- nest/src/modules/providers/position-sync.service.spec.ts — 3 regression cases
- nest/src/modules/symbols/symbols.service.ts — side-aware P&L + field fixes
- nest/src/modules/portfolio/portfolio-price.service.ts — side-aware P&L
- nest/src/modules/portfolio/portfolio.service.ts — side-aware T212 fallback
- nest/src/modules/diversification/global-diversification.service.ts — side-aware P&L

## Why (theory)

A position row mixes values from two clocks: the **amount** comes from the broker at
import/sync time, while the **percentage** was recomputed from whatever price was
current when it was read. Two independent errors made them contradict:

- Direction was never part of the percentage formula. `(current − avg) / avg` is a
  long position's return; applying it to a short inverts the sign. Direction is a
  property of the position (`side`), never a property of the price move — the same
  rule the directives follow with `signalClass`.
- The projection tables (`Position`, `Trade`) were treated as an authoritative ledger
  while the broker feed is the real source of truth. Anything that writes prices
  (`price-refresh`) must not leave a dependent amount stale, and anything that reads
  the projection for a trading decision (the duplicate guard) must not trust a row
  the broker no longer reports.

Hence one helper owning direction + a sync path that can actually *close* what the
broker closed.

## Capability Map Entry

- **name:** Side-aware position P&L + broker-truth reconciliation
- **persistence:** Position / Trade tables (projection of broker state)
- **uiSurfaces:** Symbols Browser, Ladder "Details", diversified exposure, research overview
- **pipeline:** portfolio / trading
- **completion:** complete (code + data repair); stale-trade backlog tracked separately

## QA Test Entry

- **area:** Portfolio / P&L
- **name:** Position P&L sign consistency
- **procedure:** `npm --prefix nest test -- --testPathPatterns="position-pnl|position-sync"`
- **expected:** 20 tests pass; `GET /api/symbols/positions` returns no row whose `pnl` and `pnlPct` disagree in sign, and no symbol appears twice for one provider

## Architecture Framework Entry

- **section:** portfolio / position sync
- **summary:** Position P&L direction is owned by `common/utils/position-pnl.ts` (side-aware, sign-agreeing pairs). `position-sync.service` finalizes closed positions from broker deal history, including legacy rows with no accountId/ticket, and resolves the closing deal from the Trade side. Phantom rows previously also blocked the duplicate guard.
