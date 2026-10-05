# PIPELINE-MAP ÔÇö the bars pipeline, generated from source

> ÔÜá´©Å **GENERATED ÔÇö do not edit.** Regenerate with `node scripts/generate-pipeline-map.cjs`.
> Phase 1 of #1071. Reads the source, so it cannot drift from it.

Scanned **546** backend source files (specs excluded). Two access paths, because one
of them is invisible to the other: **Prisma model calls** and **raw SQL**. The writer that
fabricated 1,172 bars (#1068) is only findable through the second.

## Ingest

### `symbol`

- **writers (9):** `backtest-period.service.ts`, `import-jobs.service.ts`, `portfolio.service.ts`, `trading212-import.service.ts`, `mt5.controller.ts`, `symbol-name-enricher.service.ts`, `symbols.controller.ts`, `symbols.service.ts`, `webhooks.controller.ts`
- **readers (44):** `alert-trigger.service.ts`, `architecture.service.ts`, `automation-loop.service.ts`, `protocol-runner.service.ts`, `backtest-period.service.ts`, `backtest.service.ts`, `directives.controller.ts`, `data-import-orchestrator.service.ts`, `import-jobs.service.ts`, `indicators.service.ts`, `bar-refresh.service.ts`, `freshness.service.ts`, `market-data.service.ts`, `correlation.service.ts`, `trading212-import.service.ts`, `replay.service.ts`, `research-import.service.ts`, `trading-scheduler.service.ts`, `arena.controller.ts`, `decision-chain.service.ts`, `directive-impact.service.ts`, `exit-consensus.service.ts`, `outcome-tracker.service.ts`, `protocol-consensus.service.ts`, `protocol-gating.controller.ts`, `protocol-gating.service.ts`, `score-history.service.ts`, `score-velocity.service.ts`, `scoring.service.ts`, `sector-rotation.service.ts`, `speed-scan.controller.ts`, `speed-scan.service.ts`, `screener.service.ts`, `signal-envelope.service.ts`, `snapshot-comparison.service.ts`, `snapshots.module.ts`, `suitability.controller.ts`, `broker-symbol-discovery.service.ts`, `symbol-name-enricher.service.ts`, `symbol-resolver.service.ts`, `symbols.controller.ts`, `symbols.service.ts`, `trading-strategy.service.ts`, `webhooks.controller.ts`

### `symbol_route`

- **writers (1):** `mt5.controller.ts`
- **readers (3):** `bar-refresh.service.ts`, `mt5.controller.ts`, `mt5-symbol-router.service.ts`

## Bar store

### `marketbar`

- **writers (8):** `backtest-period.service.ts`, `import-jobs.service.ts`, `bar-refresh.service.ts`, `replay.service.ts`, `scoring.service.ts`, `tick-recorder.service.ts`, `trading-strategy.service.ts`, `webhooks.controller.ts`
- **readers (24):** `alert-trigger.service.ts`, `backtest-period.service.ts`, `backtest.controller.ts`, `backtest.service.ts`, `import-jobs.service.ts`, `indicators.service.ts`, `bar-refresh.service.ts`, `freshness.service.ts`, `market-data.service.ts`, `correlation.service.ts`, `replay.service.ts`, `research-overview.service.ts`, `weekend-gap-risk.service.ts`, `trading-scheduler.service.ts`, `outcome-tracker.service.ts`, `scoring.service.ts`, `tick-recorder.service.ts`, `snapshot-comparison.service.ts`, `snapshots.module.ts`, `strategies.controller.ts`, `symbols.controller.ts`, `symbols.service.ts`, `system-health.service.ts`, `trading-strategy.service.ts`

## Score

### `score`

- **writers (3):** `protocol-gating.service.ts`, `score-history.service.ts`, `data-retention.service.ts`
- **readers (14):** `alert-trigger.service.ts`, `directives.controller.ts`, `directives.service.ts`, `research-overview.service.ts`, `decision-chain.service.ts`, `directive-impact.service.ts`, `protocol-gating.controller.ts`, `protocol-health.service.ts`, `score-history.service.ts`, `score-velocity.service.ts`, `scoring.service.ts`, `signal-envelope.service.ts`, `symbols.service.ts`, `data-retention.service.ts`

### `directiveoutcome`

- **writers (1):** `outcome-tracker.service.ts`
- **readers (2):** `edge-statistics.service.ts`, `outcome-tracker.service.ts`

### `protocol`

- **writers (5):** `protocol-db.service.ts`, `protocol-gating.controller.ts`, `protocol-gating.service.ts`, `protocols.controller.ts`, `signal-envelope.service.ts`
- **readers (19):** `app.controller.ts`, `architecture.service.ts`, `replay.service.ts`, `protocol-db.service.ts`, `protocol-gating.controller.ts`, `protocol-health.service.ts`, `protocols.controller.ts`, `score-history.service.ts`, `scoring.service.ts`, `screener.service.ts`, `strategies.controller.ts`, `suitability.controller.ts`, `symbol-protocol-authority.service.ts`, `symbol-resolver.service.ts`, `symbols.service.ts`, `system-health.service.ts`, `bot-performance.service.ts`, `trade-history.controller.ts`, `trading-strategy.service.ts`

### `trading_strategy`

- **writers (2):** `speed-scan.controller.ts`, `trading-strategy.service.ts`
- **readers (22):** `app.controller.ts`, `alert-trigger.service.ts`, `architecture.service.ts`, `ab-test.service.ts`, `automation.controller.ts`, `backtest.service.ts`, `bar-refresh.service.ts`, `replay.service.ts`, `exit-consensus.service.ts`, `protocol-gating.controller.ts`, `protocol-health.service.ts`, `strategy-derivation.service.ts`, `signal-envelope.service.ts`, `signal-queue.service.ts`, `symbol-protocol-authority.service.ts`, `symbol-resolver.service.ts`, `symbols.service.ts`, `bot-performance.service.ts`, `mt5-trading.service.ts`, `pyramid-policy.service.ts`, `trade-history.controller.ts`, `trading-strategy.service.ts`

## Gate / queue

### `strategy_signal_queue`

- **writers (3):** `automation-loop.service.ts`, `signal-queue.service.ts`, `trading-strategy.service.ts`
- **readers (3):** `automation-loop.service.ts`, `signal-queue.service.ts`, `trading-strategy.service.ts`

## Execute

### `position`

- **writers (3):** `price-refresh.service.ts`, `trading212-import.service.ts`, `position-sync.service.ts`
- **readers (18):** `alert-trigger.service.ts`, `global-diversification.service.ts`, `data-import-orchestrator.service.ts`, `bar-refresh.service.ts`, `price-refresh.service.ts`, `portfolio-accounts.service.ts`, `portfolio.service.ts`, `trading212-import.service.ts`, `position-sync.service.ts`, `earnings-import-settings.service.ts`, `research-overview.service.ts`, `risk.controller.ts`, `speed-scan.controller.ts`, `symbol-resolver.service.ts`, `symbols.service.ts`, `duplicate-guard.service.ts`, `trade-history.controller.ts`, `watchlists.controller.ts`

### `trade`

- **writers (5):** `automation-loop.service.ts`, `paper-trading.service.ts`, `mt5.controller.ts`, `position-sync.service.ts`, `trade-recorder.service.ts`
- **readers (20):** `ab-test.service.ts`, `backtest.controller.ts`, `paper-trading.service.ts`, `performance.service.ts`, `position-sync.service.ts`, `research-overview.service.ts`, `risk.controller.ts`, `decision-chain.service.ts`, `edge-statistics.service.ts`, `pnl-statistics.service.ts`, `stack-performance.service.ts`, `signal-envelope.service.ts`, `symbols.service.ts`, `bot-performance.service.ts`, `duplicate-guard.service.ts`, `execution-feasibility.service.ts`, `mt5-trading.service.ts`, `trade-history.controller.ts`, `trade-recorder.service.ts`, `trading-strategy.service.ts`

### `order`

- **writers (2):** `automation-loop.service.ts`, `mt5-trading.service.ts`
- **readers (0):** _none_ ÔÇö nothing reads this_

## Phase 2 ÔÇö the derived dataset

> ÔÜá´©Å **GENERATED ÔÇö do not edit.** Phase 2 of #1071. Read by the **TypeScript compiler**, not by
> pattern-matching, so a formula in a comment or a string is not a site and a call site is a
> resolved symbol rather than a name that matches.

**546** source files ┬À **2871** declarations ┬À **361** ratio sites ┬À **1469** nodes ┬À **129** unreferenced

| tier | what it means | groups |
|---|---|---|
| `exact` | the identical computation after normalisation | 43 |
| `coarse` | the identical **shape**, different constants | 40 |
| `idiom` | `(AÔêÆB)` **and** `(BÔêÆA)` in one expression | 1 |

## Q3a ÔÇö the same maths in more than one place

Identical after normalisation: variable names differ, the computation does not.

### 28 sites ÔÇö `((V1-V2)/V2)*100`

- `nest/src/modules/market-data/market-data.service.ts:145` ÔÇö `getTopMovers()` ÔåÆ `changePct`
  - `((latest.close-previous.close)/previous.close)*100`
- `nest/src/modules/providers/adapters/finnhub.adapter.ts:365` ÔÇö `getPriceTarget()` ÔåÆ `upside`
  - `currentPrice>0?((avgTarget-currentPrice)/currentPrice)*100:null`
  - guarded by: `currentPrice>0`
- `nest/src/modules/research/investigation.service.ts:225` ÔÇö `computeConviction()` ÔåÆ `upside`
  - `((analystTarget.mean-price)/price)*100`
- `nest/src/modules/directives/implementations/price-above-sma.directive.ts:59` ÔÇö `calculate()` ÔåÆ `distancePct`
  - `((currentPrice-sma50)/sma50)*100`
- `nest/src/modules/directives/implementations/vwap.directive.ts:48` ÔÇö `calculate()` ÔåÆ `distancePct`
  - `((currentPrice-currentVwap)/currentVwap)*100`
- `nest/src/modules/directives/implementations/vwap-confluence.directive.ts:84` ÔÇö `calculate()` ÔåÆ `distPct`
  - `((lastClose-vwapVal)/vwapVal)*100`
- `nest/src/modules/directives/implementations/gap-scanner.directive.ts:83` ÔÇö `evaluateGap()` ÔåÆ `gapPct`
  - `((currentOpen-prevClose)/prevClose)*100`
- `nest/src/modules/directives/implementations/overhead-supply.directive.ts:51` ÔÇö `calculate()` ÔåÆ `distanceFromHigh`
  - `((highestHigh-currentPrice)/currentPrice)*100`
- ÔÇª and 20 more

### 24 sites ÔÇö `(V1/V2)*100`

- `nest/src/modules/automation/stop-guardian.service.ts:1673` ÔÇö `observeExhaustion()`
  - `(recent/entry)*100`
- `nest/src/modules/automation/stop-guardian.service.ts:1674` ÔÇö `observeExhaustion()`
  - `(prior/entry)*100`
- `nest/src/modules/providers/adapters/trading212.adapter.ts:616` ÔÇö `getAccount()`
  - `cash.total>0?(cash.free/cash.total)*100:null`
  - guarded by: `cash.total>0`
- `nest/src/modules/directives/implementations/multi-timeframe-trend.directive.ts:284` ÔÇö `adx()` ÔåÆ `diPlus`
  - `atr[atr.length-1]>0?(smoothedPlusDm[smoothedPlusDm.length-1]/atr[atr.length-1])*100:0`
  - guarded by: `atr[atr.length-1]>0`
- `nest/src/modules/directives/implementations/multi-timeframe-trend.directive.ts:289` ÔÇö `adx()` ÔåÆ `diMinus`
  - `atr[atr.length-1]>0?(smoothedMinusDm[smoothedMinusDm.length-1]/atr[atr.length-1])*100:0`
  - guarded by: `atr[atr.length-1]>0`
- `nest/src/modules/directives/implementations/momentum-and-macro.directives.ts:212` ÔÇö `calculate()` ÔåÆ `atrPct`
  - `(currentAtr/lastClose)*100`
- `nest/src/modules/directives/implementations/momentum-and-macro.directives.ts:217` ÔÇö `calculate()` ÔåÆ `percentile`
  - `rank>=0?(rank/sortedAtr.length)*100:50`
  - guarded by: `rank>=0`
- `nest/src/modules/directives/implementations/momentum-and-macro.directives.ts:1162` ÔÇö `calculate()` ÔåÆ `atrPct`
  - `(currentAtr/lastClose)*100`
- ÔÇª and 16 more

### 20 sites ÔÇö `(V1-V2)/V3`

- `nest/src/modules/providers/adapters/finnhub.adapter.ts:505` ÔÇö `parseSentimentScore()`
  - `(bullish-bearish)/total`
- `nest/src/modules/directives/implementations/three-soldiers-pattern.directive.ts:77` ÔÇö `bodyRatio()`
  - `range>0?(bar.close-bar.open)/range:0`
  - guarded by: `range>0`
- `nest/src/modules/directives/implementations/vwap-confluence.directive.ts:166` ÔÇö `calculate()` ÔåÆ `deviation`
  - `(lastClose-vwapVal)/sigma`
- `nest/src/modules/directives/implementations/bollinger-squeeze.directive.ts:54` ÔÇö `calculate()` ÔåÆ `percentile`
  - `(currentBW-minBW)/bwRange`
- `nest/src/modules/directives/implementations/overhead-supply.directive.ts:62` ÔÇö `calculate()` ÔåÆ `reclaimProgress`
  - `dropMagnitude>0?(currentPrice-lowAfterHigh)/dropMagnitude:1`
  - guarded by: `dropMagnitude>0`
- `nest/src/modules/directives/implementations/volatility-envelope.directive.ts:65` ÔÇö `calculate()` ÔåÆ `currentRange`
  - `(currentBar.high-currentBar.low)/currentBar.close`
- `nest/src/modules/directives/implementations/target-achieved.directive.ts:55` ÔÇö `calculate()` ÔåÆ `distToBullTarget`
  - `(currentPrice-bullTarget)/currentAtr`
- `nest/src/modules/directives/implementations/target-achieved.directive.ts:56` ÔÇö `calculate()` ÔåÆ `distToBearTarget`
  - `(bearTarget-currentPrice)/currentAtr`
- ÔÇª and 12 more

### 17 sites ÔÇö `Math.round((V1/V2)*100)`

- `nest/src/modules/scoring/risk-gating-engine.service.ts:155` ÔÇö `apply()` ÔåÆ `riskScore`
  - `totalRiskWeight>0?Math.round((weightedRiskSum/totalRiskWeight)*100):50`
  - guarded by: `totalRiskWeight>0`
- `nest/src/modules/scoring/protocol-gating.service.ts:1406` ÔÇö `computeRarity()` ÔåÆ `percentile`
  - `Math.round((countBelow/scores.length)*100)`
- `nest/src/modules/trading/trade-history.controller.ts:169` ÔÇö `(anonymous)()` ÔåÆ `winRate`
  - `s.trades>0?Math.round((s.wins/s.trades)*100):0`
  - guarded by: `s.trades>0`
- `nest/src/modules/portfolio/trading212-import.service.ts:344` ÔÇö `buildSummary()`
  - `trades.length>0?Math.round((winning.length/trades.length)*100):0`
  - guarded by: `trades.length>0`
- `nest/src/modules/scoring/outcome-tracker.service.ts:215` ÔÇö `logDropRate()` ÔåÆ `pct`
  - `considered>0?Math.round((dropped/considered)*100):0`
  - guarded by: `considered>0`
- `nest/src/modules/system/system-health.service.ts:349` ÔÇö `getSystemVitals()`
  - `Math.round((usedMem/totalMem)*100)`
- `nest/src/modules/system/system-health.service.ts:477` ÔÇö `getDiskInfo()` ÔåÆ `pct`
  - `Math.round((usedB/totalB)*100)`
- `nest/src/modules/signals/signal-envelope.service.ts:1824` ÔÇö `getAnalytics()`
  - `closed>0?Math.round((won/closed)*100):null`
  - guarded by: `closed>0`
- ÔÇª and 9 more

### 13 sites ÔÇö `Math.max(0,Math.min(1,(V1-V2)/(V3-V2)))`

- `nest/src/modules/directives/implementations/rsi-oversold.directive.ts:31` ÔÇö `mapRange()` ÔåÆ `t`
  - `Math.max(0,Math.min(1,(v-inMin)/(inMax-inMin)))`
- `nest/src/modules/directives/implementations/atr-dip.directive.ts:18` ÔÇö `mapRange()` ÔåÆ `t`
  - `Math.max(0,Math.min(1,(v-inMin)/(inMax-inMin)))`
- `nest/src/modules/directives/implementations/mfi.directive.ts:17` ÔÇö `mapRange()` ÔåÆ `t`
  - `Math.max(0,Math.min(1,(v-inMin)/(inMax-inMin)))`
- `nest/src/modules/directives/implementations/adx.directive.ts:18` ÔÇö `mapRange()` ÔåÆ `t`
  - `Math.max(0,Math.min(1,(v-inMin)/(inMax-inMin)))`
- `nest/src/modules/directives/implementations/stochastic.directive.ts:18` ÔÇö `mapRange()` ÔåÆ `t`
  - `Math.max(0,Math.min(1,(v-inMin)/(inMax-inMin)))`
- `nest/src/modules/directives/implementations/stoch-rsi.directive.ts:60` ÔÇö `mapRange()` ÔåÆ `t`
  - `Math.max(0,Math.min(1,(v-inMin)/(inMax-inMin)))`
- `nest/src/modules/directives/implementations/rsi-overbought.directive.ts:23` ÔÇö `mapRange()` ÔåÆ `t`
  - `Math.max(0,Math.min(1,(v-inMin)/(inMax-inMin)))`
- `nest/src/modules/directives/implementations/cci.directive.ts:17` ÔÇö `mapRange()` ÔåÆ `t`
  - `Math.max(0,Math.min(1,(v-inMin)/(inMax-inMin)))`
- ÔÇª and 5 more

### 12 sites ÔÇö `(V1-V2)/Math.max(0.01,V2)*100`

- `nest/src/modules/directives/implementations/momentum-and-macro.directives.ts:498` ÔÇö `calculate()` ÔåÆ `recentReturn`
  - `closes.length>5?(closes[closes.length-1]-closes[closes.length-6])/Math.max(0.01,closes[closes.length-6])*100:0`
  - guarded by: `closes.length>5`
- `nest/src/modules/directives/implementations/momentum-and-macro.directives.ts:612` ÔÇö `calculate()` ÔåÆ `recentReturn`
  - `closes.length>5?(closes[closes.length-1]-closes[closes.length-6])/Math.max(0.01,closes[closes.length-6])*100:0`
  - guarded by: `closes.length>5`
- `nest/src/modules/directives/implementations/momentum-and-macro.directives.ts:652` ÔÇö `calculate()` ÔåÆ `ret5`
  - `(closes[closes.length-1]-closes[closes.length-6])/Math.max(0.01,closes[closes.length-6])*100`
- `nest/src/modules/directives/implementations/momentum-and-macro.directives.ts:653` ÔÇö `calculate()` ÔåÆ `ret20`
  - `(closes[closes.length-1]-closes[closes.length-21])/Math.max(0.01,closes[closes.length-21])*100`
- `nest/src/modules/directives/implementations/momentum-and-macro.directives.ts:710` ÔÇö `calculate()` ÔåÆ `ret5`
  - `(closes[closes.length-1]-closes[closes.length-6])/Math.max(0.01,closes[closes.length-6])*100`
- `nest/src/modules/directives/implementations/momentum-and-macro.directives.ts:804` ÔÇö `calculate()` ÔåÆ `ret20`
  - `(closes[closes.length-1]-closes[0])/Math.max(0.01,closes[0])*100`
- `nest/src/modules/directives/implementations/momentum-and-macro.directives.ts:1250` ÔÇö `calculate()` ÔåÆ `ret5`
  - `(closes[closes.length-1]-closes[closes.length-6])/Math.max(0.01,closes[closes.length-6])*100`
- `nest/src/modules/directives/implementations/momentum-and-macro.directives.ts:1251` ÔÇö `calculate()` ÔåÆ `ret5prev`
  - `closes.length>11?(closes[closes.length-6]-closes[closes.length-11])/Math.max(0.01,closes[closes.length-11])*100:0`
  - guarded by: `closes.length>11`
- ÔÇª and 4 more

### 10 sites ÔÇö `(V1+V2+V3)/3`

- `nest/src/modules/directives/utils/indicators.ts:738` ÔÇö `vwap()` ÔåÆ `tp`
  - `(highs[i]+lows[i]+closes[i])/3`
- `nest/src/modules/directives/implementations/three-soldiers-pattern.directive.ts:93` ÔÇö `calculate()` ÔåÆ `avgBodyRatio`
  - `(br1+br2+br3)/3`
- `nest/src/modules/directives/implementations/vwap-confluence.directive.ts:36` ÔÇö `computeVwap()` ÔåÆ `tp`
  - `(highs[i]+lows[i]+closes[i])/3`
- `nest/src/modules/directives/implementations/vwap-confluence.directive.ts:47` ÔÇö `computeVwapStdDev()` ÔåÆ `tp`
  - `(highs[i]+lows[i]+closes[i])/3`
- `nest/src/modules/directives/implementations/multi-timeframe-trend.directive.ts:325` ÔÇö `vwap()` ÔåÆ `tp`
  - `(highs[i]+lows[i]+closes[i])/3`
- `nest/src/modules/directives/implementations/micro-sr-levels.directive.ts:305` ÔÇö `computeVwap()` ÔåÆ `tp`
  - `(b.high+b.low+b.close)/3`
- `nest/src/modules/directives/implementations/momentum-and-macro.directives.ts:865` ÔÇö `calculate()` ÔåÆ `tp`
  - `(bar.high+bar.low+bar.close)/3`
- `nest/src/modules/indicators/indicators.service.ts:71` ÔÇö `computeSupportResistance()` ÔåÆ `pivot`
  - `(prev.high+prev.low+prev.close)/3`
- ÔÇª and 2 more

### 10 sites ÔÇö `(V1-V2)/V2`

- `nest/src/modules/directives/implementations/ema-structure.directive.ts:46` ÔÇö `calculate()` ÔåÆ `priceSep`
  - `(currentPrice-currentEma20)/currentEma20`
- `nest/src/modules/directives/implementations/ema-structure.directive.ts:54` ÔÇö `calculate()` ÔåÆ `emaSep`
  - `(currentEma20-currentEma50)/currentEma50`
- `nest/src/modules/directives/implementations/three-soldiers-pattern.directive.ts:94` ÔÇö `calculate()` ÔåÆ `progression1`
  - `(b2.close-b1.close)/b1.close`
- `nest/src/modules/directives/implementations/three-soldiers-pattern.directive.ts:95` ÔÇö `calculate()` ÔåÆ `progression2`
  - `(b3.close-b2.close)/b2.close`
- `nest/src/modules/directives/implementations/micro-sr-levels.directive.ts:205` ÔÇö `calculate()` ÔåÆ `distPct`
  - `(currentPrice-nearestSupport.price)/nearestSupport.price`
- `nest/src/modules/directives/implementations/micro-sr-levels.directive.ts:236` ÔÇö `calculate()` ÔåÆ `distPct`
  - `(nearestResistance.price-currentPrice)/currentPrice`
- `nest/src/modules/directives/implementations/session-open-effect.directive.ts:147` ÔÇö `calculate()` ÔåÆ `preOpenReturn`
  - `(preOpenEnd-preOpenStart)/preOpenStart`
- `nest/src/modules/directives/implementations/mt5-indicators.directives.ts:872` ÔÇö `calculate()` ÔåÆ `priceSlope`
  - `(recentPrices[recentPrices.length-1]-recentPrices[0])/recentPrices[0]`
- ÔÇª and 2 more

### 10 sites ÔÇö `(V1+V2)/2`

- `nest/src/modules/directives/implementations/three-soldiers-pattern.directive.ts:96` ÔÇö `calculate()` ÔåÆ `avgProgression`
  - `(progression1+progression2)/2`
- `nest/src/modules/directives/implementations/mt5-engulfing.directive.ts:69` ÔÇö `calculate()` ÔåÆ `prevMidpoint`
  - `(prev.high+prev.low)/2`
- `nest/src/modules/directives/implementations/liquidity-check.directive.ts:94` ÔÇö `(anonymous)()` ÔåÆ `mid`
  - `(b.high+b.low)/2`
- `nest/src/modules/directives/implementations/mt5-indicators.directives.ts:332` ÔÇö `calculate()` ÔåÆ `midBand`
  - `(upperBand+lowerBand)/2`
- `nest/src/modules/directives/implementations/mt5-indicators.directives.ts:445` ÔÇö `calculate()` ÔåÆ `midline`
  - `(lastHigh+lastLow)/2`
- `nest/src/modules/directives/implementations/momentum-and-macro.directives.ts:125` ÔÇö `calculate()` ÔåÆ `avgDist`
  - `(dist20+dist50)/2`
- `nest/src/modules/directives/implementations/fair-value-gap.directive.ts:78` ÔÇö `calculate()` ÔåÆ `gapMid`
  - `(gap.top+gap.bottom)/2`
- `nest/src/modules/directives/implementations/market-memory-zones.directive.ts:123` ÔÇö `findMemoryZones()`
  - `(bar.open+bar.close)/2`
- ÔÇª and 2 more

### 9 sites ÔÇö `(V1-V2)/V1`

- `nest/src/modules/risk/risk.service.ts:76` ÔÇö `calculateTakeProfit()` ÔåÆ `slDistance`
  - `(entryPrice-stopLossPrice)/entryPrice`
- `nest/src/modules/risk/risk.service.ts:183` ÔÇö `checkDrawdown()` ÔåÆ `drawdown`
  - `peakValue>0?(peakValue-currentValue)/peakValue:0`
  - guarded by: `peakValue>0`
- `nest/src/modules/directives/implementations/confluence-reversal.directive.ts:107` ÔÇö `calculate()` ÔåÆ `depth`
  - `(OVERSOLD-currentRsi)/OVERSOLD`
- `nest/src/modules/directives/implementations/mt5-indicators.directives.ts:545` ÔÇö `calculate()` ÔåÆ `dist`
  - `(lastClose-lastSAR)/lastClose`
- `nest/src/modules/directives/implementations/mt5-indicators.directives.ts:697` ÔÇö `calculate()` ÔåÆ `distAboveLong`
  - `(lastClose-longStop)/lastClose`
- `nest/src/modules/directives/implementations/mt5-indicators.directives.ts:698` ÔÇö `calculate()` ÔåÆ `distBelowShort`
  - `(lastClose-shortStop)/lastClose`
- `nest/src/modules/scoring/scoring.controller.ts:102` ÔÇö `getDegradation()` ÔåÆ `coverage`
  - `allProviders.length>0?(allProviders.length-failedProviders.length)/allProviders.length:1.0`
  - guarded by: `allProviders.length>0`
- `nest/src/modules/scoring/averaging-scorer.ts:73` ÔÇö `evaluate()` ÔåÆ `priceDrop`
  - `(position.averageEntry-position.currentPrice)/position.averageEntry`
- ÔÇª and 1 more

_ÔÇª and 33 further group(s)._

## Q3b ÔÇö the same shape, differing constants

Numeric literals blanked. **This is where divergent maths hides** ÔÇö same structure, a different number doing the work.

### 39 sites ÔÇö `(VN-VN)/VN`

- `nest/src/modules/risk/risk.service.ts:76` ÔÇö `calculateTakeProfit()` ÔåÆ `slDistance`
  - `(entryPrice-stopLossPrice)/entryPrice`
- `nest/src/modules/risk/risk.service.ts:183` ÔÇö `checkDrawdown()` ÔåÆ `drawdown`
  - `peakValue>0?(peakValue-currentValue)/peakValue:0`
  - guarded by: `peakValue>0`
- `nest/src/modules/providers/adapters/finnhub.adapter.ts:505` ÔÇö `parseSentimentScore()`
  - `(bullish-bearish)/total`
- `nest/src/modules/directives/implementations/ema-structure.directive.ts:46` ÔÇö `calculate()` ÔåÆ `priceSep`
  - `(currentPrice-currentEma20)/currentEma20`
- `nest/src/modules/directives/implementations/ema-structure.directive.ts:54` ÔÇö `calculate()` ÔåÆ `emaSep`
  - `(currentEma20-currentEma50)/currentEma50`
- `nest/src/modules/directives/implementations/three-soldiers-pattern.directive.ts:77` ÔÇö `bodyRatio()`
  - `range>0?(bar.close-bar.open)/range:0`
  - guarded by: `range>0`
- `nest/src/modules/directives/implementations/three-soldiers-pattern.directive.ts:94` ÔÇö `calculate()` ÔåÆ `progression1`
  - `(b2.close-b1.close)/b1.close`
- `nest/src/modules/directives/implementations/three-soldiers-pattern.directive.ts:95` ÔÇö `calculate()` ÔåÆ `progression2`
  - `(b3.close-b2.close)/b2.close`
- ÔÇª and 31 more

### 37 sites ÔÇö `((VN-VN)/VN)*N`

- `nest/src/modules/market-data/market-data.service.ts:145` ÔÇö `getTopMovers()` ÔåÆ `changePct`
  - `((latest.close-previous.close)/previous.close)*100`
- `nest/src/modules/automation/stop-guardian.service.ts:1650` ÔÇö `observeExhaustion()` ÔåÆ `decelPct`
  - `((prior-recent)/prior)*100`
- `nest/src/modules/providers/adapters/finnhub.adapter.ts:365` ÔÇö `getPriceTarget()` ÔåÆ `upside`
  - `currentPrice>0?((avgTarget-currentPrice)/currentPrice)*100:null`
  - guarded by: `currentPrice>0`
- `nest/src/modules/research/investigation.service.ts:225` ÔÇö `computeConviction()` ÔåÆ `upside`
  - `((analystTarget.mean-price)/price)*100`
- `nest/src/modules/directives/implementations/price-above-sma.directive.ts:59` ÔÇö `calculate()` ÔåÆ `distancePct`
  - `((currentPrice-sma50)/sma50)*100`
- `nest/src/modules/directives/implementations/vwap.directive.ts:48` ÔÇö `calculate()` ÔåÆ `distancePct`
  - `((currentPrice-currentVwap)/currentVwap)*100`
- `nest/src/modules/directives/implementations/vwap-confluence.directive.ts:84` ÔÇö `calculate()` ÔåÆ `distPct`
  - `((lastClose-vwapVal)/vwapVal)*100`
- `nest/src/modules/directives/implementations/gap-scanner.directive.ts:83` ÔÇö `evaluateGap()` ÔåÆ `gapPct`
  - `((currentOpen-prevClose)/prevClose)*100`
- ÔÇª and 29 more

### 24 sites ÔÇö `(VN/VN)*N`

- `nest/src/modules/automation/stop-guardian.service.ts:1673` ÔÇö `observeExhaustion()`
  - `(recent/entry)*100`
- `nest/src/modules/automation/stop-guardian.service.ts:1674` ÔÇö `observeExhaustion()`
  - `(prior/entry)*100`
- `nest/src/modules/providers/adapters/trading212.adapter.ts:616` ÔÇö `getAccount()`
  - `cash.total>0?(cash.free/cash.total)*100:null`
  - guarded by: `cash.total>0`
- `nest/src/modules/directives/implementations/multi-timeframe-trend.directive.ts:284` ÔÇö `adx()` ÔåÆ `diPlus`
  - `atr[atr.length-1]>0?(smoothedPlusDm[smoothedPlusDm.length-1]/atr[atr.length-1])*100:0`
  - guarded by: `atr[atr.length-1]>0`
- `nest/src/modules/directives/implementations/multi-timeframe-trend.directive.ts:289` ÔÇö `adx()` ÔåÆ `diMinus`
  - `atr[atr.length-1]>0?(smoothedMinusDm[smoothedMinusDm.length-1]/atr[atr.length-1])*100:0`
  - guarded by: `atr[atr.length-1]>0`
- `nest/src/modules/directives/implementations/momentum-and-macro.directives.ts:212` ÔÇö `calculate()` ÔåÆ `atrPct`
  - `(currentAtr/lastClose)*100`
- `nest/src/modules/directives/implementations/momentum-and-macro.directives.ts:217` ÔÇö `calculate()` ÔåÆ `percentile`
  - `rank>=0?(rank/sortedAtr.length)*100:50`
  - guarded by: `rank>=0`
- `nest/src/modules/directives/implementations/momentum-and-macro.directives.ts:1162` ÔÇö `calculate()` ÔåÆ `atrPct`
  - `(currentAtr/lastClose)*100`
- ÔÇª and 16 more

### 17 sites ÔÇö `Math.round((VN/VN)*N)`

- `nest/src/modules/scoring/risk-gating-engine.service.ts:155` ÔÇö `apply()` ÔåÆ `riskScore`
  - `totalRiskWeight>0?Math.round((weightedRiskSum/totalRiskWeight)*100):50`
  - guarded by: `totalRiskWeight>0`
- `nest/src/modules/scoring/protocol-gating.service.ts:1406` ÔÇö `computeRarity()` ÔåÆ `percentile`
  - `Math.round((countBelow/scores.length)*100)`
- `nest/src/modules/trading/trade-history.controller.ts:169` ÔÇö `(anonymous)()` ÔåÆ `winRate`
  - `s.trades>0?Math.round((s.wins/s.trades)*100):0`
  - guarded by: `s.trades>0`
- `nest/src/modules/portfolio/trading212-import.service.ts:344` ÔÇö `buildSummary()`
  - `trades.length>0?Math.round((winning.length/trades.length)*100):0`
  - guarded by: `trades.length>0`
- `nest/src/modules/scoring/outcome-tracker.service.ts:215` ÔÇö `logDropRate()` ÔåÆ `pct`
  - `considered>0?Math.round((dropped/considered)*100):0`
  - guarded by: `considered>0`
- `nest/src/modules/system/system-health.service.ts:349` ÔÇö `getSystemVitals()`
  - `Math.round((usedMem/totalMem)*100)`
- `nest/src/modules/system/system-health.service.ts:477` ÔÇö `getDiskInfo()` ÔåÆ `pct`
  - `Math.round((usedB/totalB)*100)`
- `nest/src/modules/signals/signal-envelope.service.ts:1824` ÔÇö `getAnalytics()`
  - `closed>0?Math.round((won/closed)*100):null`
  - guarded by: `closed>0`
- ÔÇª and 9 more

### 13 sites ÔÇö `Math.max(N,Math.min(N,(VN-VN)/(VN-VN)))`

- `nest/src/modules/directives/implementations/rsi-oversold.directive.ts:31` ÔÇö `mapRange()` ÔåÆ `t`
  - `Math.max(0,Math.min(1,(v-inMin)/(inMax-inMin)))`
- `nest/src/modules/directives/implementations/atr-dip.directive.ts:18` ÔÇö `mapRange()` ÔåÆ `t`
  - `Math.max(0,Math.min(1,(v-inMin)/(inMax-inMin)))`
- `nest/src/modules/directives/implementations/mfi.directive.ts:17` ÔÇö `mapRange()` ÔåÆ `t`
  - `Math.max(0,Math.min(1,(v-inMin)/(inMax-inMin)))`
- `nest/src/modules/directives/implementations/adx.directive.ts:18` ÔÇö `mapRange()` ÔåÆ `t`
  - `Math.max(0,Math.min(1,(v-inMin)/(inMax-inMin)))`
- `nest/src/modules/directives/implementations/stochastic.directive.ts:18` ÔÇö `mapRange()` ÔåÆ `t`
  - `Math.max(0,Math.min(1,(v-inMin)/(inMax-inMin)))`
- `nest/src/modules/directives/implementations/stoch-rsi.directive.ts:60` ÔÇö `mapRange()` ÔåÆ `t`
  - `Math.max(0,Math.min(1,(v-inMin)/(inMax-inMin)))`
- `nest/src/modules/directives/implementations/rsi-overbought.directive.ts:23` ÔÇö `mapRange()` ÔåÆ `t`
  - `Math.max(0,Math.min(1,(v-inMin)/(inMax-inMin)))`
- `nest/src/modules/directives/implementations/cci.directive.ts:17` ÔÇö `mapRange()` ÔåÆ `t`
  - `Math.max(0,Math.min(1,(v-inMin)/(inMax-inMin)))`
- ÔÇª and 5 more

### 12 sites ÔÇö `(VN-VN)/Math.max(N,VN)*N`

- `nest/src/modules/directives/implementations/momentum-and-macro.directives.ts:498` ÔÇö `calculate()` ÔåÆ `recentReturn`
  - `closes.length>5?(closes[closes.length-1]-closes[closes.length-6])/Math.max(0.01,closes[closes.length-6])*100:0`
  - guarded by: `closes.length>5`
- `nest/src/modules/directives/implementations/momentum-and-macro.directives.ts:612` ÔÇö `calculate()` ÔåÆ `recentReturn`
  - `closes.length>5?(closes[closes.length-1]-closes[closes.length-6])/Math.max(0.01,closes[closes.length-6])*100:0`
  - guarded by: `closes.length>5`
- `nest/src/modules/directives/implementations/momentum-and-macro.directives.ts:652` ÔÇö `calculate()` ÔåÆ `ret5`
  - `(closes[closes.length-1]-closes[closes.length-6])/Math.max(0.01,closes[closes.length-6])*100`
- `nest/src/modules/directives/implementations/momentum-and-macro.directives.ts:653` ÔÇö `calculate()` ÔåÆ `ret20`
  - `(closes[closes.length-1]-closes[closes.length-21])/Math.max(0.01,closes[closes.length-21])*100`
- `nest/src/modules/directives/implementations/momentum-and-macro.directives.ts:710` ÔÇö `calculate()` ÔåÆ `ret5`
  - `(closes[closes.length-1]-closes[closes.length-6])/Math.max(0.01,closes[closes.length-6])*100`
- `nest/src/modules/directives/implementations/momentum-and-macro.directives.ts:804` ÔÇö `calculate()` ÔåÆ `ret20`
  - `(closes[closes.length-1]-closes[0])/Math.max(0.01,closes[0])*100`
- `nest/src/modules/directives/implementations/momentum-and-macro.directives.ts:1250` ÔÇö `calculate()` ÔåÆ `ret5`
  - `(closes[closes.length-1]-closes[closes.length-6])/Math.max(0.01,closes[closes.length-6])*100`
- `nest/src/modules/directives/implementations/momentum-and-macro.directives.ts:1251` ÔÇö `calculate()` ÔåÆ `ret5prev`
  - `closes.length>11?(closes[closes.length-6]-closes[closes.length-11])/Math.max(0.01,closes[closes.length-11])*100:0`
  - guarded by: `closes.length>11`
- ÔÇª and 4 more

### 11 sites ÔÇö `Math.abs(VN-VN)/VN`

- `nest/src/modules/directives/implementations/ma-crossover.directive.ts:67` ÔÇö `calculate()` ÔåÆ `separation`
  - `Math.abs(currFast-currSlow)/currSlow`
- `nest/src/modules/directives/implementations/micro-sr-levels.directive.ts:260` ÔÇö `calculate()` ÔåÆ `distPct`
  - `Math.abs(currentPrice-zone.price)/zone.price`
- `nest/src/modules/directives/implementations/fibonacci-levels.directive.ts:94` ÔÇö `calculate()` ÔåÆ `distPct`
  - `Math.abs(currentPrice-level.price)/currentPrice`
- `nest/src/modules/directives/implementations/fibonacci-levels.directive.ts:125` ÔÇö `calculate()` ÔåÆ `prevDist`
  - `Math.abs(prevBar.close-closestLevel.price)/closestLevel.price`
- `nest/src/modules/directives/implementations/fibonacci-levels.directive.ts:126` ÔÇö `calculate()` ÔåÆ `move`
  - `Math.abs(currentPrice-prevBar.close)/prevBar.close`
- `nest/src/modules/directives/implementations/gold-round-numbers.directive.ts:96` ÔÇö `calculate()` ÔåÆ `distMajorPct`
  - `Math.abs(price-nearestMajor)/price`
- `nest/src/modules/directives/implementations/gold-round-numbers.directive.ts:97` ÔÇö `calculate()` ÔåÆ `distMinorPct`
  - `Math.abs(price-nearestMinor)/price`
- `nest/src/modules/directives/implementations/gold-round-numbers.directive.ts:98` ÔÇö `calculate()` ÔåÆ `distMicroPct`
  - `Math.abs(price-nearestMicro)/price`
- ÔÇª and 3 more

### 10 sites ÔÇö `(VN+VN+VN)/N`

- `nest/src/modules/directives/utils/indicators.ts:738` ÔÇö `vwap()` ÔåÆ `tp`
  - `(highs[i]+lows[i]+closes[i])/3`
- `nest/src/modules/directives/implementations/three-soldiers-pattern.directive.ts:93` ÔÇö `calculate()` ÔåÆ `avgBodyRatio`
  - `(br1+br2+br3)/3`
- `nest/src/modules/directives/implementations/vwap-confluence.directive.ts:36` ÔÇö `computeVwap()` ÔåÆ `tp`
  - `(highs[i]+lows[i]+closes[i])/3`
- `nest/src/modules/directives/implementations/vwap-confluence.directive.ts:47` ÔÇö `computeVwapStdDev()` ÔåÆ `tp`
  - `(highs[i]+lows[i]+closes[i])/3`
- `nest/src/modules/directives/implementations/multi-timeframe-trend.directive.ts:325` ÔÇö `vwap()` ÔåÆ `tp`
  - `(highs[i]+lows[i]+closes[i])/3`
- `nest/src/modules/directives/implementations/micro-sr-levels.directive.ts:305` ÔÇö `computeVwap()` ÔåÆ `tp`
  - `(b.high+b.low+b.close)/3`
- `nest/src/modules/directives/implementations/momentum-and-macro.directives.ts:865` ÔÇö `calculate()` ÔåÆ `tp`
  - `(bar.high+bar.low+bar.close)/3`
- `nest/src/modules/indicators/indicators.service.ts:71` ÔÇö `computeSupportResistance()` ÔåÆ `pivot`
  - `(prev.high+prev.low+prev.close)/3`
- ÔÇª and 2 more

### 10 sites ÔÇö `(VN+VN)/N`

- `nest/src/modules/directives/implementations/three-soldiers-pattern.directive.ts:96` ÔÇö `calculate()` ÔåÆ `avgProgression`
  - `(progression1+progression2)/2`
- `nest/src/modules/directives/implementations/mt5-engulfing.directive.ts:69` ÔÇö `calculate()` ÔåÆ `prevMidpoint`
  - `(prev.high+prev.low)/2`
- `nest/src/modules/directives/implementations/liquidity-check.directive.ts:94` ÔÇö `(anonymous)()` ÔåÆ `mid`
  - `(b.high+b.low)/2`
- `nest/src/modules/directives/implementations/mt5-indicators.directives.ts:332` ÔÇö `calculate()` ÔåÆ `midBand`
  - `(upperBand+lowerBand)/2`
- `nest/src/modules/directives/implementations/mt5-indicators.directives.ts:445` ÔÇö `calculate()` ÔåÆ `midline`
  - `(lastHigh+lastLow)/2`
- `nest/src/modules/directives/implementations/momentum-and-macro.directives.ts:125` ÔÇö `calculate()` ÔåÆ `avgDist`
  - `(dist20+dist50)/2`
- `nest/src/modules/directives/implementations/fair-value-gap.directive.ts:78` ÔÇö `calculate()` ÔåÆ `gapMid`
  - `(gap.top+gap.bottom)/2`
- `nest/src/modules/directives/implementations/market-memory-zones.directive.ts:123` ÔÇö `findMemoryZones()`
  - `(bar.open+bar.close)/2`
- ÔÇª and 2 more

### 7 sites ÔÇö `Math.round((VN/VN)*N)/N`

- `nest/src/modules/scoring/outcome-tracker.service.ts:239` ÔÇö `getRecordingStats()`
  - `considered>0?Math.round((identity/considered)*1000)/10:0`
  - guarded by: `considered>0`
- `nest/src/modules/scoring/outcome-tracker.service.ts:712` ÔÇö `getAccuracy()`
  - `total>0?Math.round((correct/total)*1000)/1000:0`
  - guarded by: `total>0`
- `nest/src/modules/performance/performance.service.ts:244` ÔÇö `computeStrategyStats()`
  - `wins.length>0?Math.round((totalWin/wins.length)*100)/100:0`
  - guarded by: `wins.length>0`
- `nest/src/modules/performance/performance.service.ts:245` ÔÇö `computeStrategyStats()`
  - `losses.length>0?Math.round((totalLoss/losses.length)*100)/100:0`
  - guarded by: `losses.length>0`
- `nest/src/modules/backtest/backtest.service.ts:1671` ÔÇö `runDirectiveCoverage()`
  - `total5d>0?Math.round((sumReturn5d/total5d)*100)/100:0`
  - guarded by: `total5d>0`
- `nest/src/modules/backtest/backtest.service.ts:1673` ÔÇö `runDirectiveCoverage()`
  - `total10d>0?Math.round((sumReturn10d/total10d)*100)/100:0`
  - guarded by: `total10d>0`
- `nest/src/modules/ai/portfolio-lab.service.ts:154` ÔÇö `analyze()`
  - `totalCost>0?Math.round((totalPnl/totalCost)*1000)/10:0`
  - guarded by: `totalCost>0`

_ÔÇª and 30 further group(s)._

## Q3c ÔÇö the same idea, re-derived

A difference and its mirror in one expression. **This is the tier that finds a copy whose variable names, branch order and division position have all changed.** It is wider than `exact` on purpose, so it is longer ÔÇö read the group, not the count.

### 5 sites ÔÇö `SIGNED-MIRROR-DIFF`

- `nest/src/modules/automation/stop-guardian.service.ts:1541` ÔÇö `observeSimulatedTsl()` ÔåÆ `profitPct`
  - `((isBuy?pos.priceCurrent-pos.priceOpen:pos.priceOpen-pos.priceCurrent)/pos.priceOpen)*100`
  - conditions: `isBuy`
- `nest/src/modules/automation/stop-guardian.service.ts:1659` ÔÇö `observeExhaustion()` ÔåÆ `profitPct`
  - `((isBuy?pos.priceCurrent-entry:entry-pos.priceCurrent)/entry)*100`
  - conditions: `isBuy`
- `nest/src/common/trading/peak.ts:96` ÔÇö `profitPctFor()` ÔåÆ `raw`
  - `isShort?(entry-px)/entry:(px-entry)/entry`
  - conditions: `isShort`
- `nest/src/modules/scoring/exit-consensus.service.ts:373` ÔÇö `assessOne()` ÔåÆ `profitPct`
  - `entry>0?((side==='buy'?current-entry:entry-current)/entry)*100:0`
  - conditions: `side==='buy'`
  - guarded by: `entry>0`
- `nest/src/modules/scoring/exit-consensus.service.ts:374` ÔÇö `assessOne()` ÔåÆ `peakProfitPct`
  - `peak==null||entry<=0?null:((side==='buy'?peak-entry:entry-peak)/entry)*100`
  - conditions: `side==='buy'`
  - guarded by: `peak==null||entry<=0`

## Nodes with no consumer

A function in the scanned set that nothing calls, that is not exported, and that the framework does not call. **Exported and framework-called nodes are excluded rather than counted** ÔÇö a NestJS controller method with `@Get()` has callers the source cannot show, and reporting it as unreferenced would be a false finding.

- `nest/src/modules/directives/utils/indicators.ts:322 smooth`
- `nest/src/modules/scoring/strategy-derivation.service.ts:395 num`
- `nest/src/modules/trading/trade-recorder.service.ts:167 reject`
- `nest/src/modules/providers/mt5/mt5-symbol-router.service.ts:371 getBrokerSymbol`
- `nest/src/modules/directives/directives.service.ts:243 prepare`
- `nest/src/modules/directives/directives.service.ts:462 evaluateGate`
- `nest/src/modules/directives/directives.service.ts:878 refreshActiveStatuses`
- `nest/src/modules/scoring/protocol-db.service.ts:435 getAllSlugs`
- `nest/src/modules/scoring/protocol-db.service.ts:947 protocolNeedsEurUsd`
- `nest/src/modules/scoring/protocol-db.service.ts:963 getName`
- `nest/src/modules/market-data/market-data.service.ts:33 evaluateFreshness`
- `nest/src/modules/scoring/protocol-gating.service.ts:1273 worker`
- `nest/src/modules/scoring/protocol-health.service.ts:558 getLast`
- `nest/src/modules/trading/trading-strategy.service.ts:252 num`
- `nest/src/modules/trading/trading-strategy.service.ts:1081 shape`
- `nest/src/modules/trading/trading-strategy.service.ts:2327 evaluateAllActive`
- `nest/src/modules/automation/stop-guardian.service.ts:568 flat`
- `nest/src/modules/automation/stop-guardian.service.ts:1634 progress`
- `nest/src/app.controller.ts:61 canTrade`
- `nest/src/modules/providers/position-sync.service.ts:468 note`
- `nest/src/modules/providers/adapters/trading212.adapter.ts:534 getCapabilities`
- `nest/src/modules/providers/adapters/finnhub.adapter.ts:215 getNews`
- `nest/src/modules/providers/adapters/finnhub.adapter.ts:224 getSentiment`
- `nest/src/modules/providers/adapters/finnhub.adapter.ts:245 getRecommendations`
- `nest/src/modules/providers/adapters/finnhub.adapter.ts:297 collectRange`
- `nest/src/modules/providers/adapters/finnhub.adapter.ts:345 getPriceTarget`
- `nest/src/modules/providers/adapters/finnhub.adapter.ts:394 getSocialSentiment`
- `nest/src/modules/providers/adapters/finnhub.adapter.ts:436 getInsiderTransactions`
- `nest/src/modules/providers/adapters/finnhub.adapter.ts:464 getCompanyMetrics`
- `nest/src/modules/providers/adapters/finnhub.adapter.ts:508 getCapabilities`
- `nest/src/modules/research/research-overview.service.ts:155 classify`
- `nest/src/modules/research/earnings-import-settings.service.ts:238 getRunState`
- `nest/src/modules/research/research-import.service.ts:195 isAllowed`
- `nest/src/modules/research/research-import.service.ts:311 upsertOne`
- `nest/src/modules/research/research-import.service.ts:627 importInsiderTransactionsBulk`
- `nest/src/modules/research/research-import.service.ts:767 importCompanyMetricsBulk`
- `nest/src/modules/research/investigation.service.ts:355 deleteStale`
- `nest/src/modules/market-data/bar-refresh.service.ts:537 getProviderAdapter`
- `nest/src/modules/market-data/bar-refresh.service.ts:569 newestOf`
- `nest/src/modules/market-data/bar-refresh.service.ts:574 isStaleSet`
- `nest/src/modules/market-data/bar-refresh.service.ts:614 fetchBridgeCandles`
- `nest/src/modules/directives/implementations/three-soldiers-pattern.directive.ts:68 openInPrevBody`
- `nest/src/modules/directives/implementations/three-soldiers-pattern.directive.ts:75 bodyRatio`
- `nest/src/modules/directives/implementations/volatility-envelope.directive.ts:69 percentile`
- `nest/src/modules/directives/implementations/session-open-effect.directive.ts:50 s`
- `nest/src/modules/directives/implementations/session-open-effect.directive.ts:51 to`
- `nest/src/modules/directives/implementations/mt5-indicators.directives.ts:38 avg`
- `nest/src/modules/directives/implementations/mt5-indicators.directives.ts:1028 mid`
- `nest/src/modules/directives/implementations/momentum-and-macro.directives.ts:60 stubResult`
- `nest/src/modules/directives/implementations/momentum-and-macro.directives.ts:236 extract`
- `nest/src/modules/directives/implementations/market-regime.directive.ts:116 smooth`
- `nest/src/modules/trading/duplicate-guard.service.ts:149 isBlocked`
- `nest/src/modules/scoring/pnl-statistics.service.ts:135 empty`
- `nest/src/modules/trading/bot-performance.service.ts:362 empty`
- `nest/src/modules/trading/bot-performance.service.ts:438 readAll`
- `nest/src/modules/trading/trade-history.controller.ts:441 round2`
- `nest/src/modules/trading/trade-history.controller.ts:643 readAll`
- `nest/src/modules/trading/trade-history.controller.ts:668 resolveProtocol`
- `nest/src/modules/trading/trade-history.controller.ts:767 median`
- `nest/src/modules/trading/trade-history.controller.ts:773 r2`
- `nest/src/modules/trading/trade-history.controller.ts:1073 distOf`
- `nest/src/modules/trading/trade-history.controller.ts:1077 consensusOf`
- `nest/src/modules/trading/trade-history.controller.ts:1082 sorted`
- `nest/src/modules/trading/trade-history.controller.ts:1083 pct`
- `nest/src/modules/trading/trade-history.controller.ts:1200 slPctOf`
- `nest/src/modules/risk/monte-carlo.service.ts:67 simulate`
- `nest/src/modules/scoring/score-history.service.ts:116 richness`
- `nest/src/modules/scoring/score-history.service.ts:130 isWorkbench`
- `nest/src/modules/scoring/score-history.service.ts:402 truncateToMinute`
- `nest/src/modules/scoring/scoring.service.ts:818 debug`
- `nest/src/modules/portfolio/portfolio.service.ts:230 norm`
- `nest/src/modules/providers/provider-cache.service.ts:62 getStatus`
- `nest/src/modules/scoring/arena.controller.ts:462 isBuy`
- `nest/src/modules/scoring/arena.controller.ts:463 isSell`
- `nest/src/modules/scoring/protocols.controller.ts:61 recordActivity`
- `nest/src/modules/scoring/protocol-gating.controller.ts:479 isIncluded`
- `nest/src/modules/scoring/protocol-gating.controller.ts:484 effectiveMax`
- `nest/src/modules/scoring/score-velocity.service.ts:112 flatten`
- `nest/src/modules/scoring/outcome-tracker.service.ts:724 trimOldOutcomes`
- `nest/src/modules/scoring/averaging-scorer.ts:52 setPolicy`
- `nest/src/modules/scoring/averaging-scorer.ts:56 getPolicy`
- `nest/src/modules/scoring/averaging-scorer.ts:60 evaluate`
- `nest/src/modules/scoring/exit-consensus.service.ts:264 assessAll`
- `nest/src/modules/symbols/symbol-protocol-authority.service.ts:166 note`
- `nest/src/modules/symbols/symbol-protocol-authority.service.ts:179 runSource`
- `nest/src/modules/symbols/symbol-protocol-authority.service.ts:283 observedOnly`
- `nest/src/modules/symbols/symbol-protocol-authority.service.ts:328 note`
- `nest/src/modules/symbols/symbol-protocol-authority.service.ts:342 runSource`
- `nest/src/modules/symbols/symbols.service.ts:897 parseLatest`
- `nest/src/modules/symbols/symbols.service.ts:904 num`
- `nest/src/modules/symbols/symbols.service.ts:1053 readWatchlist`
- `nest/src/modules/strategies/strategies.service.ts:56 calculateScore`
- `nest/src/modules/signals/signal-queue.service.ts:264 getQueue`
- `nest/src/modules/signals/signal-envelope.service.ts:497 newestOfTf`
- `nest/src/modules/signals/signal-envelope.service.ts:1542 isRouteable`
- `nest/src/modules/signals/signal-envelope.service.ts:1727 q`
- `nest/src/modules/signals/signal-envelope.service.ts:1735 first`
- `nest/src/modules/alerts/alert-trigger.service.ts:115 stop`
- `nest/src/modules/alerts/alert-trigger.service.ts:189 label`
- `nest/src/modules/alerts/alert-trigger.service.ts:241 canTrade`
- `nest/src/modules/alerts/alert-trigger.service.ts:249 definitelyBlocked`
- `nest/src/modules/alerts/alert-trigger.service.ts:748 toMap`
- `nest/src/modules/automation/ab-test.service.ts:300 getActiveTest`
- `nest/src/modules/automation/ab-test.service.ts:359 isActive`
- `nest/src/modules/automation/ab-test.service.ts:590 summarize`
- `nest/src/modules/automation/automation-loop.service.ts:339 getWatchlistSymbols`
- `nest/src/modules/automation/automation-loop.service.ts:1589 evalSide`
- `nest/src/modules/automation/automation-loop.service.ts:1877 getClose`
- `nest/src/modules/automation/automation.controller.ts:726 safe`
- `nest/src/modules/scheduler/trading-scheduler.service.ts:251 start`
- `nest/src/modules/scheduler/trading-scheduler.service.ts:256 stop`
- `nest/src/modules/scheduler/trading-scheduler.service.ts:261 getStatus`
- `nest/src/modules/scheduler/trading-scheduler.service.ts:270 runNow`
- `nest/src/modules/scheduler/trading-scheduler.service.ts:274 getHistory`
- `nest/src/modules/backtest/backtest.service.ts:238 pick`
- `nest/src/modules/backtest/backtest.controller.ts:310 mapResult`
- `nest/src/modules/replay/replay.service.ts:483 computeReturn`
- `nest/src/modules/replay/replay.service.ts:508 avg`
- `nest/src/common/cache/cache.service.ts:39 get`
- `nest/src/common/cache/cache.service.ts:58 set`
- `nest/src/common/cache/cache.service.ts:69 del`
- `nest/src/modules/screener/screener.service.ts:183 bump`
- `nest/src/modules/paper-trading/paper-trading.service.ts:72 setStartingBalance`
- `nest/src/modules/paper-trading/paper-trading.service.ts:79 updateQuote`
- `nest/src/modules/planner/planner.service.ts:59 updateStylePreferences`
- `nest/src/modules/directives/implementations/pattern-density-sr.directive.ts:100 binPrice`
- `nest/src/modules/scoring/rarity.service.ts:89 computeRarity`
- `nest/src/modules/scoring/rarity.service.ts:136 captureSnapshot`
- `nest/src/modules/scoring/rarity.service.ts:159 getDistributionStats`

