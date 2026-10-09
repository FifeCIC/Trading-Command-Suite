## Pre-Close Verification — Option A executed: the stat surface is DELETED, not re-implemented

> ⚠️ This issue has no acceptance criteria. Adding minimal verification:

- [x] **Code is live — services restarted.** `build:api` green; API restarted (health 200 on 0.123.0, db connected).
- [x] **API returns real data — curl tested** (2026-10-09 21:02Z):
  - `GET /api/journal/stats` → **404** (route deleted — the four fabrications and the `"NaN%"` win rate can no longer be served by anything)
  - `GET /api/journal/entries` → `[]` (unchanged: honest empty stub, feature stays parked)
  - `GET /api/scoring/edge/pnl` → 200, canonical: 313 valid trades, `totalPnl −1144.63`, reliability bands — the surface consumers point at (register row 76)
- [x] **Build passes.** Full `build:api` incl. all prebuild validators; `generate-free-map --check` fresh; `verify-view-meta-routes` green (12/12 resolved, 0 nav leaves without metadata).

## What actually changed

| File | Change |
|---|---|
| `nest/src/modules/journal/journal.service.ts` | `JournalStats` interface + `getStats()` **deleted** (the four hardcoded fabrications and the 0/0 `"NaN%"`). `analyzeTrade`'s three **unreachable** fabricated history claims ("62% of your losing trades", "78% historical win rate", "60% win rate in your history") **removed** too — they were one wiring change away from becoming reachable; the dependency on `getStats()` is gone. |
| `nest/src/modules/journal/journal.controller.ts` | `@Get('stats')` **deleted** with a marker explaining why a re-add would be a second P&L implementation. |
| `src/core/view-meta.js` + regenerated `src/editions/view-meta.free.js` | Trade Journal's declared API list no longer names the dead route. |

## Deliberately unchanged

- **The note/analysis features remain parked** (per the issue's own option A): `getEntries()` → `[]`, `addNote` → miss, `analyzeTrade` → "Trade not found." — all now honest, none fabricating. They need the entries feed first.
- **No second P&L implementation.** The journal module contains no stat computation at all now; `/api/scoring/edge/pnl` (PnlReport — quarantine-aware) is the only realised-P&L surface.
- The `TradeJournalPage` was never a consumer of the dead route — it reads `/api/trading/trade-history` directly (verified before deleting).

## Deferred

- **Entries feed + note/analysis features** — still stub-backed; tracked as the issue's parked remainder (needs a Prisma-backed entries source, separate work).
