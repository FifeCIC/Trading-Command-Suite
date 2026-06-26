# automation-loop: Broker-Agnostic Scoring, Evaluation & Execution Engine

**Prompt ID:** automation-loop
**Date:** 2026-06-26
**Status:** ready
**Depends on:** `unified-broker-interface.prompt.md`, `automation-timeline.prompt.md`

## Goal

Build the automated loop that continuously scores portfolios across ALL connected brokers, evaluates active trading strategies, checks the timeline for relevant events, and optionally executes trades. This is the engine — it must never mention a specific broker by name.

## Why Not Cron / @Interval / @Cron

- **Cron**: External to the app. Can't access in-memory state. Can't be controlled from the UI.
- **NestJS `@Interval`**: NestJS-specific, harder to pause/resume dynamically, tied to module lifecycle.
- **NestJS `@Cron`**: Requires `@nestjs/schedule`, adds dependency for something simple.

**Decision: Manual `setInterval` in a service.** Gives us:
- Dynamic interval changes per broker/strategy
- Immediate pause/resume without module restart
- Run-on-demand capability from the dashboard
- No extra npm packages (we're in fallback mode, no Redis)

## Architecture

```
AutomationLoopService
    │
    ├── loopTimer: NodeJS.Timeout | null
    ├── state: AutomationState (in-memory, DB-persisted)
    │
    ├── tick() — called every [interval]ms
    │   │
    │   ├── 1. CHECK TIMELINE
    │   │   └── TimelineService.getRelevantEvents(now)
    │   │       → "FOMC in 30m" → adjust risk across all strategies
    │   │       → "AAPL earnings tomorrow" → gate AAPL positions
    │   │       → "London session open" → boost XAU protocols
    │   │
    │   ├── 2. FETCH PORTFOLIOS
    │   │   └── For each broker with supportsBrokerage:
    │   │       ├── adapter.getPositions()
    │   │       └── adapter.getAccount()
    │   │
    │   ├── 3. SCORE ALL POSITIONS
    │   │   └── For each position across all brokers:
    │   │       ├── getProtocolForSymbol(symbol)
    │   │       ├── ScoringService.scoreWithGating(symbol, protocol)
    │   │       └── Record: { symbol, brokerId, composite, signal, directives }
    │   │
    │   ├── 4. EVALUATE ACTIVE STRATEGIES
    │   │   └── For each strategy where active=true:
    │   │       ├── Check cooldown (skip if cooling)
    │   │       ├── Check position limits (skip if maxed)
    │   │       ├── Check timeline gates (skip if earnings/FOMC risk)
    │   │       ├── TradingStrategyService.evaluate(strategyId)
    │   │       └── If passed → dispatch based on mode
    │   │
    │   ├── 5. DISPATCH (per strategy mode)
    │   │   ├── mode=manual    → log signal, notify dashboard
    │   │   ├── mode=semi-auto → queue for confirmation, notify dashboard
    │   │   └── mode=auto      → execute immediately (with safety checks)
    │   │
    │   └── 6. EXECUTE (auto mode only)
    │       ├── Safety: max 1 trade per tick
    │       ├── Safety: min 60s between any trades
    │       ├── adapter.placeOrder(params)
    │       ├── TradeRecorderService.record(origin='strategy')
    │       └── Update strategy cooldown
    │
    └── REST API (AutomationController)
        ├── GET  /api/automation/status
        ├── POST /api/automation/toggle
        ├── POST /api/automation/config
        ├── POST /api/automation/run-now
        └── POST /api/automation/emergency-stop
```

## AutomationState

```typescript
interface AutomationState {
  // Loop
  loopEnabled: boolean;        // master toggle
  tickIntervalMs: number;      // default 300000 (5 min) — can vary per broker
  lastTickAt: string | null;
  nextTickAt: string | null;
  tickCount: number;
  lastTickMs: number;

  // Per-broker overrides
  brokerStates: Record<string, {
    enabled: boolean;
    scoreIntervalMs: number;
    tradingEnabled: boolean;   // can score but not trade
    requireConfirmation: boolean;
    tradeThreshold: number;
  }>;

  // Active strategies
  activeStrategyIds: string[];

  // Pending actions (semi-auto mode)
  pendingActions: PendingAction[];

  // Timeline snapshot (last checked)
  activeEvents: TimelineEvent[];
}
```

## Tick Logic (detailed)

```typescript
async tick() {
  const tickStart = Date.now();
  this.state.tickCount++;
  this.state.lastTickAt = new Date().toISOString();

  // ── 1. Check Timeline ──
  const events = await this.timelineService.getActiveEvents();
  this.state.activeEvents = events;
  
  // Events that affect all strategies
  const globalRiskEvents = events.filter(e => e.scope === 'global');
  const globalRiskMultiplier = this.computeGlobalRiskMultiplier(globalRiskEvents);
  
  // Events that affect specific symbols
  const symbolEvents = new Map<string, TimelineEvent[]>();
  for (const e of events.filter(e => e.scope === 'symbol')) {
    const list = symbolEvents.get(e.symbol) || [];
    list.push(e);
    symbolEvents.set(e.symbol, list);
  }

  // ── 2. Fetch Portfolios ──
  const brokers = this.adapterFactory.getBrokerageAdapters();
  const allPositions: ScoredPosition[] = [];

  for (const broker of brokers) {
    if (!this.state.brokerStates[broker.id]?.enabled) continue;
    
    const positions = await broker.getPositions!();
    const account = await broker.getAccount?.() ?? null;

    // ── 3. Score Each Position ──
    for (const pos of positions) {
      const symEvents = symbolEvents.get(pos.symbol) || [];
      const timelineMultiplier = this.computeSymbolRiskMultiplier(symEvents);
      
      const protocol = getProtocolForSymbol(pos.symbol);
      const score = await this.scoringService.scoreWithGating(pos.symbol, {
        protocolId: protocol,
        applyRiskGates: true,
        timelineMultiplier,  // ← timeline adjusts the score
      });

      allPositions.push({
        ...pos,
        composite: score.composite,
        signal: score.signal,
        directives: score.directives,
        riskMultiplier: score.riskMultiplier * globalRiskMultiplier * timelineMultiplier,
        timelineEvents: symEvents,
      });
    }
  }

  // Sort by composite DESC
  allPositions.sort((a, b) => b.composite - a.composite);

  // ── 4. Evaluate Active Strategies ──
  const decisions: LoopDecision[] = [];

  for (const strategyId of this.state.activeStrategyIds) {
    const strategy = await this.strategyService.findOne(strategyId);
    if (!strategy?.active) continue;

    // Cooldown check
    const lastTrade = this.lastTradeTime.get(strategyId);
    if (lastTrade && (Date.now() - lastTrade.getTime()) < strategy.cooldownMinutes * 60000) {
      continue;
    }

    // Find matching scored position
    const scored = allPositions.find(p => 
      p.symbol === strategy.symbol && p.brokerId === strategy.brokerId
    );
    if (!scored) continue;

    // Timeline gate: is there a blocking event for this symbol?
    const blockEvent = scored.timelineEvents?.find(e => e.action === 'block');
    if (blockEvent) {
      decisions.push({
        timestamp: new Date().toISOString(),
        strategyId, symbol: strategy.symbol, brokerId: strategy.brokerId,
        decision: 'BLOCKED',
        reason: `Timeline event: ${blockEvent.label}`,
        composite: scored.composite,
        signal: scored.signal,
      });
      continue;
    }

    // Full evaluation
    const evalResult = await this.strategyService.evaluate(strategyId);
    if (!evalResult.evaluated || !evalResult.passed) {
      decisions.push({
        timestamp: new Date().toISOString(),
        strategyId, symbol: strategy.symbol, brokerId: strategy.brokerId,
        decision: 'SKIP',
        reason: evalResult.evaluated ? 'Conditions not met' : evalResult.reason,
        composite: evalResult.composite,
        signal: evalResult.signal,
        checks: evalResult.checks,
      });
      continue;
    }

    // ── 5/6. Dispatch ──
    if (strategy.mode === 'manual') {
      decisions.push({
        timestamp: new Date().toISOString(),
        strategyId, symbol: strategy.symbol, brokerId: strategy.brokerId,
        decision: 'SIGNAL',
        reason: 'Manual mode — awaiting human',
        composite: evalResult.composite,
        signal: evalResult.signal,
        suggestedSize: evalResult.suggestedSize,
      });
      continue;
    }

    if (strategy.mode === 'semi-auto') {
      const actionId = uuid();
      this.state.pendingActions.push({
        id: actionId,
        strategyId, symbol: strategy.symbol, brokerId: strategy.brokerId,
        side: evalResult.signal,
        quantity: evalResult.suggestedSize,
        composite: evalResult.composite,
        createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 5 * 60000).toISOString(), // 5 min expiry
        evaluationId: evalResult.evaluationId,
      });
      decisions.push({
        timestamp: new Date().toISOString(),
        strategyId, symbol: strategy.symbol, brokerId: strategy.brokerId,
        decision: 'QUEUED',
        reason: 'Awaiting confirmation',
        composite: evalResult.composite,
        signal: evalResult.signal,
        actionId,
      });
      continue;
    }

    if (strategy.mode === 'auto') {
      // Safety: max 1 trade per tick
      const tradesThisTick = decisions.filter(d => d.decision === 'EXECUTED').length;
      if (tradesThisTick >= 1) {
        decisions.push({
          strategyId, symbol: strategy.symbol, brokerId: strategy.brokerId,
          decision: 'SKIP',
          reason: 'Max 1 trade per tick',
          composite: evalResult.composite,
        });
        continue;
      }

      // Safety: min 60s between any trades
      if (this.lastAnyTradeAt && (Date.now() - this.lastAnyTradeAt) < 60000) {
        continue; // skip, try next tick
      }

      // Execute
      const broker = this.adapterFactory.create(strategy.brokerId);
      const result = await broker!.placeOrder!({
        symbol: strategy.symbol,
        side: evalResult.signal as 'BUY' | 'SELL',
        quantity: evalResult.suggestedSize,
        sl: evalResult.slPrice,
        tp: evalResult.tpPrice,
        comment: `TCS ${strategy.name} | ${evalResult.composite}%`,
      });

      this.lastTradeTime.set(strategyId, new Date());
      this.lastAnyTradeAt = Date.now();

      decisions.push({
        timestamp: new Date().toISOString(),
        strategyId, symbol: strategy.symbol, brokerId: strategy.brokerId,
        decision: result.success ? 'EXECUTED' : 'FAILED',
        reason: result.success ? `Ticket ${result.ticket}` : result.error,
        composite: evalResult.composite,
        signal: evalResult.signal,
        ticket: result.ticket,
        price: result.price,
        quantity: evalResult.suggestedSize,
      });
    }
  }

  // ── Record Decisions ──
  await this.recordDecisions(decisions);
  await this.persistState();

  // ── Schedule Next ──
  this.state.lastTickMs = Date.now() - tickStart;
  this.state.nextTickAt = new Date(Date.now() + this.state.tickIntervalMs).toISOString();
}
```

## Timeline Integration (Critical)

The loop checks the timeline BEFORE scoring, not after. This means:

1. **Global events** (FOMC, NFP, CPI) → reduce risk multiplier across ALL strategies
2. **Symbol events** (earnings, FDA decisions) → gate or boost specific symbols
3. **Session events** (London open, NY open) → boost protocols active in those sessions
4. **Seasonality windows** → adjust scoring thresholds based on historical performance

```typescript
// Example: FOMC minutes in 30 minutes
const globalRiskMultiplier = 0.5; // Half size on all positions

// Example: AAPL earnings tomorrow
const symbolEvent = { action: 'block', label: 'AAPL earnings in 18h' };
// Result: AAPL positions are not traded, even if score is high

// Example: London session opening now
const sessionEvent = { action: 'boost', label: 'London session open', multiplier: 1.2 };
// Result: XAUUSD, EURUSD scoring gets 1.2× boost
```

## Safety (Non-Negotiable)

- **Auto-trade OFF by default** — every broker, every strategy
- **Master toggle** on dashboard: one click kills all trading (scoring continues)
- **Per-broker toggle**: can score T212 but only trade MT5
- **Max 1 trade per tick** across all brokers combined
- **Min 60s between any two auto-trades**
- **requireConfirmation mode** — trade is queued, not executed
- **Pending actions expire after 5 minutes** — stale signals are auto-rejected
- **Emergency stop**: `POST /api/automation/emergency-stop`
  - Stops the loop timer
  - Attempts to close all positions on all brokers
  - Sets all strategies to inactive
  - Logs the event

## Recording Everything

Every tick records a `LoopTick`:
```typescript
{
  tickNumber: number,
  startedAt: string,
  durationMs: number,
  brokersChecked: string[],
  positionsScored: number,
  strategiesEvaluated: number,
  tradesExecuted: number,
  decisions: LoopDecision[],
  activeEvents: TimelineEvent[],
  globalRiskMultiplier: number,
}
```

This data feeds the dashboard's Decision Log and Timeline panels. Nothing is invisible.

## API Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/automation/status` | Full state: loop, brokers, strategies, pending actions, timeline |
| POST | `/api/automation/toggle` | `{ target: 'all' | brokerId | strategyId, enabled: boolean }` |
| POST | `/api/automation/config` | Update broker config (interval, threshold, trading enabled) |
| POST | `/api/automation/run-now` | Trigger immediate tick |
| POST | `/api/automation/emergency-stop` | Kill loop + close all positions |
| POST | `/api/automation/confirm-action` | `{ actionId }` — approve queued trade |
| POST | `/api/automation/reject-action` | `{ actionId }` — reject queued trade |

## Files

- `nest/src/modules/automation/automation-loop.service.ts` — the tick loop
- `nest/src/modules/automation/automation-state.service.ts` — state persistence
- `nest/src/modules/automation/automation.controller.ts` — REST API
- `nest/src/modules/automation/automation.module.ts` — module registration
- `nest/src/modules/automation/automation.decisions.ts` — LoopDecision, PendingAction types
- `nest/prisma/schema.prisma` — `LoopTick` model, `AutomationConfig` model
