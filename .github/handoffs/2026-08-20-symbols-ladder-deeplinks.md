---
date: 2026-08-20
area: ui
type: feature
---

## What Changed

Symbols Ladder deep-linkable filter state (#631, Option D). Every filter
combination on `/scoring/symbols-ladder` is now serialized into the query
string and restored on load — bookmarkable and shareable.

URL params: `protocol`, `scope` (all|symbol|watchlist), `symbol`, `watchlist`,
`signal`, `age`, `dir`.

A/B test: `?variant=A` = legacy ladder (filters stay local, URL untouched);
`?variant=B` (default) = URL-synced ladder. The A|B toggle now appears on this
view via Breadcrumbs `abViews`.

## Files Changed

- src/pages/SymbolsLadderPage.jsx — filters initialise from `useSearchParams`
  (variant B) and a sync effect keeps the query string in lockstep with
  `{ replace: true }`, preserving unrelated keys (e.g. `variant`).
- src/components/Breadcrumbs.jsx — added `symbols-ladder` to `abViews`.

## Capability Map Entry

- **name:** Symbols Ladder deep links
- **persistence:** URL query string
- **uiSurfaces:** 1

## QA

- Deep link `?signal=BUY&age=5&scope=symbol&symbol=XAUUSD` → Scope=Single
  symbol, Symbol=XAUUSD, Signal=BUY, Age=≤5m all restored; 6 XAUUSD rows
  (verified in browser).
- Changing Age to 10m live-updates the URL to `?signal=BUY&age=10&scope=symbol&symbol=XAUUSD` (verified).
- Variant A (A|B toggle in breadcrumbs): changing filters does NOT rewrite the
  URL; `?variant=A` is preserved (verified).

## Architecture Entries

- Route contract: none (pure client-side URL state).
- Component: `<SymbolsLadder />` filters now round-trip through URLSearchParams.
