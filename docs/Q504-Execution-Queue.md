# Q504 — Execution Queue System

**Type:** Feature — Backend (NestJS)  
**Depends on:** Q502 (ProtocolRunner), Q503 (Symbol Data Cache)  
**Status:** CLAIM__

## Context

Protocol runs can take 10-60+ seconds (N symbols × M directives × provider API calls). We need an execution queue that manages concurrent runs, prevents double-execution, and provides visibility into what's running, queued, or failed.

The queue system provides:
1. Orderly execution (no two runs for the same protocol simultaneously)
2. Hot-add/remove of symbols during a run
3. Status visibility for the Automation Dashboard (Q501)

## Steps

### 1. Create ExecutionQueueService
- Path: `nest/src/modules/automation/execution-queue.service.ts`
- Internal: array of `QueueJob` objects with state machine
- States: `queued → running → complete | failed | cancelled`

```typescript
interface QueueJob {
  id: string;              // uuid
  runId: number;           // ProtocolRun.id
  protocolId: string;
  symbols: string[];
  status: 'queued' | 'running' | 'complete' | 'failed' | 'cancelled';
  progress: { done: number; total: number; currentSymbol?: string };
  result?: RunResult;      // from ProtocolRunner
  error?: string;
  queuedAt: Date;
  startedAt?: Date;
  completedAt?: Date;
}
```

### 2. Core methods
- `enqueue(runId: number): Promise<string>` — add to queue, return job ID
- `dequeue(): Promise<void>` — process next job (called internally)
- `getStatus(jobId: string): QueueJob | null`
- `getQueue(): QueueJob[]` — all jobs (queued + running + recent)
- `cancel(jobId: string): boolean`
- `getStats(): QueueStats` — `{ queued, running, completed, failed }`

### 3. Concurrency rules
- Max 1 job running at a time (sequential execution)
- Same protocolId cannot be queued twice simultaneously
- Failed jobs auto-retry once after 30s
- Completed jobs kept in memory for 5 minutes (for UI polling), then evicted

### 4. WebSocket/SSE for progress (v2, can be deferred)
- For v1: frontend polls `GET /api/automation/queue` every 2s
- For v2: Server-Sent Events stream `GET /api/automation/queue/stream`

### 5. API endpoints (in AutomationController)
- `GET /api/automation/queue` — current queue state
- `GET /api/automation/queue/:jobId` — single job status
- `POST /api/automation/queue/:jobId/cancel` — cancel a job
- `GET /api/automation/queue/stats` — aggregate stats

## Edge Cases

- **Stale jobs**: If a job is stuck "running" for > 5 minutes, auto-mark as failed
- **Server restart**: Queue is in-memory. On restart, all queued jobs are lost. (Acceptable for v1 — persistent queue is v3.)
- **Empty symbol list**: Reject with 400 "No symbols provided"
- **Invalid protocolId**: Reject with 400 "Unknown protocol"

## Files to Create/Modify

| File | Action |
|------|--------|
| `nest/src/modules/automation/execution-queue.service.ts` | Create |
| `nest/src/modules/automation/automation.controller.ts` | Modify (add queue endpoints) |
| `nest/src/modules/automation/automation.module.ts` | Modify (register service) |
