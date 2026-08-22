# Handoff: Default Protocol Removed (2026-08-22)

## Why
Unscoped scoring (no protocol, no strategy) fell back to an implicit 'default'
protocol that ran every directive as a kitchen-sink and persisted risky Score /
score_snapshot rows (e.g. NEE phantom scores). The default protocol is now
deleted from the app completely: code, seed data, and database.

## Code changes
- `protocol-gating.service.ts`
  - `scoreWithGating()` now **throws BadRequestException when no protocolId**,
    and **throws NotFoundException when the protocol doesn't exist or has no
    directive groups**. No more DIRECTIVE_GROUPS kitchen-sink fallback.
  - `scorePortfolio()` now requires a protocolId.
  - `storeSnapshot()` no longer special-cases 'default'.
- `protocol-gating.controller.ts`
  - `GET /api/scoring/gated/portfolio` resolves **each position's own protocol**
    from symbol_protocol_assignment; unassigned positions are skipped.
  - `POST /api/scoring/gated/batch` requires `protocolId` (400 otherwise).
- `protocols.controller.ts` — synthetic 'default' registry entry removed.
- `speed-scan.service.ts` — unassigned symbols are skipped
  ("No protocol assigned — unscoped default scoring removed") instead of
  resolving to slug 'default'.
- `signal-envelope.service.ts` — `buildLadder()` without a protocol returns an
  empty ladder with an explanatory message.
- `automation-loop.service.ts` — strategies without a protocol are skipped with
  a debug log (no more `effectiveProtocolId || 'default'`).
- `scoring.controller.ts` — `?fresh=true` requires `strategy_id` or `protocol`.
- `scoring.service.ts` — dead `findOrCreateDefaultStrategy()` removed; seasonal
  lookup now uses neutral 'unscoped' label.
- `backtest.service.ts` — run labels use 'unscoped' instead of 'default'.
- Frontend: ScoringDebugLab + CommandsReferencePage point at real protocols
  (mt5-technical-core-v1) instead of built-in-default.

## Database cleanup (already executed)
- Deleted 99 Score rows (strategyId='default'), 8+8 rows
  (built-in-default / default-short).
- Deleted 34,960 score_snapshot rows with protocolId in
  ('default','built-in-default','built-in-short').
- Deleted 11 scoring_strategy rows referencing built-in-default/built-in-short.
- Deleted Strategy rows id='default' and id='built-in-short'.
- Deleted 1 trading_strategy row ("Default EURUSD (Built-in)", inactive).
- Protocol table verified: 44 rows, zero default/built-in slugs.
- Seed data (`protocols-seed-data.ts`) never contained default entries.

## Verified live
- `POST /api/scoring/gated/batch` without protocol → 400 with clear message.
- `GET /api/signals/ladder?symbols=...` without protocol → empty ladder + message.
- `GET /api/signals/ladder?symbols=XAUUSD&protocol=xau-speed-v1` → BUY 179/245.
- NEE envelope → "Not included in any active protocol — no score produced".
- Registry endpoint lists no 'default' protocol.

## Notes for next time
- Any new scoring surface MUST pass a protocolId. There is deliberately no
  unscoped path left.
- If a symbol has no symbol_protocol_assignment row it will simply not be scored.
