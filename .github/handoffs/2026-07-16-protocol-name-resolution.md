---
date: 2026-07-16
area: ui
type: bugfix
---

## What Changed

Fixed #395 — hardcoded protocol/watchlist/broker name maps in focused-translator.js (only 2 of 32 protocols had readable names). Replaced with 3-tier lookup: live API data → hardcoded overrides → slug-to-title auto-conversion.

## Files Changed

- `src/core/translators/focused-translator.js` — added `slugToTitle()`, `defaultDescription()`, `lookupName()` functions; updated `translateMetaStack()` signature to accept optional `liveMaps` parameter
- `src/pages/MetaStackDisplayPage.jsx` — added watchlists query, builds `liveMaps` from API protocol + watchlist data, passes to `translateMetaStack()`

## Capability Map Entry

- **name:** Protocol Name Resolution
- **persistence:** cached
- **uiSurfaces:** 1
- **pipeline:** none
- **completion:** complete

## QA Test Entry

- **area:** Scoring
- **name:** All protocols display readable names on MetaStack Display
- **procedure:** Navigate to /lab/metastack-display. Cycle through all MetaStacks via the dropdown. Verify each protocol name is readable (Title Case, not kebab-case slug).
- **expected:** No raw slugs displayed. Known protocols use overrides (Default Pipeline, Technical Core v1). Unknown protocols auto-convert (btc-speed-v1 → BTC Speed V1). Acronyms stay uppercase (MT5, CAD, RSI).

## Architecture Framework Entry

- **section:** ui
- **summary:** Protocol Name Resolution — 3-tier lookup in focused-translator.js. Tier 1: live API maps built from /api/scoring/protocols and /api/watchlists responses. Tier 2: hardcoded overrides for well-known entries (Default Pipeline, Technical Core v1, MT5, Trading 212). Tier 3: slugToTitle() auto-conversion with smart acronym detection (MT5, BTC, ETH, CAD, JPY, RSI, MACD, etc.). Fallback generates default descriptions. All 32 protocol IDs now resolve to human-readable names.
