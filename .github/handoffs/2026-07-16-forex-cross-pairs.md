---
date: 2026-07-16
area: automation
type: feature
---

## What Changed

Added 5 forex cross-pair auto trading strategies to the automation loop: EURJPY, GBPJPY, AUDJPY, EURGBP, EURCHF. Each is an active auto strategy using built-in-default + built-in-short protocol pair, 0.01 base size, 0.3% SL/TP, 5m timeframe, minComposite=3 (scoring pass-through). Also added EURGBP to the Forex Mean Reversion seed strategy scope.

## Files Changed

- nest/scripts/seed-forex-cross-pairs.js — new seed script for cross pairs (can be deleted after use)

## Capability Map Entry

- **name:** Forex Cross-Pair Auto Strategies
- **persistence:** stored
- **uiSurfaces:** 0
- **pipeline:** both
- **completion:** complete

## QA Test Entry

- **area:** Automation
- **name:** Cross-pair forex strategies evaluate and trade
- **procedure:** GET /api/trading/strategies, filter for mode=auto active=true cross pairs. Verify EURJPY, GBPJPY, AUDJPY, EURGBP, EURCHF appear with built-in-default protocol, 0.01 base, auto mode.
- **expected:** All 5 cross pairs show as active auto strategies. They appear in the automation loop's scoring and evaluation tick.

## Architecture Framework Entry

- **section:** automation
- **summary:** Forex Cross-Pair Auto Strategies — 5 new auto trading strategies added for cross pairs (EURJPY, GBPJPY, AUDJPY, EURGBP, EURCHF). Each uses built-in-default + built-in-short protocol direction pair, 0.01 baseSize, 0.3% SL/TP, 5m timeframe, auto mode, active. Brings total forex auto strategies to 13 (8 majors + 5 crosses). Seeded via TradingStrategy model directly.
