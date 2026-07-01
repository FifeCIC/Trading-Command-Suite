# speed-scanner: Best Symbol Scanner for Speed Trading

**Prompt ID:** speed-scanner
**Date:** 2026-06-23
**Status:** ready

## Goal

Build a real-time batch scanner that scores all Tier A/B speed trading symbols against their best protocol and ranks them. The Speed Trading page displays a "Best Opportunities" panel showing which symbol is currently the highest-scoring opportunity.

## Architecture

```
Every N seconds (configurable, default 5s):
  SpeedTradingPage → POST /api/speed/scan { symbols: [...], timeframe: "5s" }
    → SpeedScanService
      → For each symbol:
        1. Map symbol to best protocol (symbol→protocol registry)
        2. Fetch last 20 bars from MarketDataService
        3. Run ProtocolGatingService.scoreWithGating()
        4. Return { symbol, protocol, composite, signal, gated, riskMultiplier }
      → Sort by composite DESC
      → Return ranked list
```

## Symbol→Protocol Mapping

| Symbol | Protocol | Reason |
|--------|----------|--------|
| BTCUSD | btc-scalp-v1 | Built for crypto speed |
| XAUUSD | xau-speed-v1 | Gold speed (new) |
| USOIL | oil-speed-v1 | Oil speed (new) |
| EURUSD, GBPUSD, USDJPY, AUDUSD | forex-session-v1 | Forex speed |
| SPX500, TECH100 | spx-speed-v1 (TBD) | Index speed — falls back to default for now |
| VIX | vix-spike-v1 | VIX mean reversion |
| ETHUSD | btc-scalp-v1 | Crypto speed (same pattern) |
| GER40 | default | Falls back until dedicated protocol |
| NVDA, TSLA | default | Falls back until dedicated protocol |

## Endpoint

```
POST /api/speed/scan
Body: { symbols: string[], timeframe?: string }
Response: {
  scan: Array<{
    symbol: string
    protocol: string
    composite: number
    signal: 'BUY' | 'SELL' | 'HOLD'
    gated: boolean
    riskMultiplier: number
    subScores: { technical, sentiment, risk }
  }>
  ranked: Array<string>  // Symbols sorted by composite DESC
  topPick: string         // Highest composite symbol
  scannedAt: string
  scanMs: number
}
```

## Frontend Integration

Add a "Best Opportunities" panel to SpeedTradingPage.jsx:
- Shows top 5 ranked symbols with scores in real-time
- Gated symbols shown with ⛔ indicator
- Click a symbol to switch the active trading symbol
- Toggle: "Auto-Switch" — automatically changes active symbol when top pick changes
- Threshold slider: minimum score difference before auto-switching

## Performance Considerations

- Must complete scan in <2 seconds (for 5s update interval)
- Batch market data fetches per provider
- Cache protocol mappings in memory
- Skip symbols with no market data

## Implementation Files

- `nest/src/modules/scoring/speed-scan.service.ts` — new service
- `nest/src/modules/scoring/speed-scan.controller.ts` — new endpoint
- `nest/src/modules/scoring/scoring.module.ts` — register service + controller
- `src/pages/SpeedTradingPage.jsx` — add Best Opportunities panel + auto-switch
