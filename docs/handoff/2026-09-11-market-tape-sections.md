---
date: 2026-09-11
area: ui
type: feature
---

## What Changed

Expanded the market tape with four new optional sections (latest score, latest profit taken,
latest loss taken, recent order) and news headlines with working article links; moved all tape
configuration into Settings and made the ⚙ button navigate there, removing the tape's private
preference store.

## Files Changed

- `src/components/MarketTape.jsx` — 3 new sections; fixed a silently-broken trade section;
  prefs moved from private localStorage to `usePreferences`; one-shot legacy migration;
  gear now navigates to `/settings?section=market-tape`; `ALL_SECTIONS` exported;
  **seamless marquee (8 copies, `-100%/N`) and user-configurable scroll speed**
- `src/core/hooks/usePreferences.js` — 12 `tape*` keys added (server-synced)
- `src/pages/SettingsPage.jsx` — new `Market Tape` section rendering from the exported
  `ALL_SECTIONS`; `?section=` deep-link scroll; **Scroll speed control**
- `src/components/market-tape.css` — removed the dead popover rules; keyframe now
  `translateX(calc(-100% / var(--mkt-tape-copies)))`; reduced-motion handling

## Bugs fixed (both found while building, neither reported)

1. **The `Recent Trade` section could never render.** It called
   `/api/providers/mt5/history?limit=1` and read `data.deals[0].profit`. That endpoint returns
   `{ orders: [...] }` and MT5 orders carry **no profit field**, so `deals` was always undefined
   and the section silently produced nothing when enabled. Now reads
   `/api/trading/trade-history?status=closed`, which has a real `pnl`.
2. **Two competing preference stores.** The tape owned `localStorage: tcs:market-tape` while
   `usePreferences` held a server-synced store. A section could be toggled in one and not affect
   the other — a control that silently does nothing. Unified into `usePreferences`; the legacy
   key is migrated once then deleted so existing choices are not reset.

## Capability Map Entry

- **name:** Market Tape Configurable Sections
- **persistence:** config
- **uiSurfaces:** 2
- **pipeline:** none
- **completion:** complete

## QA Test Entry

- **area:** UI
- **name:** Market tape sections reflect Settings changes from one store
- **procedure:** Open Settings → Market Tape, toggle "Latest Score" Off, navigate to Ladder
- **expected:** The Score section disappears from the ticker; no reload needed and no second
  configuration UI exists. ⚙ on the tape lands on `/settings?section=market-tape`.

## Architecture Framework Entry

- **section:** routes
- **summary:** Market Tape sections — 11 optional ticker sections driven entirely by
  `usePreferences` (`tape*` keys). New sections (Score/Profit/Loss) read
  `/api/scoring/ranked` (`ranked[]`, fields `ticker`/`signal`/`score`/`maxPossibleScore` — the
  percentage is derived, not returned) and `/api/trading/trade-history?status=closed`
  (`pnl` + `closedAt`). Profit/loss pick the newest matching closed trade. Config lives in
  Settings → Market Tape; `ALL_SECTIONS` is exported from `MarketTape.jsx` so the settings list
  and the render list cannot drift. Files: `MarketTape.jsx`, `usePreferences.js`, `SettingsPage.jsx`.

## Not done (deliberate)

- **The four ideas were verified achievable from existing endpoints**, so no new API work was
  needed. Profit/loss use the `Trade` audit trail, not a purpose-built realised-P&L feed.
- **`latest score` derives its percentage** (`score / maxPossibleScore`). The endpoint returns no
  percentage field; if one is added later this is the place to use it.
- **Pre-existing lint debt cleaned where seen:** `SettingsPage.jsx` had `setMany` and `defaults`
  destructured but unused (present in HEAD before this change). Both removed; `resetPrefs` was
  genuinely used by the "Reset to Defaults" button and kept — verified still working
  (`pollingInterval` 99 → 30 on click).
  ⚠️ **The repo still has ~133 lint errors across other files** (251 problems total). They were
  NOT swept, because that is unrelated to this change and would bury the diff.
