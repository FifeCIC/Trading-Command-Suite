---
date: 2026-09-06
area: scoring
type: feature
---

## What Changed

#718 — the Signals pre-trade gate is no longer a hardcoded 65. It now resolves per protocol: `signals.gate.<protocolId>` override in `global_setting` → the protocol's trading style (scalp 75 / speed 80 / day-trade 65 / swing 55 / position 45) → the 65 default. Missing-data group neutrality (empty groups and zero-directional groups excluded from subScores rather than scored 0) was already in place and is verified.

## Files Changed

- nest/src/modules/signals/signal-envelope.service.ts — `styleGateFallback()`, `loadGateOverrides()` (60s cache, raw SQL), `getGateThreshold()`; `enrichEnvelope` now async; `evaluatePreTrade` takes the resolved threshold; gate message reports the actual threshold

## Capability Map Entry

- **name:** Per-Protocol Signal Gate
- **persistence:** stored
- **uiSurfaces:** 0
- **pipeline:** scoring
- **completion:** complete

## QA Test Entry

- **area:** Scoring
- **name:** Per-protocol pre-trade gate override
- **procedure:** Insert `signals.gate.<protocolId>=<N>` in global_setting, GET /api/signals/best, observe the "Gated composite below …" blocker, then delete the row
- **expected:** Override wins over the style fallback and the 65 default; removing it restores the style/default value

## Architecture Framework Entry

- **section:** scoring
- **summary:** Per-Protocol Signal Gate — the Signals pre-trade gate resolves `signals.gate.<protocolId>` (global_setting) → trading style → 65 default. `SignalEnvelopeService.getGateThreshold()` caches overrides 60s; the blocker message reports the effective threshold. Enables the #725 smart adaptive gate to write per-protocol thresholds.
