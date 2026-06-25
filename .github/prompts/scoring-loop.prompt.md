# scoring-loop: Automated Portfolio Scoring & Trading Loop

**Prompt ID:** scoring-loop
**Date:** 2026-06-25
**Status:** ready

## Goal

Build the automated loop that continuously scores the Trading212 portfolio, evaluates trading strategies, and optionally executes trades. This is the "engine" that turns TCS from a manual analysis tool into an autonomous trading assistant.

## Technology Choice

### Why NOT cron

Cron is for OS-level scheduled tasks. It's external to the app, can't access in-memory state, and can't be controlled from the UI. The user needs to toggle automation ON/OFF from the dashboard.

### Why NestJS @Interval

NestJS has a built-in `@nestjs/schedule` package with `@Interval()` decorator:

```typescript
@Injectable()
export class ScoringLoopService {
  @Interval(300000) // 5 minutes
  async runScoringLoop() {
    // 1. Fetch portfolio
    // 2. Score all positions
    // 3. Evaluate strategy
    // 4. Execute trades if enabled
  }
}
```

This runs in-process, can be paused/resumed, and the interval can be changed dynamically. No external dependencies needed (we're already in fallback mode without Redis).

### Alternative: Manual setInterval

For more control, a manual `setInterval` in a service gives us:
- Dynamic interval changes
- Immediate pause/resume
- Run-on-demand capability
- No extra npm package

We'll use this approach for maximum control.

## Architecture

```
AutomationService (manages state: on/off, config)
    │
    ├── ScoringLoopService (the loop itself)
    │   ├── fetch PortfolioService.getPositions()
    │   ├── score ProtocolGatingService.scoreWithGating()
    │   ├── evaluate TradingStrategyService.evaluate()
    │   └── execute Mt5TradingService.placeOrder() [if enabled]
    │
    └── AutomationController (REST API for dashboard)
        ├── GET  /api/automation/status
        ├── POST /api/automation/toggle
        ├── POST /api/automation/config
        └── POST /api/automation/run-now
```

### AutomationService State

```typescript
interface AutomationState {
  enabled: boolean;
  activeProtocol: string;    // 'default' or protocol ID
  activeStrategy: string;    // strategy ID
  scoreIntervalMs: number;   // default 300000 (5 min)
  tradeThreshold: number;    // minimum composite to trigger trade (default 65)
  requireConfirmation: boolean; // if true, queue action for UI approval
  lastRunAt: string | null;
  nextRunAt: string | null;
  lastRunMs: number;
  pendingActions: AutomationAction[];
}
```

### Loop Logic

```
Every [scoreIntervalMs]:
  1. Check if enabled — skip if disabled
  2. Fetch Trading212 portfolio positions
  3. For each position:
     a. Run protocol-gated scoring with activeProtocol
     b. Record composite, signal, directives, risk multiplier
  4. Sort by composite DESC
  5. For top-scored symbol:
     a. Check if composite >= tradeThreshold
     b. Check if risk gate passed (not gated)
     c. Evaluate activeStrategy
     d. If all pass AND auto-trade enabled:
        - Place order via Mt5TradingService
        - Record in TradeRecorderService
        - Log decision with full directive breakdown
     e. If requireConfirmation:
        - Queue as pending action
        - Wait for UI approval
  6. Update lastRunAt, nextRunAt
```

## Recording Decisions

Every loop iteration records:
```typescript
{
  timestamp: string,
  portfolio: { symbol: string, score: number, signal: string }[],
  topPick: { symbol, score, signal, directives: DirectiveBreakout[] },
  decision: {
    action: 'BUY' | 'SELL' | 'HOLD' | 'SKIP',
    reason: string,
    riskGatePassed: boolean,
    riskMultiplier: number,
    threshold: number
  },
  execution?: {
    ticket: number,
    price: number,
    volume: number
  }
}
```

This data feeds the dashboard's "Why" panel — every trade decision is fully auditable.

## Safety

- Auto-trade is OFF by default
- Master toggle on dashboard disables ALL automated trading
- `requireConfirmation` mode queues actions for manual approval
- Maximum 1 trade per loop iteration
- Minimum 1 minute between trades (prevent cascade)
- Emergency stop: `POST /api/automation/emergency-stop` kills loop + closes all positions

## Files

- `nest/src/modules/automation/automation.service.ts` — state management
- `nest/src/modules/automation/scoring-loop.service.ts` — the loop
- `nest/src/modules/automation/automation.controller.ts` — REST API
- `nest/src/modules/automation/automation.module.ts` — module registration
