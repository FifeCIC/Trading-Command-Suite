# PIPELINE-MAP — the bars pipeline, generated from source

> ⚠️ **GENERATED — do not edit.** Regenerate with `node scripts/generate-pipeline-map.cjs`.
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
- **readers (0):** _none_ — nothing reads this_

