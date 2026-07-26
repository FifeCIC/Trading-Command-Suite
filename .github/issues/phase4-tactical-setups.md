## Summary

Add a **Tactical Setups** system for tracking time-limited market scenarios derived from external analysis (Reddit posts, on-chain data, analyst reports, Elliott Wave counts, etc.). Unlike permanent strategies in the Strategy Library, these have an expiration and are driven by specific measurable conditions approaching in real time.

## Motivation

The Strategy Library covers permanent methodologies (Scale-In Capital Recycling, Tech Scale-In with ATR). But many trading opportunities come from tactical narratives — "BTC STH holders are underwater at $70.6K, watch for rejection here." These are time-boxed, data-dependent, and need to be surfaced when conditions are approaching — not buried in a static library.

## Data Model

```
TacticalSetup {
  id: string
  title: string                    // "BTC Short-Term Holder Resistance at $70,600"
  source: string                   // "Reddit r/Bitcoin", "Glassnode report", etc.
  narrative: string                // The thesis — what's happening and why it matters
  symbol: string                   // Primary asset (BTCUSD, SPX, NVDA, etc.)
  conditions: [{
    type: 'price_level' | 'indicator' | 'on_chain' | 'time' | 'volume'
    metric: string                 // "STH_realized_price", "RSI_14", "close", etc.
    operator: 'gt' | 'lt' | 'crosses_above' | 'crosses_below' | 'approaches'
    value: string                  // Target value
    tolerance?: string             // For "approaches" — how close is close enough
  }]
  status: 'draft' | 'active' | 'approaching' | 'triggered' | 'expired'
  createdAt: DateTime
  expiresAt: DateTime
  entryPlan: string                // What to do when conditions trigger
  exitPlan: string                 // Invalidation criteria
  linkedStrategyId?: string        // Optional: maps to a Strategy Library entry
}
```

## Example: BTC STH Resistance Setup

```json
{
  "title": "BTC Short-Term Holder Resistance at $70,600",
  "source": "Reddit — Elliott Wave + on-chain analysis",
  "narrative": "STH realized price is ~$70.6K. Trapped buyers will sell at breakeven. Rejection from this zone could trigger Wave 3 impulse down — potentially below $50K.",
  "symbol": "BTCUSD",
  "conditions": [
    { "type": "price_level", "metric": "close", "operator": "approaches", "value": "70600", "tolerance": "2000" },
    { "type": "volume", "metric": "volume", "operator": "lt", "value": "declining_at_resistance" }
  ],
  "status": "active",
  "expiresAt": "2026-09-01T00:00:00Z",
  "entryPlan": "Short at $69K-$71K rejection zone with bearish candle confirmation. Stop above $72K.",
  "exitPlan": "Target $50K. Invalidate if BTC breaks and holds above $72K on daily close."
}
```

## Integration Points

| Component | What it does |
|-----------|-------------|
| DB Table `tactical_setup` | Stores setups with conditions as JSON |
| API `GET/POST/PATCH /api/tactical-setups` | CRUD for setups |
| Watcher Service | Runs on automation tick — checks each active setup's conditions against live data |
| Status transitions | dormant → active → approaching (conditions within tolerance) → triggered (conditions met) → expired |
| Timeline integration | Active setups appear in `/api/automation/timeline` alongside existing events |
| Daily Briefing page | Shows "Active Tactical Setups" section — approaching setups highlighted |
| Market Context page | Per-symbol contextual card: "1 tactical setup watching $70.6K level" |
| Alert system | Push notification when a setup moves to "approaching" or "triggered" |
| New page `/trading/tactical-setups` | Browse, filter by status/symbol, create new setups manually or import from external sources |

## Required Data Feeds

For the BTC example to work, TCS needs:
- On-chain data: STH realized price (Glassnode, CoinMetrics, or similar API)
- Standard OHLCV bars (already have via MT5)
- Volume data (already have)

For other tactical setups:
- Elliott Wave labels (manual input or external API)
- Options flow data
- Exchange liquidation levels
- Social sentiment scores

These can be added incrementally — the watcher only checks conditions for which data feeds are available.

## Relationship to Strategy Library

- Strategy Library = permanent methodologies ("how to trade in general")
- Tactical Setups = specific opportunities ("what to trade right now")
- A tactical setup can optionally link to a Strategy Library entry: "Enter using Scale-In Capital Recycling rules on BTC at $70.6K rejection"

## Phase 4 Scope

1. DB table + Prisma model
2. Backend CRUD + watcher service skeleton
3. Frontend: Tactical Setups page (list/create/view)
4. Integration: Daily Briefing and Market Context cards
5. Alert triggers for approaching/triggered status
6. First real setup: the BTC STH Resistance from the Reddit analysis
