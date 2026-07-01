# GitHub Issue: Chart Library Integration — TradingView + Open Source

## Decision: Implement All Three
Rather than pick one, implement all three chart libraries side-by-side and let experience decide what works best.

## Libraries
1. **TradingView Lightweight Charts** (already installed)
   - Free, good candlestick rendering
   - Limited markers/overlays
   - Affiliate link integration for paid upgrade

2. **uPlot** (https://github.com/leeoniya/uPlot)
   - Extremely fast, tiny footprint
   - Canvas-based, good for high-frequency updates
   - Less built-in financial features

3. **ChartIQ Free Tier** (if applicable)
   - More financial features out of box
   - Evaluate licensing

## What to Build

### Chart Component Abstraction
```typescript
// Common interface across all libraries
interface ChartAdapter {
  renderCandlesticks(data: CandleData[]): void;
  addMarker(marker: ChartMarker): void;
  addOverlay(overlay: ChartOverlay): void;
  addZone(zone: PriceZone): void;
  toggleIndicator(indicatorId: string, visible: boolean): void;
  setTimeframe(tf: string): void;
  onCrosshairMove(callback: (data) => void): void;
}
```

### Directive Chart Indicators (toggle on/off)
- Volatility envelope zones (from `volatility-envelope`)
- Support/resistance levels (from `support-resistance`)
- Fair value gaps (from `fair-value-gap`) — shaded zones
- Market structure BOS markers (from `market-structure-bos`)
- Pattern markers (from all pattern directives)

### Comparison Pages
- `/charts/lightweight` — TradingView implementation
- `/charts/uplot` — uPlot implementation
- `/charts/chartiq` — ChartIQ implementation (if licensed)
- Each with same dataset, same overlays
- Side-by-side toggle for comparison

### TradingView Affiliate Integration
- "Unlock Premium Charting" link with affiliate ID
- Upgrade modal showing TradingView features
- In-app notification about premium features

## Potential Spinoff
Custom chart library combining best of all three. Separate project, potential commercial offering. Note this as future business opportunity.

Labels: charts, frontend, exploration, P2
