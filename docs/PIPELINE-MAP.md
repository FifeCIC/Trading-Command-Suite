# PIPELINE-MAP — the bars pipeline and its maths, generated from source

**Status:** active · **Category:** C (reference/contract) · **Owner:** generated — do not edit by hand
**Created:** 2026-10-05 · **Last updated:** 2026-10-05

> ⚠️ **GENERATED — do not edit.** Regenerate with `node scripts/generate-pipeline-map.cjs`.
> Phases 1–2 of #1071. Reads the source, so it cannot drift from it.

Scanned **556** backend source files (specs excluded). Two access paths, because one
of them is invisible to the other: **Prisma model calls** and **raw SQL**. The writer that
fabricated 1,172 bars (#1068) is only findable through the second.

## Ingest

### `symbol`

- **writers (9):** `backtest-period.service.ts`, `import-jobs.service.ts`, `portfolio.service.ts`, `trading212-import.service.ts`, `mt5.controller.ts`, `symbol-name-enricher.service.ts`, `symbols.controller.ts`, `symbols.service.ts`, `webhooks.controller.ts`
- **readers (44):** `alert-trigger.service.ts`, `architecture.service.ts`, `automation-loop.service.ts`, `protocol-runner.service.ts`, `backtest-period.service.ts`, `backtest.service.ts`, `directives.controller.ts`, `data-import-orchestrator.service.ts`, `import-jobs.service.ts`, `indicators.service.ts`, `bar-refresh.service.ts`, `freshness.service.ts`, `market-data.service.ts`, `correlation.service.ts`, `trading212-import.service.ts`, `replay.service.ts`, `research-import.service.ts`, `trading-scheduler.service.ts`, `arena.controller.ts`, `decision-chain.service.ts`, `directive-impact.service.ts`, `exit-consensus.service.ts`, `outcome-tracker.service.ts`, `protocol-consensus.service.ts`, `protocol-gating.controller.ts`, `protocol-gating.service.ts`, `score-history.service.ts`, `score-velocity.service.ts`, `scoring.service.ts`, `sector-rotation.service.ts`, `speed-scan.controller.ts`, `speed-scan.service.ts`, `screener.service.ts`, `signal-envelope.service.ts`, `snapshot-comparison.service.ts`, `snapshots.module.ts`, `suitability.controller.ts`, `broker-symbol-discovery.service.ts`, `symbol-name-enricher.service.ts`, `symbol-resolver.service.ts`, `symbols.controller.ts`, `symbols.service.ts`, `trading-strategy.service.ts`, `webhooks.controller.ts`

### `symbol_route`

- **writers (1):** `mt5.controller.ts`
- **readers (7):** `alert-trigger.service.ts`, `backtest.service.ts`, `bar-refresh.service.ts`, `mt5.controller.ts`, `mt5-symbol-router.service.ts`, `broker-symbol-discovery.service.ts`, `broker-symbols.controller.ts`

## Bar store

### `marketbar`

- **writers (8):** `backtest-period.service.ts`, `import-jobs.service.ts`, `bar-refresh.service.ts`, `replay.service.ts`, `scoring.service.ts`, `tick-recorder.service.ts`, `trading-strategy.service.ts`, `webhooks.controller.ts`
- **readers (25):** `alert-trigger.service.ts`, `backtest-period.service.ts`, `backtest.controller.ts`, `backtest.service.ts`, `directive-preview.service.ts`, `import-jobs.service.ts`, `indicators.service.ts`, `bar-refresh.service.ts`, `freshness.service.ts`, `market-data.service.ts`, `correlation.service.ts`, `replay.service.ts`, `research-overview.service.ts`, `weekend-gap-risk.service.ts`, `trading-scheduler.service.ts`, `outcome-tracker.service.ts`, `scoring.service.ts`, `tick-recorder.service.ts`, `snapshot-comparison.service.ts`, `snapshots.module.ts`, `strategies.controller.ts`, `symbols.controller.ts`, `symbols.service.ts`, `system-health.service.ts`, `trading-strategy.service.ts`

## Score

### `score`

- **writers (3):** `protocol-gating.service.ts`, `score-history.service.ts`, `data-retention.service.ts`
- **readers (14):** `alert-trigger.service.ts`, `directives.controller.ts`, `directives.service.ts`, `research-overview.service.ts`, `decision-chain.service.ts`, `directive-impact.service.ts`, `protocol-gating.controller.ts`, `protocol-health.service.ts`, `score-history.service.ts`, `score-velocity.service.ts`, `scoring.service.ts`, `signal-envelope.service.ts`, `symbols.service.ts`, `data-retention.service.ts`

### `directiveoutcome`

- **writers (1):** `outcome-tracker.service.ts`
- **readers (2):** `edge-statistics.service.ts`, `outcome-tracker.service.ts`

### `protocol`

- **writers (5):** `protocol-db.service.ts`, `protocol-gating.controller.ts`, `protocol-gating.service.ts`, `protocols.controller.ts`, `signal-envelope.service.ts`
- **readers (22):** `app.controller.ts`, `architecture.service.ts`, `backtest.controller.ts`, `replay.service.ts`, `protocol-db.service.ts`, `protocol-gating.controller.ts`, `protocol-gating.service.ts`, `protocol-health.service.ts`, `protocols.controller.ts`, `score-history.service.ts`, `scoring.service.ts`, `speed-scan.service.ts`, `screener.service.ts`, `strategies.controller.ts`, `suitability.controller.ts`, `symbol-protocol-authority.service.ts`, `symbol-resolver.service.ts`, `symbols.service.ts`, `system-health.service.ts`, `bot-performance.service.ts`, `trade-history.controller.ts`, `trading-strategy.service.ts`

### `trading_strategy`

- **writers (2):** `speed-scan.controller.ts`, `trading-strategy.service.ts`
- **readers (24):** `app.controller.ts`, `alert-trigger.service.ts`, `architecture.service.ts`, `ab-test.service.ts`, `automation.controller.ts`, `backtest.controller.ts`, `backtest.service.ts`, `bar-refresh.service.ts`, `mt5.controller.ts`, `replay.service.ts`, `exit-consensus.service.ts`, `protocol-gating.controller.ts`, `protocol-health.service.ts`, `strategy-derivation.service.ts`, `signal-envelope.service.ts`, `signal-queue.service.ts`, `symbol-protocol-authority.service.ts`, `symbol-resolver.service.ts`, `symbols.service.ts`, `bot-performance.service.ts`, `mt5-trading.service.ts`, `pyramid-policy.service.ts`, `trade-history.controller.ts`, `trading-strategy.service.ts`

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
- **readers (21):** `ab-test.service.ts`, `backtest.controller.ts`, `paper-trading.service.ts`, `performance.service.ts`, `position-sync.service.ts`, `research-overview.service.ts`, `risk.controller.ts`, `decision-chain.service.ts`, `edge-statistics.service.ts`, `pnl-statistics.service.ts`, `stack-performance.service.ts`, `screener.service.ts`, `signal-envelope.service.ts`, `symbols.service.ts`, `bot-performance.service.ts`, `duplicate-guard.service.ts`, `execution-feasibility.service.ts`, `mt5-trading.service.ts`, `trade-history.controller.ts`, `trade-recorder.service.ts`, `trading-strategy.service.ts`

### `order`

- **writers (2):** `automation-loop.service.ts`, `mt5-trading.service.ts`
- **readers (0):** _none_ — nothing reads this_

## Phase 2 — the derived dataset

> ⚠️ **GENERATED — do not edit.** Phase 2 of #1071. Read by the **TypeScript compiler**, not by
> pattern-matching, so a formula in a comment or a string is not a site and a call site is a
> resolved symbol rather than a name that matches.

**556** source files · **3057** declarations · **368** ratio sites · **1603** nodes · **161** unreferenced

| tier | what it means | groups |
|---|---|---|
| `exact` | the identical computation after normalisation | 44 |
| `coarse` | the identical **shape**, different constants | 44 |
| `idiom` | `(A−B)` **and** `(B−A)` in one expression | 1 |

## Divergent edges — the same maths, DIFFERENT rules

**This is the #1069 shape.** The computation is identical after normalisation, but the sites disagree about the conditions they apply — a different sign test, a different guard, or a different value when the computation cannot run. Read the `conditions:` and `guarded by:` lines: that is where two copies stop agreeing.

### 28 sites — `((V1-V2)/V2)*100`

- `nest/src/modules/backtest/backtest.controller.ts:807` — `benchmark()` → `bhReturnPct`
  - `((lastPrice-firstPrice)/firstPrice)*100`
- `nest/src/modules/backtest/backtest.controller.ts:815` — `benchmark()` → `dd`
  - `((bar.close-peak)/peak)*100`
- `nest/src/modules/backtest/backtest.service.ts:3311` — `runDirectiveCoverage()` → `ret5d`
  - `((bar5d.close-currentBar.close)/currentBar.close)*100`
- `nest/src/modules/backtest/backtest.service.ts:3319` — `runDirectiveCoverage()` → `ret10d`
  - `((bar10d.close-currentBar.close)/currentBar.close)*100`
- `nest/src/modules/directives/implementations/chandelier-exit.directive.ts:46` — `calculate()` → `distance`
  - `((longExit-lastClose)/lastClose)*100`
- `nest/src/modules/directives/implementations/gap-scanner.directive.ts:112` — `evaluateGap()` → `gapPct`
  - `((currentOpen-prevClose)/prevClose)*100`
- `nest/src/modules/directives/implementations/momentum-and-macro.directives.ts:124` — `calculate()` → `dist20`
  - `sma20>0?((lastClose-sma20)/sma20)*100:0`
  - guarded by: `sma20>0`
- `nest/src/modules/directives/implementations/momentum-and-macro.directives.ts:172` — `calculate()` → `pctAbove`
  - `((lastPrice-s50)/s50)*100`
- … and 20 more

### 26 sites — `(V1/V2)*100`

- `nest/src/modules/alerts/alert-trigger.service.ts:598` — `checkMarginUtilization()` → `utilPct`
  - `(acc.margin/acc.equity)*100`
- `nest/src/modules/automation/automation-loop.service.ts:3012` — `capturePortfolioSnapshot()`
  - `totalCost>0?(totalPnl/totalCost)*100:0`
  - guarded by: `totalCost>0`
- `nest/src/modules/automation/multi-protocol-ranking.service.ts:86` — `rankAcrossProtocols()` → `normalizedScore`
  - `result.maxPossible>0?(result.score/result.maxPossible)*100:0`
  - guarded by: `result.maxPossible>0`
- `nest/src/modules/automation/stop-guardian.service.ts:1889` — `observeExhaustion()`
  - `(recent/entry)*100`
- `nest/src/modules/automation/stop-guardian.service.ts:1890` — `observeExhaustion()`
  - `(prior/entry)*100`
- `nest/src/modules/directives/implementations/momentum-and-macro.directives.ts:213` — `calculate()` → `atrPct`
  - `(currentAtr/lastClose)*100`
- `nest/src/modules/directives/implementations/momentum-and-macro.directives.ts:218` — `calculate()` → `percentile`
  - `rank>=0?(rank/sortedAtr.length)*100:50`
  - guarded by: `rank>=0`
- `nest/src/modules/directives/implementations/momentum-and-macro.directives.ts:1046` — `calculate()` → `atrPct`
  - `(currentAtr/lastClose)*100`
- … and 18 more

### 19 sites — `(V1-V2)/V3`

- `nest/src/modules/automation/ab-test.service.ts:788` — `twoProportionZ()`
  - `se===0?0:(p1-p2)/se`
  - guarded by: `se===0`
- `nest/src/modules/directives/implementations/bollinger-squeeze.directive.ts:98` — `calculate()` → `percentile`
  - `(currentBW-minBW)/bwRange`
- `nest/src/modules/directives/implementations/falling-risk-pyramid.directive.ts:129` — `calculate()` → `pricePosition`
  - `(currentPrice-swingLow)/range`
- `nest/src/modules/directives/implementations/liquidity-check.directive.ts:95` — `(anonymous)()`
  - `mid>0?(b.high-b.low)/mid:0`
  - guarded by: `mid>0`
- `nest/src/modules/directives/implementations/market-entropy.directive.ts:89` — `calculate()` → `entropyDelta`
  - `(earlyEntropy-lateEntropy)/ENTROPY_MAX`
- `nest/src/modules/directives/implementations/momentum-and-macro.directives.ts:745` — `calculate()` → `bandwidth`
  - `(bb.upper[bb.upper.length-1]-bb.lower[bb.lower.length-1])/bb.middle[bb.middle.length-1]`
- `nest/src/modules/directives/implementations/mt5-indicators.directives.ts:443` — `calculate()` → `bandwidth`
  - `(upper-lower)/lastEMA`
- `nest/src/modules/directives/implementations/mt5-indicators.directives.ts:802` — `calculate()` → `longGap`
  - `(lastClose-longStop)/lastATR`
- … and 11 more

### 16 sites — `Math.round((V1/V2)*100)`

- `nest/src/common/cache/cache.service.ts:119` — `getStats()`
  - `total>0?Math.round((this.totalHits/total)*100):0`
  - guarded by: `total>0`
- `nest/src/modules/backtest/backtest.service.ts:3339` — `runDirectiveCoverage()`
  - `total5d>0?Math.round((wins5d/total5d)*100):0`
  - guarded by: `total5d>0`
- `nest/src/modules/backtest/backtest.service.ts:3341` — `runDirectiveCoverage()`
  - `total10d>0?Math.round((wins10d/total10d)*100):0`
  - guarded by: `total10d>0`
- `nest/src/modules/performance/performance.service.ts:167` — `(anonymous)()`
  - `m.trades>0?Math.round((m.wins/m.trades)*100):0`
  - guarded by: `m.trades>0`
- `nest/src/modules/performance/performance.service.ts:184` — `getSummary()`
  - `closed.length>0?Math.round((wins.length/closed.length)*100):0`
  - guarded by: `closed.length>0`
- `nest/src/modules/performance/performance.service.ts:242` — `computeStrategyStats()`
  - `closed.length>0?Math.round((wins.length/closed.length)*100):0`
  - guarded by: `closed.length>0`
- `nest/src/modules/planner/planner.service.ts:149` — `createObjective()`
  - `data.targetAmount&&data.currentAmount?Math.round((data.currentAmount/data.targetAmount)*100):0`
  - guarded by: `data.targetAmount&&data.currentAmount`
- `nest/src/modules/portfolio/trading212-import.service.ts:386` — `buildSummary()`
  - `trades.length>0?Math.round((winning.length/trades.length)*100):0`
  - guarded by: `trades.length>0`
- … and 8 more

### 10 sites — `(V1-V2)/Math.max(0.01,V2)*100`

- `nest/src/modules/directives/implementations/momentum-and-macro.directives.ts:478` — `calculate()` → `recentReturn`
  - `closes.length>5?(closes[closes.length-1]-closes[closes.length-6])/Math.max(0.01,closes[closes.length-6])*100:0`
  - guarded by: `closes.length>5`
- `nest/src/modules/directives/implementations/momentum-and-macro.directives.ts:594` — `calculate()` → `ret5`
  - `(closes[closes.length-1]-closes[closes.length-6])/Math.max(0.01,closes[closes.length-6])*100`
- `nest/src/modules/directives/implementations/momentum-and-macro.directives.ts:595` — `calculate()` → `ret20`
  - `(closes[closes.length-1]-closes[closes.length-21])/Math.max(0.01,closes[closes.length-21])*100`
- `nest/src/modules/directives/implementations/momentum-and-macro.directives.ts:652` — `calculate()` → `ret5`
  - `(closes[closes.length-1]-closes[closes.length-6])/Math.max(0.01,closes[closes.length-6])*100`
- `nest/src/modules/directives/implementations/momentum-and-macro.directives.ts:746` — `calculate()` → `ret20`
  - `(closes[closes.length-1]-closes[0])/Math.max(0.01,closes[0])*100`
- `nest/src/modules/directives/implementations/momentum-and-macro.directives.ts:1152` — `calculate()` → `ret5`
  - `(closes[closes.length-1]-closes[closes.length-6])/Math.max(0.01,closes[closes.length-6])*100`
- `nest/src/modules/directives/implementations/momentum-and-macro.directives.ts:1153` — `calculate()` → `ret5prev`
  - `closes.length>11?(closes[closes.length-6]-closes[closes.length-11])/Math.max(0.01,closes[closes.length-11])*100:0`
  - guarded by: `closes.length>11`
- `nest/src/modules/directives/implementations/momentum-and-macro.directives.ts:1374` — `calculate()` → `ret5`
  - `(closes[closes.length-1]-closes[closes.length-6])/Math.max(0.01,closes[closes.length-6])*100`
- … and 2 more

### 7 sites — `((V1-V2)/V1)*100`

- `nest/src/modules/automation/stop-guardian.service.ts:1866` — `observeExhaustion()` → `decelPct`
  - `((prior-recent)/prior)*100`
- `nest/src/modules/directives/implementations/chandelier-exit.directive.ts:37` — `calculate()` → `distance`
  - `((lastClose-shortExit)/lastClose)*100`
- `nest/src/modules/directives/implementations/confluence-reversal.directive.ts:182` — `calculate()` → `dist`
  - `((currentPrice-nearestSupport)/currentPrice)*100`
- `nest/src/modules/directives/implementations/panic-exhaustion.directive.ts:109` — `calculate()` → `panicDrop`
  - `((panicStart-panicEnd)/panicStart)*100`
- `nest/src/modules/paper-trading/paper-trading.service.ts:281` — `updateDrawdown()` → `drawdown`
  - `this.peakEquity>0?((this.peakEquity-equity)/this.peakEquity)*100:0`
  - guarded by: `this.peakEquity>0`
- `nest/src/modules/risk/monte-carlo.service.ts:143` — `simulate()` → `drawdown`
  - `peak>0?((peak-equity)/peak)*100:0`
  - guarded by: `peak>0`
- `nest/src/modules/trading/trade-history.controller.ts:182` — `(anonymous)()` → `dd`
  - `peak>0?((peak-cum)/peak)*100:0`
  - guarded by: `peak>0`

### 7 sites — `(C?V1*(1-V2/100):V1*(1+V2/100))`

- `nest/src/modules/automation/ab-test.service.ts:449` — `dispatchSideTrade()` → `sl`
  - `sideDir==='BUY'?entryPrice*(1-slPct/100):entryPrice*(1+slPct/100)`
  - conditions: `sideDir==='BUY'`
- `nest/src/modules/automation/automation-loop.service.ts:802` — `dispatchTrade()` → `sl`
  - `side==='BUY'?entryPrice*(1-slPct/100):entryPrice*(1+slPct/100)`
  - conditions: `side==='BUY'`
- `nest/src/modules/automation/automation-loop.service.ts:2745` — `confirmAction()` → `sl`
  - `entryPrice>0?action.side==='BUY'?entryPrice*(1-slPct/100):entryPrice*(1+slPct/100):0`
  - conditions: `action.side==='BUY'`
  - guarded by: `entryPrice>0`
- `nest/src/modules/automation/automation-loop.service.ts:2854` — `recordPaperTrade()` → `sl`
  - `side==='BUY'?entryPrice*(1-slPct/100):entryPrice*(1+slPct/100)`
  - conditions: `side==='BUY'`
- `nest/src/modules/automation/stop-guardian.service.ts:1770` — `observeSimulatedTsl()` → `triggerPrice`
  - `isBuy?best*(1-distancePct/100):best*(1+distancePct/100)`
  - conditions: `isBuy`
- `nest/src/modules/automation/stop-guardian.service.ts:1990` — `protectiveSl()` → `protective`
  - `side==='BUY'?entry*(1-slPct/100):entry*(1+slPct/100)`
  - conditions: `side==='BUY'`
- `nest/src/modules/backtest/backtest.service.ts:1571` — `run()` → `trailStop`
  - `isLong?bestPrice*(1-plan.trailPct/100):bestPrice*(1+plan.trailPct/100)`
  - conditions: `isLong`

### 7 sites — `(V1-V2)/V1`

- `nest/src/modules/directives/implementations/confluence-reversal.directive.ts:173` — `calculate()` → `depth`
  - `(OVERSOLD-currentRsi)/OVERSOLD`
- `nest/src/modules/directives/implementations/falling-risk-pyramid.directive.ts:150` — `calculate()` → `drawdownFromHigh`
  - `(recentHigh-currentPrice)/recentHigh`
- `nest/src/modules/directives/implementations/mt5-indicators.directives.ts:608` — `calculate()` → `dist`
  - `(lastClose-lastSAR)/lastClose`
- `nest/src/modules/risk/risk.service.ts:76` — `calculateTakeProfit()` → `slDistance`
  - `(entryPrice-stopLossPrice)/entryPrice`
- `nest/src/modules/risk/risk.service.ts:183` — `checkDrawdown()` → `drawdown`
  - `peakValue>0?(peakValue-currentValue)/peakValue:0`
  - guarded by: `peakValue>0`
- `nest/src/modules/scoring/averaging-scorer.ts:73` — `evaluate()` → `priceDrop`
  - `(position.averageEntry-position.currentPrice)/position.averageEntry`
- `nest/src/modules/scoring/scoring.controller.ts:102` — `getDegradation()` → `coverage`
  - `allProviders.length>0?(allProviders.length-failedProviders.length)/allProviders.length:1.0`
  - guarded by: `allProviders.length>0`

### 4 sites — `(((C?V1-V2:V2-V1))/V2)*100`

- `nest/src/modules/automation/stop-guardian.service.ts:1757` — `observeSimulatedTsl()` → `profitPct`
  - `((isBuy?pos.priceCurrent-pos.priceOpen:pos.priceOpen-pos.priceCurrent)/pos.priceOpen)*100`
  - conditions: `isBuy`
- `nest/src/modules/automation/stop-guardian.service.ts:1875` — `observeExhaustion()` → `profitPct`
  - `((isBuy?pos.priceCurrent-entry:entry-pos.priceCurrent)/entry)*100`
  - conditions: `isBuy`
- `nest/src/modules/scoring/exit-consensus.service.ts:373` — `assessOne()` → `profitPct`
  - `entry>0?((side==='buy'?current-entry:entry-current)/entry)*100:0`
  - conditions: `side==='buy'`
  - guarded by: `entry>0`
- `nest/src/modules/scoring/exit-consensus.service.ts:374` — `assessOne()` → `peakProfitPct`
  - `peak==null||entry<=0?null:((side==='buy'?peak-entry:entry-peak)/entry)*100`
  - conditions: `side==='buy'`
  - guarded by: `peak==null||entry<=0`

### 4 sites — `(C?V1*(1+V2/100):V1*(1-V2/100))`

- `nest/src/modules/automation/ab-test.service.ts:450` — `dispatchSideTrade()` → `tp`
  - `sideDir==='BUY'?entryPrice*(1+tpPct/100):entryPrice*(1-tpPct/100)`
  - conditions: `sideDir==='BUY'`
- `nest/src/modules/automation/automation-loop.service.ts:803` — `dispatchTrade()` → `tp`
  - `side==='BUY'?entryPrice*(1+tpPct/100):entryPrice*(1-tpPct/100)`
  - conditions: `side==='BUY'`
- `nest/src/modules/automation/automation-loop.service.ts:2748` — `confirmAction()` → `tp`
  - `entryPrice>0?action.side==='BUY'?entryPrice*(1+tpPct/100):entryPrice*(1-tpPct/100):0`
  - conditions: `action.side==='BUY'`
  - guarded by: `entryPrice>0`
- `nest/src/modules/automation/automation-loop.service.ts:2855` — `recordPaperTrade()` → `tp`
  - `side==='BUY'?entryPrice*(1+tpPct/100):entryPrice*(1-tpPct/100)`
  - conditions: `side==='BUY'`

### 4 sites — `Math.round((V1/V2)*100)/100`

- `nest/src/modules/backtest/backtest.service.ts:3340` — `runDirectiveCoverage()`
  - `total5d>0?Math.round((sumReturn5d/total5d)*100)/100:0`
  - guarded by: `total5d>0`
- `nest/src/modules/backtest/backtest.service.ts:3342` — `runDirectiveCoverage()`
  - `total10d>0?Math.round((sumReturn10d/total10d)*100)/100:0`
  - guarded by: `total10d>0`
- `nest/src/modules/performance/performance.service.ts:244` — `computeStrategyStats()`
  - `wins.length>0?Math.round((totalWin/wins.length)*100)/100:0`
  - guarded by: `wins.length>0`
- `nest/src/modules/performance/performance.service.ts:245` — `computeStrategyStats()`
  - `losses.length>0?Math.round((totalLoss/losses.length)*100)/100:0`
  - guarded by: `losses.length>0`

### 4 sites — `Math.round(V1/V2*100)`

- `nest/src/modules/replay/replay.service.ts:656` — `runReplay()`
  - `buySteps.length>0?Math.round(buySteps.filter(s=>s.signalCorrect).length/buySteps.length*100):0`
  - guarded by: `buySteps.length>0`
- `nest/src/modules/replay/replay.service.ts:657` — `runReplay()`
  - `sellSteps.length>0?Math.round(sellSteps.filter(s=>s.signalCorrect).length/sellSteps.length*100):0`
  - guarded by: `sellSteps.length>0`
- `nest/src/modules/replay/replay.service.ts:678` — `(anonymous)()`
  - `low.length>0?Math.round(low.filter(s=>s.signalCorrect).length/low.length*100):0`
  - guarded by: `low.length>0`
- `nest/src/modules/replay/replay.service.ts:682` — `(anonymous)()`
  - `mid.length>0?Math.round(mid.filter(s=>s.signalCorrect).length/mid.length*100):0`
  - guarded by: `mid.length>0`

### 3 sites — `round1((100*V1)/V2)`

- `nest/src/modules/scoring/protocol-gating.controller.ts:409` — `(anonymous)()`
  - `configuredCapacity>0?round1((100*neverCapacity)/configuredCapacity):0`
  - guarded by: `configuredCapacity>0`
- `nest/src/modules/scoring/protocol-gating.controller.ts:412` — `(anonymous)()`
  - `configuredCapacity>0?round1((100*p.peak)/configuredCapacity):0`
  - guarded by: `configuredCapacity>0`
- `nest/src/modules/scoring/protocol-gating.controller.ts:418` — `(anonymous)()`
  - `reachableCapacity>0?round1((100*p.peak)/reachableCapacity):null`
  - guarded by: `reachableCapacity>0`

### 2 sites — `(C?((V1-V2)/V2)*100:V3)`

- `nest/src/modules/directives/implementations/momentum-and-macro.directives.ts:125` — `calculate()` → `dist50`
  - `sma50>0?((lastClose-sma50)/sma50)*100:dist20`
  - conditions: `sma50>0`
- `nest/src/modules/directives/implementations/support-resistance.directive.ts:133` — `calculate()` → `resistDist`
  - `nearestResistance<Infinity?((nearestResistance-currentPrice)/currentPrice)*100:Infinity`
  - conditions: `nearestResistance<Infinity`

### 2 sites — `(C?V1:(V2+V1)/2)`

- `nest/src/modules/backtest/break-even.ts:183` — `med()`
  - `sorted.length%2?sorted[mid]:(sorted[mid-1]+sorted[mid])/2`
  - conditions: `sorted.length%2`
- `nest/src/modules/trading/trade-history.controller.ts:771` — `median()`
  - `s.length%2?s[m]:(s[m-1]+s[m])/2`
  - conditions: `s.length%2`

### 2 sites — `(Math.abs(V1-V2)/(V1+V2))*100`

- `nest/src/modules/directives/implementations/multi-timeframe-trend.directive.ts:296` — `adx()` → `dx`
  - `diPlus+diMinus>0?(Math.abs(diPlus-diMinus)/(diPlus+diMinus))*100:0`
  - guarded by: `diPlus+diMinus>0`
- `nest/src/modules/indicators/indicators.service.ts:340` — `adx()` → `dx`
  - `(plusDi+minusDi)===0?0:(Math.abs(plusDi-minusDi)/(plusDi+minusDi))*100`
  - guarded by: `(plusDi+minusDi)===0`

### 2 sites — `(V1-V2)/(C)`

- `nest/src/modules/directives/implementations/mt5-indicators.directives.ts:710` — `calculate()` → `pctB`
  - `(lastClose-lower)/(upper-lower||1)`
  - conditions: `upper-lower||1`
- `nest/src/modules/directives/implementations/mt5-indicators.directives.ts:997` — `calculate()` → `adSlope`
  - `(recent[recent.length-1]-recent[0])/(Math.abs(recent[0])||1)`
  - conditions: `Math.abs(recent[0])||1`

### 2 sites — `Math.min(100,Math.max(0,(V1/V2)*100))`

- `nest/src/modules/scoring/scoring.service.ts:505` — `rankAll()` → `normalizedScorePct`
  - `maxPossibleScore>0?Math.min(100,Math.max(0,(seasonAdjustedScore/maxPossibleScore)*100)):0`
  - guarded by: `maxPossibleScore>0`
- `nest/src/modules/scoring/stack-performance.service.ts:222` — `computeMetaStackRating()` → `normalizedEffectiveness`
  - `Math.min(100,Math.max(0,(effectivenessRate/EFFECTIVENESS_ANCHOR_PER_HOUR)*100))`

### 2 sites — `Math.round((V1/V2)*1000)/10`

- `nest/src/modules/ai/portfolio-lab.service.ts:154` — `analyze()`
  - `totalCost>0?Math.round((totalPnl/totalCost)*1000)/10:0`
  - guarded by: `totalCost>0`
- `nest/src/modules/scoring/outcome-tracker.service.ts:276` — `getRecordingStats()`
  - `considered>0?Math.round((identity/considered)*1000)/10:0`
  - guarded by: `considered>0`

## Q3a — the same maths in more than one place

Identical after normalisation: variable names differ, the computation does not.

### 28 sites — `((V1-V2)/V2)*100`

- `nest/src/modules/backtest/backtest.controller.ts:807` — `benchmark()` → `bhReturnPct`
  - `((lastPrice-firstPrice)/firstPrice)*100`
- `nest/src/modules/backtest/backtest.controller.ts:815` — `benchmark()` → `dd`
  - `((bar.close-peak)/peak)*100`
- `nest/src/modules/backtest/backtest.service.ts:3311` — `runDirectiveCoverage()` → `ret5d`
  - `((bar5d.close-currentBar.close)/currentBar.close)*100`
- `nest/src/modules/backtest/backtest.service.ts:3319` — `runDirectiveCoverage()` → `ret10d`
  - `((bar10d.close-currentBar.close)/currentBar.close)*100`
- `nest/src/modules/directives/implementations/chandelier-exit.directive.ts:46` — `calculate()` → `distance`
  - `((longExit-lastClose)/lastClose)*100`
- `nest/src/modules/directives/implementations/gap-scanner.directive.ts:112` — `evaluateGap()` → `gapPct`
  - `((currentOpen-prevClose)/prevClose)*100`
- `nest/src/modules/directives/implementations/momentum-and-macro.directives.ts:124` — `calculate()` → `dist20`
  - `sma20>0?((lastClose-sma20)/sma20)*100:0`
  - guarded by: `sma20>0`
- `nest/src/modules/directives/implementations/momentum-and-macro.directives.ts:172` — `calculate()` → `pctAbove`
  - `((lastPrice-s50)/s50)*100`
- … and 20 more

### 26 sites — `(V1/V2)*100`

- `nest/src/modules/alerts/alert-trigger.service.ts:598` — `checkMarginUtilization()` → `utilPct`
  - `(acc.margin/acc.equity)*100`
- `nest/src/modules/automation/automation-loop.service.ts:3012` — `capturePortfolioSnapshot()`
  - `totalCost>0?(totalPnl/totalCost)*100:0`
  - guarded by: `totalCost>0`
- `nest/src/modules/automation/multi-protocol-ranking.service.ts:86` — `rankAcrossProtocols()` → `normalizedScore`
  - `result.maxPossible>0?(result.score/result.maxPossible)*100:0`
  - guarded by: `result.maxPossible>0`
- `nest/src/modules/automation/stop-guardian.service.ts:1889` — `observeExhaustion()`
  - `(recent/entry)*100`
- `nest/src/modules/automation/stop-guardian.service.ts:1890` — `observeExhaustion()`
  - `(prior/entry)*100`
- `nest/src/modules/directives/implementations/momentum-and-macro.directives.ts:213` — `calculate()` → `atrPct`
  - `(currentAtr/lastClose)*100`
- `nest/src/modules/directives/implementations/momentum-and-macro.directives.ts:218` — `calculate()` → `percentile`
  - `rank>=0?(rank/sortedAtr.length)*100:50`
  - guarded by: `rank>=0`
- `nest/src/modules/directives/implementations/momentum-and-macro.directives.ts:1046` — `calculate()` → `atrPct`
  - `(currentAtr/lastClose)*100`
- … and 18 more

### 19 sites — `(V1-V2)/V3`

- `nest/src/modules/automation/ab-test.service.ts:788` — `twoProportionZ()`
  - `se===0?0:(p1-p2)/se`
  - guarded by: `se===0`
- `nest/src/modules/directives/implementations/bollinger-squeeze.directive.ts:98` — `calculate()` → `percentile`
  - `(currentBW-minBW)/bwRange`
- `nest/src/modules/directives/implementations/falling-risk-pyramid.directive.ts:129` — `calculate()` → `pricePosition`
  - `(currentPrice-swingLow)/range`
- `nest/src/modules/directives/implementations/liquidity-check.directive.ts:95` — `(anonymous)()`
  - `mid>0?(b.high-b.low)/mid:0`
  - guarded by: `mid>0`
- `nest/src/modules/directives/implementations/market-entropy.directive.ts:89` — `calculate()` → `entropyDelta`
  - `(earlyEntropy-lateEntropy)/ENTROPY_MAX`
- `nest/src/modules/directives/implementations/momentum-and-macro.directives.ts:745` — `calculate()` → `bandwidth`
  - `(bb.upper[bb.upper.length-1]-bb.lower[bb.lower.length-1])/bb.middle[bb.middle.length-1]`
- `nest/src/modules/directives/implementations/mt5-indicators.directives.ts:443` — `calculate()` → `bandwidth`
  - `(upper-lower)/lastEMA`
- `nest/src/modules/directives/implementations/mt5-indicators.directives.ts:802` — `calculate()` → `longGap`
  - `(lastClose-longStop)/lastATR`
- … and 11 more

### 16 sites — `Math.round((V1/V2)*100)`

- `nest/src/common/cache/cache.service.ts:119` — `getStats()`
  - `total>0?Math.round((this.totalHits/total)*100):0`
  - guarded by: `total>0`
- `nest/src/modules/backtest/backtest.service.ts:3339` — `runDirectiveCoverage()`
  - `total5d>0?Math.round((wins5d/total5d)*100):0`
  - guarded by: `total5d>0`
- `nest/src/modules/backtest/backtest.service.ts:3341` — `runDirectiveCoverage()`
  - `total10d>0?Math.round((wins10d/total10d)*100):0`
  - guarded by: `total10d>0`
- `nest/src/modules/performance/performance.service.ts:167` — `(anonymous)()`
  - `m.trades>0?Math.round((m.wins/m.trades)*100):0`
  - guarded by: `m.trades>0`
- `nest/src/modules/performance/performance.service.ts:184` — `getSummary()`
  - `closed.length>0?Math.round((wins.length/closed.length)*100):0`
  - guarded by: `closed.length>0`
- `nest/src/modules/performance/performance.service.ts:242` — `computeStrategyStats()`
  - `closed.length>0?Math.round((wins.length/closed.length)*100):0`
  - guarded by: `closed.length>0`
- `nest/src/modules/planner/planner.service.ts:149` — `createObjective()`
  - `data.targetAmount&&data.currentAmount?Math.round((data.currentAmount/data.targetAmount)*100):0`
  - guarded by: `data.targetAmount&&data.currentAmount`
- `nest/src/modules/portfolio/trading212-import.service.ts:386` — `buildSummary()`
  - `trades.length>0?Math.round((winning.length/trades.length)*100):0`
  - guarded by: `trades.length>0`
- … and 8 more

### 13 sites — `Math.max(0,Math.min(1,(V1-V2)/(V3-V2)))`

- `nest/src/modules/directives/implementations/adx.directive.ts:54` — `mapRange()` → `t`
  - `Math.max(0,Math.min(1,(v-inMin)/(inMax-inMin)))`
- `nest/src/modules/directives/implementations/atr-dip.directive.ts:56` — `mapRange()` → `t`
  - `Math.max(0,Math.min(1,(v-inMin)/(inMax-inMin)))`
- `nest/src/modules/directives/implementations/cad-usd-oil-correlation.directive.ts:45` — `mapRange()` → `t`
  - `Math.max(0,Math.min(1,(v-inMin)/(inMax-inMin)))`
- `nest/src/modules/directives/implementations/cci.directive.ts:42` — `mapRange()` → `t`
  - `Math.max(0,Math.min(1,(v-inMin)/(inMax-inMin)))`
- `nest/src/modules/directives/implementations/dxy-regime.directive.ts:26` — `mapRange()` → `t`
  - `Math.max(0,Math.min(1,(v-inMin)/(inMax-inMin)))`
- `nest/src/modules/directives/implementations/earnings-proximity.directive.ts:36` — `mapRange()` → `t`
  - `Math.max(0,Math.min(1,(v-inMin)/(inMax-inMin)))`
- `nest/src/modules/directives/implementations/gold-macro-correlation.directive.ts:32` — `mapRange()` → `t`
  - `Math.max(0,Math.min(1,(v-inMin)/(inMax-inMin)))`
- `nest/src/modules/directives/implementations/mfi.directive.ts:53` — `mapRange()` → `t`
  - `Math.max(0,Math.min(1,(v-inMin)/(inMax-inMin)))`
- … and 5 more

### 11 sites — `(V1+V2)/2`

- `nest/src/modules/directives/implementations/fair-value-gap.directive.ts:107` — `calculate()` → `gapMid`
  - `(gap.top+gap.bottom)/2`
- `nest/src/modules/directives/implementations/liquidity-check.directive.ts:94` — `(anonymous)()` → `mid`
  - `(b.high+b.low)/2`
- `nest/src/modules/directives/implementations/market-memory-zones.directive.ts:152` — `findMemoryZones()`
  - `(bar.open+bar.close)/2`
- `nest/src/modules/directives/implementations/momentum-and-macro.directives.ts:126` — `calculate()` → `avgDist`
  - `(dist20+dist50)/2`
- `nest/src/modules/directives/implementations/mt5-dark-cloud-piercing.directive.ts:84` — `calculate()` → `prevMidpoint`
  - `(closes[last-1]+opens[last-1])/2`
- `nest/src/modules/directives/implementations/mt5-engulfing.directive.ts:117` — `calculate()` → `prevMidpoint`
  - `(prev.high+prev.low)/2`
- `nest/src/modules/directives/implementations/mt5-indicators.directives.ts:388` — `calculate()` → `midBand`
  - `(upperBand+lowerBand)/2`
- `nest/src/modules/directives/implementations/price-time-gap.directive.ts:269` — `calculateVIC()` → `avgVolume`
  - `(prevBar.volume+currBar.volume)/2`
- … and 3 more

### 10 sites — `(V1-V2)/Math.max(0.01,V2)*100`

- `nest/src/modules/directives/implementations/momentum-and-macro.directives.ts:478` — `calculate()` → `recentReturn`
  - `closes.length>5?(closes[closes.length-1]-closes[closes.length-6])/Math.max(0.01,closes[closes.length-6])*100:0`
  - guarded by: `closes.length>5`
- `nest/src/modules/directives/implementations/momentum-and-macro.directives.ts:594` — `calculate()` → `ret5`
  - `(closes[closes.length-1]-closes[closes.length-6])/Math.max(0.01,closes[closes.length-6])*100`
- `nest/src/modules/directives/implementations/momentum-and-macro.directives.ts:595` — `calculate()` → `ret20`
  - `(closes[closes.length-1]-closes[closes.length-21])/Math.max(0.01,closes[closes.length-21])*100`
- `nest/src/modules/directives/implementations/momentum-and-macro.directives.ts:652` — `calculate()` → `ret5`
  - `(closes[closes.length-1]-closes[closes.length-6])/Math.max(0.01,closes[closes.length-6])*100`
- `nest/src/modules/directives/implementations/momentum-and-macro.directives.ts:746` — `calculate()` → `ret20`
  - `(closes[closes.length-1]-closes[0])/Math.max(0.01,closes[0])*100`
- `nest/src/modules/directives/implementations/momentum-and-macro.directives.ts:1152` — `calculate()` → `ret5`
  - `(closes[closes.length-1]-closes[closes.length-6])/Math.max(0.01,closes[closes.length-6])*100`
- `nest/src/modules/directives/implementations/momentum-and-macro.directives.ts:1153` — `calculate()` → `ret5prev`
  - `closes.length>11?(closes[closes.length-6]-closes[closes.length-11])/Math.max(0.01,closes[closes.length-11])*100:0`
  - guarded by: `closes.length>11`
- `nest/src/modules/directives/implementations/momentum-and-macro.directives.ts:1374` — `calculate()` → `ret5`
  - `(closes[closes.length-1]-closes[closes.length-6])/Math.max(0.01,closes[closes.length-6])*100`
- … and 2 more

### 10 sites — `(V1-V2)/V2`

- `nest/src/modules/directives/implementations/ema-structure.directive.ts:46` — `calculate()` → `priceSep`
  - `(currentPrice-currentEma20)/currentEma20`
- `nest/src/modules/directives/implementations/ema-structure.directive.ts:54` — `calculate()` → `emaSep`
  - `(currentEma20-currentEma50)/currentEma50`
- `nest/src/modules/directives/implementations/micro-sr-levels.directive.ts:255` — `calculate()` → `distPct`
  - `(currentPrice-nearestSupport.price)/nearestSupport.price`
- `nest/src/modules/directives/implementations/micro-sr-levels.directive.ts:286` — `calculate()` → `distPct`
  - `(nearestResistance.price-currentPrice)/currentPrice`
- `nest/src/modules/directives/implementations/mt5-indicators.directives.ts:998` — `calculate()` → `priceSlope`
  - `(recentPrices[recentPrices.length-1]-recentPrices[0])/recentPrices[0]`
- `nest/src/modules/directives/implementations/session-open-effect.directive.ts:176` — `calculate()` → `preOpenReturn`
  - `(preOpenEnd-preOpenStart)/preOpenStart`
- `nest/src/modules/directives/implementations/three-soldiers-pattern.directive.ts:124` — `calculate()` → `progression1`
  - `(b2.close-b1.close)/b1.close`
- `nest/src/modules/directives/implementations/three-soldiers-pattern.directive.ts:125` — `calculate()` → `progression2`
  - `(b3.close-b2.close)/b2.close`
- … and 2 more

### 10 sites — `(V1+V2+V3)/3`

- `nest/src/modules/directives/implementations/micro-sr-levels.directive.ts:355` — `computeVwap()` → `tp`
  - `(b.high+b.low+b.close)/3`
- `nest/src/modules/directives/implementations/momentum-and-macro.directives.ts:807` — `calculate()` → `tp`
  - `(bar.high+bar.low+bar.close)/3`
- `nest/src/modules/directives/implementations/multi-timeframe-trend.directive.ts:325` — `vwap()` → `tp`
  - `(highs[i]+lows[i]+closes[i])/3`
- `nest/src/modules/directives/implementations/three-soldiers-pattern.directive.ts:123` — `calculate()` → `avgBodyRatio`
  - `(br1+br2+br3)/3`
- `nest/src/modules/directives/implementations/vwap-confluence.directive.ts:79` — `computeVwap()` → `tp`
  - `(highs[i]+lows[i]+closes[i])/3`
- `nest/src/modules/directives/implementations/vwap-confluence.directive.ts:90` — `computeVwapStdDev()` → `tp`
  - `(highs[i]+lows[i]+closes[i])/3`
- `nest/src/modules/directives/utils/indicators.ts:738` — `vwap()` → `tp`
  - `(highs[i]+lows[i]+closes[i])/3`
- `nest/src/modules/indicators/indicators.service.ts:71` — `computeSupportResistance()` → `pivot`
  - `(prev.high+prev.low+prev.close)/3`
- … and 2 more

### 7 sites — `((V1-V2)/V1)*100`

- `nest/src/modules/automation/stop-guardian.service.ts:1866` — `observeExhaustion()` → `decelPct`
  - `((prior-recent)/prior)*100`
- `nest/src/modules/directives/implementations/chandelier-exit.directive.ts:37` — `calculate()` → `distance`
  - `((lastClose-shortExit)/lastClose)*100`
- `nest/src/modules/directives/implementations/confluence-reversal.directive.ts:182` — `calculate()` → `dist`
  - `((currentPrice-nearestSupport)/currentPrice)*100`
- `nest/src/modules/directives/implementations/panic-exhaustion.directive.ts:109` — `calculate()` → `panicDrop`
  - `((panicStart-panicEnd)/panicStart)*100`
- `nest/src/modules/paper-trading/paper-trading.service.ts:281` — `updateDrawdown()` → `drawdown`
  - `this.peakEquity>0?((this.peakEquity-equity)/this.peakEquity)*100:0`
  - guarded by: `this.peakEquity>0`
- `nest/src/modules/risk/monte-carlo.service.ts:143` — `simulate()` → `drawdown`
  - `peak>0?((peak-equity)/peak)*100:0`
  - guarded by: `peak>0`
- `nest/src/modules/trading/trade-history.controller.ts:182` — `(anonymous)()` → `dd`
  - `peak>0?((peak-cum)/peak)*100:0`
  - guarded by: `peak>0`

_… and 34 further group(s)._

## Q3b — the same shape, differing constants

Numeric literals blanked. **This is where divergent maths hides** — same structure, a different number doing the work.

### 38 sites — `((VN-VN)/VN)*N`

- `nest/src/modules/automation/stop-guardian.service.ts:1866` — `observeExhaustion()` → `decelPct`
  - `((prior-recent)/prior)*100`
- `nest/src/modules/backtest/backtest.controller.ts:807` — `benchmark()` → `bhReturnPct`
  - `((lastPrice-firstPrice)/firstPrice)*100`
- `nest/src/modules/backtest/backtest.controller.ts:815` — `benchmark()` → `dd`
  - `((bar.close-peak)/peak)*100`
- `nest/src/modules/backtest/backtest.service.ts:3311` — `runDirectiveCoverage()` → `ret5d`
  - `((bar5d.close-currentBar.close)/currentBar.close)*100`
- `nest/src/modules/backtest/backtest.service.ts:3319` — `runDirectiveCoverage()` → `ret10d`
  - `((bar10d.close-currentBar.close)/currentBar.close)*100`
- `nest/src/modules/directives/implementations/chandelier-exit.directive.ts:37` — `calculate()` → `distance`
  - `((lastClose-shortExit)/lastClose)*100`
- `nest/src/modules/directives/implementations/chandelier-exit.directive.ts:46` — `calculate()` → `distance`
  - `((longExit-lastClose)/lastClose)*100`
- `nest/src/modules/directives/implementations/confluence-reversal.directive.ts:182` — `calculate()` → `dist`
  - `((currentPrice-nearestSupport)/currentPrice)*100`
- … and 30 more

### 36 sites — `(VN-VN)/VN`

- `nest/src/modules/automation/ab-test.service.ts:788` — `twoProportionZ()`
  - `se===0?0:(p1-p2)/se`
  - guarded by: `se===0`
- `nest/src/modules/directives/implementations/bollinger-squeeze.directive.ts:98` — `calculate()` → `percentile`
  - `(currentBW-minBW)/bwRange`
- `nest/src/modules/directives/implementations/confluence-reversal.directive.ts:173` — `calculate()` → `depth`
  - `(OVERSOLD-currentRsi)/OVERSOLD`
- `nest/src/modules/directives/implementations/ema-structure.directive.ts:46` — `calculate()` → `priceSep`
  - `(currentPrice-currentEma20)/currentEma20`
- `nest/src/modules/directives/implementations/ema-structure.directive.ts:54` — `calculate()` → `emaSep`
  - `(currentEma20-currentEma50)/currentEma50`
- `nest/src/modules/directives/implementations/falling-risk-pyramid.directive.ts:129` — `calculate()` → `pricePosition`
  - `(currentPrice-swingLow)/range`
- `nest/src/modules/directives/implementations/falling-risk-pyramid.directive.ts:150` — `calculate()` → `drawdownFromHigh`
  - `(recentHigh-currentPrice)/recentHigh`
- `nest/src/modules/directives/implementations/liquidity-check.directive.ts:95` — `(anonymous)()`
  - `mid>0?(b.high-b.low)/mid:0`
  - guarded by: `mid>0`
- … and 28 more

### 26 sites — `(VN/VN)*N`

- `nest/src/modules/alerts/alert-trigger.service.ts:598` — `checkMarginUtilization()` → `utilPct`
  - `(acc.margin/acc.equity)*100`
- `nest/src/modules/automation/automation-loop.service.ts:3012` — `capturePortfolioSnapshot()`
  - `totalCost>0?(totalPnl/totalCost)*100:0`
  - guarded by: `totalCost>0`
- `nest/src/modules/automation/multi-protocol-ranking.service.ts:86` — `rankAcrossProtocols()` → `normalizedScore`
  - `result.maxPossible>0?(result.score/result.maxPossible)*100:0`
  - guarded by: `result.maxPossible>0`
- `nest/src/modules/automation/stop-guardian.service.ts:1889` — `observeExhaustion()`
  - `(recent/entry)*100`
- `nest/src/modules/automation/stop-guardian.service.ts:1890` — `observeExhaustion()`
  - `(prior/entry)*100`
- `nest/src/modules/directives/implementations/momentum-and-macro.directives.ts:213` — `calculate()` → `atrPct`
  - `(currentAtr/lastClose)*100`
- `nest/src/modules/directives/implementations/momentum-and-macro.directives.ts:218` — `calculate()` → `percentile`
  - `rank>=0?(rank/sortedAtr.length)*100:50`
  - guarded by: `rank>=0`
- `nest/src/modules/directives/implementations/momentum-and-macro.directives.ts:1046` — `calculate()` → `atrPct`
  - `(currentAtr/lastClose)*100`
- … and 18 more

### 16 sites — `Math.round((VN/VN)*N)`

- `nest/src/common/cache/cache.service.ts:119` — `getStats()`
  - `total>0?Math.round((this.totalHits/total)*100):0`
  - guarded by: `total>0`
- `nest/src/modules/backtest/backtest.service.ts:3339` — `runDirectiveCoverage()`
  - `total5d>0?Math.round((wins5d/total5d)*100):0`
  - guarded by: `total5d>0`
- `nest/src/modules/backtest/backtest.service.ts:3341` — `runDirectiveCoverage()`
  - `total10d>0?Math.round((wins10d/total10d)*100):0`
  - guarded by: `total10d>0`
- `nest/src/modules/performance/performance.service.ts:167` — `(anonymous)()`
  - `m.trades>0?Math.round((m.wins/m.trades)*100):0`
  - guarded by: `m.trades>0`
- `nest/src/modules/performance/performance.service.ts:184` — `getSummary()`
  - `closed.length>0?Math.round((wins.length/closed.length)*100):0`
  - guarded by: `closed.length>0`
- `nest/src/modules/performance/performance.service.ts:242` — `computeStrategyStats()`
  - `closed.length>0?Math.round((wins.length/closed.length)*100):0`
  - guarded by: `closed.length>0`
- `nest/src/modules/planner/planner.service.ts:149` — `createObjective()`
  - `data.targetAmount&&data.currentAmount?Math.round((data.currentAmount/data.targetAmount)*100):0`
  - guarded by: `data.targetAmount&&data.currentAmount`
- `nest/src/modules/portfolio/trading212-import.service.ts:386` — `buildSummary()`
  - `trades.length>0?Math.round((winning.length/trades.length)*100):0`
  - guarded by: `trades.length>0`
- … and 8 more

### 13 sites — `Math.max(N,Math.min(N,(VN-VN)/(VN-VN)))`

- `nest/src/modules/directives/implementations/adx.directive.ts:54` — `mapRange()` → `t`
  - `Math.max(0,Math.min(1,(v-inMin)/(inMax-inMin)))`
- `nest/src/modules/directives/implementations/atr-dip.directive.ts:56` — `mapRange()` → `t`
  - `Math.max(0,Math.min(1,(v-inMin)/(inMax-inMin)))`
- `nest/src/modules/directives/implementations/cad-usd-oil-correlation.directive.ts:45` — `mapRange()` → `t`
  - `Math.max(0,Math.min(1,(v-inMin)/(inMax-inMin)))`
- `nest/src/modules/directives/implementations/cci.directive.ts:42` — `mapRange()` → `t`
  - `Math.max(0,Math.min(1,(v-inMin)/(inMax-inMin)))`
- `nest/src/modules/directives/implementations/dxy-regime.directive.ts:26` — `mapRange()` → `t`
  - `Math.max(0,Math.min(1,(v-inMin)/(inMax-inMin)))`
- `nest/src/modules/directives/implementations/earnings-proximity.directive.ts:36` — `mapRange()` → `t`
  - `Math.max(0,Math.min(1,(v-inMin)/(inMax-inMin)))`
- `nest/src/modules/directives/implementations/gold-macro-correlation.directive.ts:32` — `mapRange()` → `t`
  - `Math.max(0,Math.min(1,(v-inMin)/(inMax-inMin)))`
- `nest/src/modules/directives/implementations/mfi.directive.ts:53` — `mapRange()` → `t`
  - `Math.max(0,Math.min(1,(v-inMin)/(inMax-inMin)))`
- … and 5 more

### 11 sites — `(VN+VN)/N`

- `nest/src/modules/directives/implementations/fair-value-gap.directive.ts:107` — `calculate()` → `gapMid`
  - `(gap.top+gap.bottom)/2`
- `nest/src/modules/directives/implementations/liquidity-check.directive.ts:94` — `(anonymous)()` → `mid`
  - `(b.high+b.low)/2`
- `nest/src/modules/directives/implementations/market-memory-zones.directive.ts:152` — `findMemoryZones()`
  - `(bar.open+bar.close)/2`
- `nest/src/modules/directives/implementations/momentum-and-macro.directives.ts:126` — `calculate()` → `avgDist`
  - `(dist20+dist50)/2`
- `nest/src/modules/directives/implementations/mt5-dark-cloud-piercing.directive.ts:84` — `calculate()` → `prevMidpoint`
  - `(closes[last-1]+opens[last-1])/2`
- `nest/src/modules/directives/implementations/mt5-engulfing.directive.ts:117` — `calculate()` → `prevMidpoint`
  - `(prev.high+prev.low)/2`
- `nest/src/modules/directives/implementations/mt5-indicators.directives.ts:388` — `calculate()` → `midBand`
  - `(upperBand+lowerBand)/2`
- `nest/src/modules/directives/implementations/price-time-gap.directive.ts:269` — `calculateVIC()` → `avgVolume`
  - `(prevBar.volume+currBar.volume)/2`
- … and 3 more

### 11 sites — `Math.abs(VN-VN)/VN`

- `nest/src/modules/directives/implementations/fibonacci-levels.directive.ts:166` — `calculate()` → `distPct`
  - `Math.abs(currentPrice-level.price)/currentPrice`
- `nest/src/modules/directives/implementations/fibonacci-levels.directive.ts:197` — `calculate()` → `prevDist`
  - `Math.abs(prevBar.close-closestLevel.price)/closestLevel.price`
- `nest/src/modules/directives/implementations/fibonacci-levels.directive.ts:198` — `calculate()` → `move`
  - `Math.abs(currentPrice-prevBar.close)/prevBar.close`
- `nest/src/modules/directives/implementations/gold-round-numbers.directive.ts:96` — `calculate()` → `distMajorPct`
  - `Math.abs(price-nearestMajor)/price`
- `nest/src/modules/directives/implementations/gold-round-numbers.directive.ts:97` — `calculate()` → `distMinorPct`
  - `Math.abs(price-nearestMinor)/price`
- `nest/src/modules/directives/implementations/gold-round-numbers.directive.ts:98` — `calculate()` → `distMicroPct`
  - `Math.abs(price-nearestMicro)/price`
- `nest/src/modules/directives/implementations/liquidity-check.directive.ts:105` — `calculate()` → `gapPct`
  - `Math.abs(recent[i].open-recent[i-1].close)/recent[i-1].close`
- `nest/src/modules/directives/implementations/ma-crossover.directive.ts:116` — `calculate()` → `separation`
  - `Math.abs(currFast-currSlow)/currSlow`
- … and 3 more

### 10 sites — `(VN-VN)/Math.max(N,VN)*N`

- `nest/src/modules/directives/implementations/momentum-and-macro.directives.ts:478` — `calculate()` → `recentReturn`
  - `closes.length>5?(closes[closes.length-1]-closes[closes.length-6])/Math.max(0.01,closes[closes.length-6])*100:0`
  - guarded by: `closes.length>5`
- `nest/src/modules/directives/implementations/momentum-and-macro.directives.ts:594` — `calculate()` → `ret5`
  - `(closes[closes.length-1]-closes[closes.length-6])/Math.max(0.01,closes[closes.length-6])*100`
- `nest/src/modules/directives/implementations/momentum-and-macro.directives.ts:595` — `calculate()` → `ret20`
  - `(closes[closes.length-1]-closes[closes.length-21])/Math.max(0.01,closes[closes.length-21])*100`
- `nest/src/modules/directives/implementations/momentum-and-macro.directives.ts:652` — `calculate()` → `ret5`
  - `(closes[closes.length-1]-closes[closes.length-6])/Math.max(0.01,closes[closes.length-6])*100`
- `nest/src/modules/directives/implementations/momentum-and-macro.directives.ts:746` — `calculate()` → `ret20`
  - `(closes[closes.length-1]-closes[0])/Math.max(0.01,closes[0])*100`
- `nest/src/modules/directives/implementations/momentum-and-macro.directives.ts:1152` — `calculate()` → `ret5`
  - `(closes[closes.length-1]-closes[closes.length-6])/Math.max(0.01,closes[closes.length-6])*100`
- `nest/src/modules/directives/implementations/momentum-and-macro.directives.ts:1153` — `calculate()` → `ret5prev`
  - `closes.length>11?(closes[closes.length-6]-closes[closes.length-11])/Math.max(0.01,closes[closes.length-11])*100:0`
  - guarded by: `closes.length>11`
- `nest/src/modules/directives/implementations/momentum-and-macro.directives.ts:1374` — `calculate()` → `ret5`
  - `(closes[closes.length-1]-closes[closes.length-6])/Math.max(0.01,closes[closes.length-6])*100`
- … and 2 more

### 10 sites — `(VN+VN+VN)/N`

- `nest/src/modules/directives/implementations/micro-sr-levels.directive.ts:355` — `computeVwap()` → `tp`
  - `(b.high+b.low+b.close)/3`
- `nest/src/modules/directives/implementations/momentum-and-macro.directives.ts:807` — `calculate()` → `tp`
  - `(bar.high+bar.low+bar.close)/3`
- `nest/src/modules/directives/implementations/multi-timeframe-trend.directive.ts:325` — `vwap()` → `tp`
  - `(highs[i]+lows[i]+closes[i])/3`
- `nest/src/modules/directives/implementations/three-soldiers-pattern.directive.ts:123` — `calculate()` → `avgBodyRatio`
  - `(br1+br2+br3)/3`
- `nest/src/modules/directives/implementations/vwap-confluence.directive.ts:79` — `computeVwap()` → `tp`
  - `(highs[i]+lows[i]+closes[i])/3`
- `nest/src/modules/directives/implementations/vwap-confluence.directive.ts:90` — `computeVwapStdDev()` → `tp`
  - `(highs[i]+lows[i]+closes[i])/3`
- `nest/src/modules/directives/utils/indicators.ts:738` — `vwap()` → `tp`
  - `(highs[i]+lows[i]+closes[i])/3`
- `nest/src/modules/indicators/indicators.service.ts:71` — `computeSupportResistance()` → `pivot`
  - `(prev.high+prev.low+prev.close)/3`
- … and 2 more

### 7 sites — `(C?VN*(N-VN/N):VN*(N+VN/N))`

- `nest/src/modules/automation/ab-test.service.ts:449` — `dispatchSideTrade()` → `sl`
  - `sideDir==='BUY'?entryPrice*(1-slPct/100):entryPrice*(1+slPct/100)`
  - conditions: `sideDir==='BUY'`
- `nest/src/modules/automation/automation-loop.service.ts:802` — `dispatchTrade()` → `sl`
  - `side==='BUY'?entryPrice*(1-slPct/100):entryPrice*(1+slPct/100)`
  - conditions: `side==='BUY'`
- `nest/src/modules/automation/automation-loop.service.ts:2745` — `confirmAction()` → `sl`
  - `entryPrice>0?action.side==='BUY'?entryPrice*(1-slPct/100):entryPrice*(1+slPct/100):0`
  - conditions: `action.side==='BUY'`
  - guarded by: `entryPrice>0`
- `nest/src/modules/automation/automation-loop.service.ts:2854` — `recordPaperTrade()` → `sl`
  - `side==='BUY'?entryPrice*(1-slPct/100):entryPrice*(1+slPct/100)`
  - conditions: `side==='BUY'`
- `nest/src/modules/automation/stop-guardian.service.ts:1770` — `observeSimulatedTsl()` → `triggerPrice`
  - `isBuy?best*(1-distancePct/100):best*(1+distancePct/100)`
  - conditions: `isBuy`
- `nest/src/modules/automation/stop-guardian.service.ts:1990` — `protectiveSl()` → `protective`
  - `side==='BUY'?entry*(1-slPct/100):entry*(1+slPct/100)`
  - conditions: `side==='BUY'`
- `nest/src/modules/backtest/backtest.service.ts:1571` — `run()` → `trailStop`
  - `isLong?bestPrice*(1-plan.trailPct/100):bestPrice*(1+plan.trailPct/100)`
  - conditions: `isLong`

_… and 34 further group(s)._

## Q3c — the same idea, re-derived

A difference and its mirror in one expression. **This is the tier that finds a copy whose variable names, branch order and division position have all changed.** It is wider than `exact` on purpose, so it is longer — read the group, not the count.

### 5 sites — `SIGNED-MIRROR-DIFF`

- `nest/src/common/trading/peak.ts:96` — `profitPctFor()` → `raw`
  - `isShort?(entry-px)/entry:(px-entry)/entry`
  - conditions: `isShort`
- `nest/src/modules/automation/stop-guardian.service.ts:1757` — `observeSimulatedTsl()` → `profitPct`
  - `((isBuy?pos.priceCurrent-pos.priceOpen:pos.priceOpen-pos.priceCurrent)/pos.priceOpen)*100`
  - conditions: `isBuy`
- `nest/src/modules/automation/stop-guardian.service.ts:1875` — `observeExhaustion()` → `profitPct`
  - `((isBuy?pos.priceCurrent-entry:entry-pos.priceCurrent)/entry)*100`
  - conditions: `isBuy`
- `nest/src/modules/scoring/exit-consensus.service.ts:373` — `assessOne()` → `profitPct`
  - `entry>0?((side==='buy'?current-entry:entry-current)/entry)*100:0`
  - conditions: `side==='buy'`
  - guarded by: `entry>0`
- `nest/src/modules/scoring/exit-consensus.service.ts:374` — `assessOne()` → `peakProfitPct`
  - `peak==null||entry<=0?null:((side==='buy'?peak-entry:entry-peak)/entry)*100`
  - conditions: `side==='buy'`
  - guarded by: `peak==null||entry<=0`

## Nodes with no resolved consumer

A function that nothing calls, that is not exported, that carries no decorator, and that the framework does not call by name. **A candidate list, not a proof of dead code.**

What is EXCLUDED, and why each exclusion exists — every one of them was a false finding first:

| excluded | because |
|---|---|
| exported functions | reachable from another module, including modules outside this scan |
| `@Get()`/`@Post()`/… controller methods | the framework calls them; the source cannot show it |
| `constructor`, `onModuleInit`, `forRoot`, … | lifecycle hooks, called by NestJS |
| a method that implements an INTERFACE | a caller holding the interface resolves to its signature, not to the class method — six members of `trading212.adapter.ts` were reported dead until this was credited |
| a GETTER with no call | a getter is READ, not called — `hasCredentials` was reported dead for this reason |

⚠️ **And the caveat that remains:** a name is not a reference. `placeOrder` is declared **five** times in this backend (two adapters, a paper-trading service, an interface, and `mt5-trading.service.ts`), so a text search finds 11 call sites and attributes all 11 to one name. These are matched by resolved symbol, which is why they stay apart — but that also means a method reached ONLY through a dynamic lookup (`this[name](...)`) will appear here and is not dead.

- `nest/src/app.controller.ts:61 canTrade`
- `nest/src/common/cache/cache.service.ts:39 get`
- `nest/src/common/cache/cache.service.ts:58 set`
- `nest/src/common/cache/cache.service.ts:69 del`
- `nest/src/modules/alerts/alert-trigger.service.ts:150 stop`
- `nest/src/modules/alerts/alert-trigger.service.ts:226 label`
- `nest/src/modules/alerts/alert-trigger.service.ts:361 canTrade`
- `nest/src/modules/alerts/alert-trigger.service.ts:369 definitelyBlocked`
- `nest/src/modules/alerts/alert-trigger.service.ts:868 toMap`
- `nest/src/modules/automation/ab-test.service.ts:316 getActiveTest`
- `nest/src/modules/automation/ab-test.service.ts:375 isActive`
- `nest/src/modules/automation/ab-test.service.ts:606 summarize`
- `nest/src/modules/automation/automation-loop.service.ts:1959 evalSide`
- `nest/src/modules/automation/automation-loop.service.ts:2380 getClose`
- `nest/src/modules/automation/automation-loop.service.ts:512 read`
- `nest/src/modules/automation/automation-loop.service.ts:567 getWatchlistSymbols`
- `nest/src/modules/automation/automation.controller.ts:731 safe`
- `nest/src/modules/automation/stop-guardian.service.ts:1850 progress`
- `nest/src/modules/automation/stop-guardian.service.ts:568 flat`
- `nest/src/modules/backtest/affordable-size.ts:146 floorToStep`
- `nest/src/modules/backtest/backtest.controller.ts:702 mapResult`
- `nest/src/modules/backtest/backtest.service.ts:3587 chartTime`
- `nest/src/modules/backtest/backtest.service.ts:481 pick`
- `nest/src/modules/backtest/backtest.service.ts:605 labelled`
- `nest/src/modules/backtest/break-even.ts:180 med`
- `nest/src/modules/backtest/break-even.ts:89 round1`
- `nest/src/modules/backtest/break-even.ts:90 round2`
- `nest/src/modules/backtest/directive-preview.service.ts:142 getRsi`
- `nest/src/modules/backtest/directive-preview.service.ts:233 clampInt`
- `nest/src/modules/backtest/divergence-scan.ts:73 defaultRound`
- `nest/src/modules/backtest/divergence-scan.ts:97 eligible`
- `nest/src/modules/backtest/divergence-scan.ts:99 collect`
- `nest/src/modules/backtest/equity-drawdown.ts:61 num`
- `nest/src/modules/backtest/equity-drawdown.ts:66 round2`
- `nest/src/modules/backtest/equity-drawdown.ts:68 toMs`
- `nest/src/modules/backtest/execution-costs.ts:65 round8`
- `nest/src/modules/backtest/score-maths.ts:236 r4`
- `nest/src/modules/backtest/score-maths.ts:388 r4`
- `nest/src/modules/backtest/score-maths.ts:654 bucketKey`
- `nest/src/modules/backtest/score-maths.ts:71 stat`
- `nest/src/modules/backtest/score-maths.ts:76 r4`
- `nest/src/modules/backtest/score-maths.ts:809 keyOf`
- `nest/src/modules/backtest/score-maths.ts:838 diffOf`
- `nest/src/modules/backtest/score-maths.ts:878 capNote`
- `nest/src/modules/backtest/score-maths.ts:89 collect`
- `nest/src/modules/backtest/score-maths.ts:959 allSame`
- `nest/src/modules/directives/directives.service.ts:1039 refreshActiveStatuses`
- `nest/src/modules/directives/directives.service.ts:264 prepare`
- `nest/src/modules/directives/directives.service.ts:517 mean`
- `nest/src/modules/directives/directives.service.ts:623 evaluateGate`
- `nest/src/modules/directives/implementations/market-regime.directive.ts:116 smooth`
- `nest/src/modules/directives/implementations/momentum-and-macro.directives.ts:237 extract`
- `nest/src/modules/directives/implementations/momentum-and-macro.directives.ts:61 stubResult`
- `nest/src/modules/directives/implementations/mt5-indicators.directives.ts:1166 mid`
- `nest/src/modules/directives/implementations/mt5-indicators.directives.ts:41 avg`
- `nest/src/modules/directives/implementations/pattern-density-sr.directive.ts:130 binPrice`
- `nest/src/modules/directives/implementations/session-open-effect.directive.ts:75 s`
- `nest/src/modules/directives/implementations/session-open-effect.directive.ts:76 to`
- `nest/src/modules/directives/implementations/stochastic.directive.ts:23 deepOf`
- `nest/src/modules/directives/implementations/stochastic.directive.ts:24 mirrorOf`
- `nest/src/modules/directives/implementations/three-soldiers-pattern.directive.ts:105 bodyRatio`
- `nest/src/modules/directives/implementations/three-soldiers-pattern.directive.ts:98 openInPrevBody`
- `nest/src/modules/directives/implementations/volatility-envelope.directive.ts:98 percentile`
- `nest/src/modules/directives/utils/indicators.ts:322 smooth`
- `nest/src/modules/market-data/bar-refresh.service.ts:537 getProviderAdapter`
- `nest/src/modules/market-data/bar-refresh.service.ts:569 newestOf`
- `nest/src/modules/market-data/bar-refresh.service.ts:574 isStaleSet`
- `nest/src/modules/market-data/bar-refresh.service.ts:614 fetchBridgeCandles`
- `nest/src/modules/market-data/market-data.service.ts:33 evaluateFreshness`
- `nest/src/modules/paper-trading/paper-trading.service.ts:72 setStartingBalance`
- `nest/src/modules/paper-trading/paper-trading.service.ts:79 updateQuote`
- `nest/src/modules/planner/planner.service.ts:59 updateStylePreferences`
- `nest/src/modules/portfolio/portfolio.service.ts:230 norm`
- `nest/src/modules/providers/adapters/finnhub.adapter.ts:215 getNews`
- `nest/src/modules/providers/adapters/finnhub.adapter.ts:224 getSentiment`
- `nest/src/modules/providers/adapters/finnhub.adapter.ts:245 getRecommendations`
- `nest/src/modules/providers/adapters/finnhub.adapter.ts:297 collectRange`
- `nest/src/modules/providers/adapters/finnhub.adapter.ts:345 getPriceTarget`
- `nest/src/modules/providers/adapters/finnhub.adapter.ts:394 getSocialSentiment`
- `nest/src/modules/providers/adapters/finnhub.adapter.ts:436 getInsiderTransactions`
- `nest/src/modules/providers/adapters/finnhub.adapter.ts:464 getCompanyMetrics`
- `nest/src/modules/providers/adapters/finnhub.adapter.ts:508 getCapabilities`
- `nest/src/modules/providers/adapters/trading212.adapter.ts:534 getCapabilities`
- `nest/src/modules/providers/mt5/mt5-symbol-router.service.ts:383 getBrokerSymbol`
- `nest/src/modules/providers/position-sync.service.ts:692 note`
- `nest/src/modules/providers/provider-cache.service.ts:62 getStatus`
- `nest/src/modules/replay/replay.service.ts:628 computeReturn`
- `nest/src/modules/replay/replay.service.ts:653 avg`
- `nest/src/modules/research/earnings-import-settings.service.ts:238 getRunState`
- `nest/src/modules/research/investigation.service.ts:355 deleteStale`
- `nest/src/modules/research/research-import.service.ts:195 isAllowed`
- `nest/src/modules/research/research-import.service.ts:311 upsertOne`
- `nest/src/modules/research/research-import.service.ts:627 importInsiderTransactionsBulk`
- `nest/src/modules/research/research-import.service.ts:767 importCompanyMetricsBulk`
- `nest/src/modules/research/research-overview.service.ts:155 classify`
- `nest/src/modules/risk/monte-carlo.service.ts:77 simulate`
- `nest/src/modules/scheduler/trading-scheduler.service.ts:251 start`
- `nest/src/modules/scheduler/trading-scheduler.service.ts:256 stop`
- `nest/src/modules/scheduler/trading-scheduler.service.ts:261 getStatus`
- `nest/src/modules/scheduler/trading-scheduler.service.ts:270 runNow`
- `nest/src/modules/scheduler/trading-scheduler.service.ts:274 getHistory`
- `nest/src/modules/scoring/arena.controller.ts:462 isBuy`
- `nest/src/modules/scoring/arena.controller.ts:463 isSell`
- `nest/src/modules/scoring/averaging-scorer.ts:52 setPolicy`
- `nest/src/modules/scoring/averaging-scorer.ts:56 getPolicy`
- `nest/src/modules/scoring/averaging-scorer.ts:60 evaluate`
- `nest/src/modules/scoring/exit-consensus.service.ts:264 assessAll`
- `nest/src/modules/scoring/outcome-tracker.service.ts:844 trimOldOutcomes`
- `nest/src/modules/scoring/pnl-statistics.service.ts:165 empty`
- `nest/src/modules/scoring/pnl-statistics.service.ts:237 inPopulation`
- `nest/src/modules/scoring/protocol-db.service.ts:1068 protocolNeedsEurUsd`
- `nest/src/modules/scoring/protocol-db.service.ts:1084 getName`
- `nest/src/modules/scoring/protocol-db.service.ts:491 getAllSlugs`
- `nest/src/modules/scoring/protocol-gating.controller.ts:553 isIncluded`
- `nest/src/modules/scoring/protocol-gating.controller.ts:558 effectiveMax`
- `nest/src/modules/scoring/protocol-gating.service.ts:1636 worker`
- `nest/src/modules/scoring/protocol-health.service.ts:558 getLast`
- `nest/src/modules/scoring/protocols.controller.ts:70 recordActivity`
- `nest/src/modules/scoring/score-history.service.ts:116 richness`
- `nest/src/modules/scoring/score-history.service.ts:130 isWorkbench`
- `nest/src/modules/scoring/score-history.service.ts:418 truncateToMinute`
- `nest/src/modules/scoring/score-velocity.service.ts:112 flatten`
- `nest/src/modules/scoring/scoring.service.ts:831 debug`
- `nest/src/modules/scoring/signal-threshold-basis.ts:143 label`
- `nest/src/modules/scoring/strategy-derivation.service.ts:395 num`
- `nest/src/modules/screener/screener.service.ts:183 bump`
- `nest/src/modules/signals/signal-envelope.service.ts:1858 isRouteable`
- `nest/src/modules/signals/signal-envelope.service.ts:2043 q`
- `nest/src/modules/signals/signal-envelope.service.ts:2051 first`
- `nest/src/modules/signals/signal-envelope.service.ts:293 has`
- `nest/src/modules/signals/signal-envelope.service.ts:607 newestOfTf`
- `nest/src/modules/signals/signal-queue.service.ts:264 getQueue`
- `nest/src/modules/strategies/strategies.service.ts:56 calculateScore`
- `nest/src/modules/symbols/symbol-protocol-authority.service.ts:166 note`
- `nest/src/modules/symbols/symbol-protocol-authority.service.ts:179 runSource`
- `nest/src/modules/symbols/symbol-protocol-authority.service.ts:283 observedOnly`
- `nest/src/modules/symbols/symbol-protocol-authority.service.ts:328 note`
- `nest/src/modules/symbols/symbol-protocol-authority.service.ts:342 runSource`
- `nest/src/modules/symbols/symbols.service.ts:1076 readWatchlist`
- `nest/src/modules/symbols/symbols.service.ts:920 parseLatest`
- `nest/src/modules/symbols/symbols.service.ts:927 num`
- `nest/src/modules/trading/bot-performance.service.ts:362 empty`
- `nest/src/modules/trading/bot-performance.service.ts:438 readAll`
- `nest/src/modules/trading/duplicate-guard.service.ts:173 isBlocked`
- `nest/src/modules/trading/position-sizing.ts:83 bad`
- `nest/src/modules/trading/position-sizing.ts:87 pos`
- `nest/src/modules/trading/trade-history.controller.ts:1073 distOf`
- `nest/src/modules/trading/trade-history.controller.ts:1077 consensusOf`
- `nest/src/modules/trading/trade-history.controller.ts:1082 sorted`
- `nest/src/modules/trading/trade-history.controller.ts:1083 pct`
- `nest/src/modules/trading/trade-history.controller.ts:1200 slPctOf`
- `nest/src/modules/trading/trade-history.controller.ts:441 round2`
- `nest/src/modules/trading/trade-history.controller.ts:643 readAll`
- `nest/src/modules/trading/trade-history.controller.ts:668 resolveProtocol`
- `nest/src/modules/trading/trade-history.controller.ts:767 median`
- `nest/src/modules/trading/trade-history.controller.ts:773 r2`
- `nest/src/modules/trading/trade-recorder.service.ts:167 reject`
- `nest/src/modules/trading/trading-strategy.service.ts:1119 shape`
- `nest/src/modules/trading/trading-strategy.service.ts:2401 evaluateAllActive`
- `nest/src/modules/trading/trading-strategy.service.ts:268 num`
- `nest/src/modules/watchlists/watchlists.controller.ts:381 has`

