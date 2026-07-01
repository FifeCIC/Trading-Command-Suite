# Q502 — ProtocolRunner Backend Service

**Type:** Feature — Backend (NestJS)  
**Depends on:** Q501 (Automation Dashboard UI) for frontend, Q503 (Symbol Data Cache) for API deduplication  
**Status:** CLAIM__

## Context

The ProtocolRunner is the engine that executes multi-protocol scoring runs. Each "run" is a configuration that maps a list of symbols to a protocol preset and executes all directives for each symbol sequentially (or in parallel where safe).

The critical architectural insight: **we must NOT make the same API call 3 times for the same symbol in a 10-second period.** This is why Q503 (Symbol Data Cache) is a hard dependency — ProtocolRunner should only request "symbol X data" and the cache layer handles deduplication across concurrent protocol runs.

## Steps

### 1. Create ProtocolRunnerService
- Path: `nest/src/modules/automation/protocol-runner.service.ts`
- Inject: DirectiveService, ScoringService, ConditionDetectorService, ActivationGateService, CalibrationService
- Key method: `executeRun(runConfig: ProtocolRunConfig): Promise<RunResult>`
- `executeRun()` flow:
  1. Receive `{ protocolId, symbols[], options }`
  2. For each symbol: fetch fresh market data (via cache — Q503)
  3. Run condition detection → activation gate → directives → scoring
  4. Collect results: `{ symbol, score, breakdown, signalClass, timestamp }`
  5. Return aggregate `RunResult`

### 2. Create ProtocolRun model (Prisma)
- Path: `nest/prisma/schema.prisma`
- Model: `ProtocolRun`
  - `id` (Int, autoincrement, PK)
  - `name` (String)
  - `protocolId` (String) — which protocol preset
  - `symbols` (Json) — array of symbol strings
  - `status` (String) — pending/running/complete/failed
  - `results` (Json) — cached last run results
  - `createdAt`, `updatedAt`, `lastRunAt` (DateTime)
  - `runCount` (Int, default 0)
  - `errorMessage` (String?, nullable)

### 3. Create AutomationController
- Path: `nest/src/modules/automation/automation.controller.ts`
- Endpoints:
  - `GET /api/automation/runs` — list all configured runs
  - `POST /api/automation/runs` — create a run `{ name, protocolId, symbols }`
  - `POST /api/automation/runs/:id/execute` — trigger execution (returns async)
  - `GET /api/automation/results/:runId` — get latest results
  - `DELETE /api/automation/runs/:id` — remove a run
  - `GET /api/automation/queue` — execution queue status (Q504)

### 4. Create AutomationModule
- Path: `nest/src/modules/automation/automation.module.ts`
- Import: DirectivesModule, ScoringModule, forwardRef(() => TradingModule)
- Export: ProtocolRunnerService, AutomationController
- Register in AppModule

### 5. Protocol config presets
Store protocol presets (which directives, weights) in a config file:
- Path: `nest/src/modules/automation/protocol-presets.ts`
- At minimum: `momentum-short`, `mean-reversion`, `swing-long`
- Each preset: `{ id, name, description, directives: [{ id, weight }] }`

## Design Decisions

- **Async execution**: `POST /runs/:id/execute` returns immediately with a job ID. Frontend polls `GET /results/:runId` or watches the execution queue (Q504).
- **No real-time WebSocket yet** — polling is sufficient for v1.
- **Parallel safety**: ProtocolRunner should NEVER make raw provider calls directly. Always go through the cache layer (Q503). This is the single most important architectural rule.

## Files to Create/Modify

| File | Action |
|------|--------|
| `nest/src/modules/automation/protocol-runner.service.ts` | Create |
| `nest/src/modules/automation/automation.controller.ts` | Create |
| `nest/src/modules/automation/automation.module.ts` | Create |
| `nest/src/modules/automation/protocol-presets.ts` | Create |
| `nest/prisma/schema.prisma` | Modify (add ProtocolRun model) |
| `nest/src/app.module.ts` | Modify (register AutomationModule) |
