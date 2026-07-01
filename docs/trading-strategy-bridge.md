---
description: "Build a trading strategy system that consumes protocol scores and executes bracket trades via MT5. This bridges the gap between scoring protocols (which produce BUY/HOLD/SELL signals) and actual trade execution (which places orders). Use when: implementing automated trading, connecting protocols to MT5, or building the trade execution engine."
argument-hint: "Auto-execute or manual confirmation? Speed trading or position trading?"
appliesTo: "nest/src/modules/trading/**, nest/prisma/schema.prisma, src/pages/**"
---

# Trading Strategy — Bridge Protocols to Execution

## Problem

We now have:
- ✅ **Protocols** that produce scored signals (`BUY`/`HOLD`/`SELL` with rarity bands)
- ✅ **MT5 bridge** that can place/close/modify orders
- ❌ **Nothing connecting the two** — no trading strategy that watches protocol scores and executes trades

The Bitcoin Speed Protocol (`btc-speed-v1`) produces signals like:
```json
{
  "symbol": "BTC-USD",
  "composite": 87,
  "signal": "BUY",
  "rarity": { "band": "exceptional", "percentile": 91, "sizeMultiplier": 2.0 }
}
```

But nobody is watching. No trade gets placed.

## Solution

### 1. Prisma Model — `TradingStrategy`

```prisma
model TradingStrategy {
  id          String   @id @default(uuid()) @db.VarChar(36)
  name        String   @db.VarChar(200)
  description String?  @db.Text
  protocolId  String   @db.VarChar(36)   // Which protocol to use for signals
  symbol      String   @db.VarChar(20)   // Which symbol to trade (or "*" for portfolio)
  timeframe   String   @db.VarChar(10)   // 5m, 15m, 1h, 1d
  
  // Entry rules
  minComposite    Float   @default(65)   // Minimum composite to consider entry
  minRarityBand   String? @db.VarChar(20) // "standard" → only trade standard+
  requireDirection String? @db.VarChar(10) // BUY only? SELL only? BOTH?
  
  // Bracket config (for speed trading)
  slPct           Float   @default(1.0)  // Stop-loss distance (%)
  tpPct           Float   @default(1.0)  // Take-profit distance (%)
  baseSize        Float   @default(0.01) // Base position size
  useRaritySizing Boolean @default(true) // Scale size by rarity multiplier?
  maxSize         Float?                 // Hard cap on position size
  
  // Risk controls
  maxPositions    Int     @default(1)    // Max concurrent positions
  maxDailyLoss    Float?                 // Stop trading if daily loss exceeds this
  cooldownMinutes Int     @default(5)    // Wait after a trade close
  
  // Execution mode
  mode            String  @default("manual") // "manual", "semi-auto", "auto"
  active          Boolean @default(false)
  
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  @@map("trading_strategy")
}
```

### 2. Service — `TradingStrategyService`

```typescript
@Injectable()
export class TradingStrategyService {
  async evaluate(strategyId: string): Promise<StrategyEvaluation> {
    // 1. Load strategy config
    // 2. Fetch latest bars from MT5
    // 3. Run protocol scoring
    // 4. Check entry rules (minComposite, minRarityBand, direction)
    // 5. Check risk controls (max positions, daily loss, cooldown)
    // 6. If conditions met: compute position size
    //    size = baseSize × rarity.sizeMultiplier (if useRaritySizing)
    // 7. Return evaluation (not execution — that's separate)
  }

  async execute(strategyId: string): Promise<TradeResult> {
    // 1. Call evaluate()
    // 2. If mode=auto and signal=BUY: place bracket order via MT5
    // 3. If mode=semi-auto: queue for human approval
    // 4. If mode=manual: just log the signal
    // 5. Record trade in journal
  }

  // Scheduled: run every N minutes based on timeframe
  @Cron('*/5 * * * *') // Check every 5 minutes
  async scheduledEvaluation() {
    const activeStrategies = await this.prisma.tradingStrategy.findMany({
      where: { active: true },
    });
    for (const strategy of activeStrategies) {
      await this.evaluate(strategy.id);
    }
  }
}
```

### 3. API Endpoints

```
GET    /api/trading/strategies                    List all strategies
POST   /api/trading/strategies                    Create a strategy
PATCH  /api/trading/strategies/:id                Update config
DELETE /api/trading/strategies/:id                Delete
POST   /api/trading/strategies/:id/evaluate       Run evaluation (dry-run)
POST   /api/trading/strategies/:id/execute        Execute if conditions met
GET    /api/trading/strategies/:id/log            Recent evaluation log
POST   /api/trading/strategies/:id/toggle         Enable/disable
```

### 4. React Page — `TradingStrategiesPage`

A simple page showing:
- **Sidebar**: List of strategies with active/inactive status
- **Detail**: Protocol, symbol, thresholds, bracket config, recent evaluations
- **Action buttons**: Evaluate (dry-run), Enable/Disable
- **Log**: Table of recent evaluations with score, signal, rarity, and whether a trade was placed

### 5. Default Strategy — Bitcoin Speed Scalp

On creation, seed one default strategy:
```json
{
  "name": "BTC Speed Scalp (Demo)",
  "protocolId": "btc-speed-v1",
  "symbol": "BTCUSD",
  "timeframe": "5m",
  "minComposite": 70,
  "minRarityBand": "strong",
  "slPct": 0.5,
  "tpPct": 0.5,
  "baseSize": 0.01,
  "useRaritySizing": true,
  "maxPositions": 1,
  "cooldownMinutes": 5,
  "mode": "manual",
  "active": false
}
```

This lets the user enable it when ready and manually execute based on protocol signals, graduating to semi-auto and eventually full auto.

## Implementation Order

1. **Prisma model** — `TradingStrategy` + migration
2. **Service** — `TradingStrategyService` with evaluate/execute
3. **Controller** — REST endpoints
4. **React page** — Simple view for managing strategies
5. **Scheduler** — Cron-based evaluation (disabled by default, opt-in)

## References
- Protocol registry: `nest/src/modules/directives/directive-groups.ts`
- Gating service: `nest/src/modules/scoring/protocol-gating.service.ts`
- MT5 bridge: `scripts/mt5-bridge/mt5_bridge_v2.py`
- Existing TradingModule: `nest/src/modules/trading/`
- BTC Theory: `docs/BTC-SPEED-PROTOCOL-THEORY.md`
- Protocols page: `src/pages/ProtocolsPage.jsx`
