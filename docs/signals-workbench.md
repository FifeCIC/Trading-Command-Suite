# Signals Workbench — How It Works

**Status:** active
**Category:** C — reference / contract
**Created:** 2026-07-02
**Last updated:** 2026-09-03
**Owner:** TCS team


## Overview

The Signals Workbench is the bridge between the scoring pipeline and trade execution. It takes raw directive outputs from the `ProtocolGatingService`, normalizes them into signal envelopes, and presents a live signal ladder with directive drilldown, confidence rails, and conflict resolution.

## Architecture

```
Directives (100+, 104 as of 2026-08) → ProtocolGatingService.scoreWithGating()
    → GatedScore { composite, signal, subScores, breakouts, riskGate, rarity }
        → SignalEnvelopeService.buildLadder()
            → SignalEnvelope { confidence, groups, conflicts, preTradeReady }
                → SignalsWorkbenchPage (UI)
```

## Key Components

### SignalEnvelopeService (`nest/src/modules/signals/signal-envelope.service.ts`)

Bridges `ProtocolGatingService` output into rich signal envelopes:

| Method | Purpose |
|--------|---------|
| `buildLadder(symbols, protocolId)` | Scores all symbols, sorts by composite, collects top conflicts |
| `buildEnvelope(ticker, protocolId)` | Fetches market bars → scores → enriches single symbol |
| `computeConfidence(gated)` | 0-100 confidence: rarity bonus + threshold distance + group agreement − risk penalty |
| `detectConflicts(gated)` | Bull/bear directive disagreement, group score divergence |
| `evaluatePreTrade(gated, conflicts)` | Hard gates, risk multiplier, conflicts → ready/blocked |

### Endpoints

| Endpoint | Description |
|----------|-------------|
| `GET /api/signals/ladder?symbols=AAPL,NVDA&protocol=btc-speed-v1` | Full signal ladder |
| `POST /api/signals/ladder` | Same, with JSON body `{ symbols, protocol }` |
| `GET /api/signals/envelope/:symbol?protocol=...` | Single symbol drilldown |

### Confidence Model

Confidence is scored 0-100 from multiple signals:
1. **Base**: 50
2. **Rarity bonus**: standard=0, strong=+10, exceptional=+20, cyclical=+15, black-swan=−30
3. **Threshold distance**: +0.5 per point above 65, −0.3 per point below
4. **Group agreement**: stdDev < 10→+10, 10-20→+5, > 30→−10
5. **Risk gate penalty**: hard gate triggered→−25, multiplier < 0.5→−15, < 0.7→−5

### Conflict Detection

- **Bull/Bear**: Directives disagree on direction — severity based on score gap
- **Score Divergence**: One group scores much higher than another (>40pt spread)

### Pre-Trade Readiness

A signal is "execution-ready" only when:
- No hard risk gate triggered
- Risk multiplier ≥ 0.3
- No high-severity conflicts
- Composite ≥ 65
- Signal isn't SELL with composite > 50

## UI Features

- **Signal Ladder**: Ranked list with staggered animation, color-coded BUY/SELL/HOLD
- **Directive Drilldown**: Click any symbol to expand — risk gate multiplier chain, directive group panels (Technical/Sentiment/Risk/Macro), top-5 directives per group with individual scores and reasons
- **Conflict Resolver**: Dedicated view showing all symbols with disagreements, click to jump to drilldown
- **Protocol Selector**: Choose from code-registered or DB strategy protocols

## Dependencies

- `ProtocolGatingService` (scoring) — produces `GatedScore`
- `MarketDataService` — fetches OHLCV bars for scoring
- `DirectivesService` — directive registry
- Prisma `Symbol`, `Score`, `Strategy` tables
