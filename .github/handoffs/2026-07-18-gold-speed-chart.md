---
date: 2026-07-18
area: ui
type: bugfix
---

## What Changed

Fixed Gold Speed Lab chart (#226) — replaced silent indefinite "Loading…" state with a clear MT5 offline diagnostic view when the bridge is not running.

## Files Changed

- `src/components/SpeedChart.jsx` — added offline state branch with icon, explanation, fallback badge, and current price
- `src/pages/speed-trading.css` — added `.st-chart-offline*` styles (centered flex layout with fallback badge)

## Architecture Framework Entry

- **section:** ui
- **summary:** Gold Speed chart (/trading/gold-speed) — when MT5 bridge is unreachable, shows a centered offline state with launch instructions, fallback badge, and live price stream. Candle chart renders normally when MT5 is connected. Files: SpeedChart.jsx, speed-trading.css.

## Issue

Closed #226 — LAB: Gold Speed - replace chart with TradingView widget
