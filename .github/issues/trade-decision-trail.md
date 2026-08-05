## Problem

Auditing today's EURUSD trade required ~30 API calls and reading 200+ lines of source by a human-aided AI agent. That is not feasible for A/B testing, debugging, or trust-building at scale. End-users and AI agents both need to be able to trace a trade from execution back through every decision.

## Desired capability

`GET /api/activity/trade/:ticket/decision-trail` returns the full chain:

```
MT5 ticket (position/deal)
  → Trading Strategy (name, mode, params)
  → Scoring Strategy (protocolId, watchlist, slPct/tpPct/baseSize, tradeThreshold)
  → Protocol gated-score (composite, signal)
  → Protocol directive breakouts (per-directive scores, gates, reasons)
  → Risk gates (duplicate guard, diversification, safety)
  → Execution dispatch (sl/tp computed from bar close vs fill)
  → MT5 fill confirmation (filled price, timestamp, ticket)
```

All data exists in DB/logs. It just needs assembling.

## Where the data lives

- `decision_log` — per-tick decision (SCORED/SKIP/BLOCKED)
- `strategy_evaluation` — evaluation records (composite, signal, reason)
- `trade_record` / `order_log` — MT5 order records (ticket, magic, comment)
- `mt5_bridge` logs — bridge-level fill info
- `automation` stdout.log — dispatch details

## Tasks

- [ ] Design the `/api/activity/trade/:ticket/decision-trail` response shape
- [ ] Assemble the chain from existing tables/logs (no new tables needed)
- [ ] Surface in UI: "Why did this trade happen?" link on any trade/ticket display
- [ ] Include directive-level breakouts (which directives fired, their scores and reasons)

## Discussion

This is essential for A/B testing protocols and strategies. Without it, we're flying blind — the user's gut feeling that things operate *outside* the META.Stack is a direct result of having no self-service trade autopsy.
