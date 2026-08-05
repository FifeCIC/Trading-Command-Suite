## Problem

Today's EURUSD trade audit took an AI agent ~30 API calls, 200 lines of source code, and manual cross-referencing to reconstruct the full META.Stack chain (protocol → scoring strategy → trading strategy → execution). That is not sustainable for daily monitoring or debugging.

The system should produce **structured, META.Stack-aware** logs that agents (and developers) can query *without* reverse-engineering the pipeline from source each time.

## Proposal

Add per-META.Stack-layer structured event logs:

```
[tick:42] [meta-stack] [protocol] eurusd-macro-v1 scored EURUSD: composite=25 signal=HOLD risk=1.0
[tick:42] [meta-stack] [scoring] ss-1785459282433: threshold=60 baseSize=0.01 sl=1.0% tp=1.5%
[tick:42] [meta-stack] [compare] single-protocol, composite=25 < threshold=60 → HOLD (blocked)
[tick:42] [meta-stack] [decision] London EURUSD Macro SKIP: threshold gate (25 < 60)
```

These are not replacement for `stdout.log` — they're **supplemental, structured, one-line-per-decision** events at key decision points. JSON-format for agentic querying.

## Desired log shape

```json
{
  "tick": 42,
  "layer": "protocol|scoring|compare|decision|dispatch|execution",
  "strategyId": "...",
  "protocolId": "...",
  "symbol": "EURUSD",
  "composite": 25,
  "signal": "HOLD",
  "threshold": 60,
  "result": "SKIP",
  "reason": "threshold gate (25 < 60)",
  "ts": "..."
}
```

## Where to add

- `protocolGating.scoreWithGating()` — emit protocol score + signal (already returns it, just log)
- `compareProtocolPair()` — emit comparison result (added threshold, gate reason)
- `dispatchTrade()` — emit dispatch decision + computed SL/TP
- `mt5.placeOrder` — emit fill confirmation

## Tasks

- [ ] Define `MetaStackLogEntry` interface
- [ ] Add logging calls at the 4 decision points above
- [ ] Store in a ring-buffer or append-only log file (not stdout — dedicated META.Stack log)
- [ ] Optional: expose via `GET /api/automation/meta-stack-log?limit=50`
- [ ] Document the log format so agents understand the schema without reading source

## Doc comments for acceptable discrepancies

- SL/TP computed from bar-close vs filled at actual market price → discrepancy ≤ ~0.5% is normal fill-price delta. Do NOT chase this as a bug.
- Composite computed with rare-raw adjustments, session penalty, DXY proxy — slight drift (≤2 pts) between evaluations of the same tick is expected. Rerun scores discard cached values.
