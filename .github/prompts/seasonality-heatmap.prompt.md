# seasonality-heatmap: Hour×Day Win Rate Heatmap

**Prompt ID:** seasonality-heatmap
**Date:** 2026-06-24
**Status:** ready

## Goal

Build a seasonality heatmap panel on the Speed Trading page that shows historical bullish/bearish bias for the active symbol, broken down by hour and day of week. The heatmap is a 7×24 grid showing win rates from historical MT5 data.

## Backend: Seasonality Endpoint

```
GET /api/speed/seasonality/:symbol
Response: {
  symbol: string,
  heatmap: number[][]  // 7×24 grid. 0.0 = 0% bullish, 1.0 = 100% bullish
  samples: number[][]  // 7×24 grid. Number of data points per cell
  computedAt: string
}
```

### Algorithm
1. Fetch as many 1m candles as possible for the symbol from MT5
2. For each candle, record: day-of-week (0=Sun, 6=Sat), hour (0-23), direction (close > open = bullish)
3. Group by [day][hour]
4. Calculate: bullish% = bullishCandles / totalCandles
5. Apply confidence: cells with <100 samples show as "low confidence" (dimmed)

## Frontend: Heatmap Component

### Layout
- 7 columns (Mon–Sun), 24 rows (00–23)
- Current day/hour cell highlighted with animated border
- Color scale: red (#ef4444) at 30% → neutral (#334155) at 50% → green (#22c55e) at 70%+
- Low-confidence cells shown with diagonal stripes or dimmed opacity
- Hover tooltip: "Thursday 21:00 — 68% bullish (342 samples)"
- Below grid: legend explaining color scale

### Integration on SpeedTradingPage
- Add between Scanner panel and Action Log
- Collapsible sectionheader: "📊 Seasonality"
- Updates when symbol changes
- Updates when new MT5 data arrives

## Chart Background Zones (Future)
- Using lightweight-charts `createPrimitive()` to draw colored rectangles behind candles
- Pre-shade the next few hours based on historical bias
- Faint tint — not intrusive

## Files
- `nest/src/modules/scoring/seasonality.service.ts` — compute heatmap from MT5 data
- `nest/src/modules/scoring/seasonality.controller.ts` — endpoint
- `src/components/SeasonalityHeatmap.jsx` — React heatmap component
- `src/components/SeasonalityHeatmap.css` — styling
- Integration in `src/pages/SpeedTradingPage.jsx`
