# Handoff: Signals Workbench Refactor (#412)

**Agent:** DeepSeek V4 Pro (primary)
**Date:** 2026-07-22
**Issue:** #412 — [Feature] Signals Workbench refactor — multi-protocol comparison + DB-backed symbol validation

## What was done

Refactored the Signals Workbench page (`/scoring/signals-workbench`) with two major changes:

### 1. Multi-protocol comparison
- Backend: `POST /api/signals/ladder` now accepts `protocols: string[]` for side-by-side protocol comparison
- New `MultiProtocolLadder` interface with comparison matrix (symbols × protocols)
- `buildComparisonLadder()` method in `SignalEnvelopeService`
- Frontend: `ProtocolChecklist` component replaces single `ProtocolPicker` dropdown
- New "Compare" tab view with side-by-side composite/signal per protocol
- Protocol checklist positioned below results per issue spec

### 2. DB-backed symbol validation
- `SymbolAutocomplete` component with `GET /api/symbols?search=...` 
- Resolves DB `symbolId` for each ticker (FK-ready for future features)
- Comma-separated multi-ticker entry preserved

### DTO fix
- Created `SignalLadderDto` with class-validator decorators
- This was critical — `LoggingValidationPipe` with `whitelist:true` was silently stripping `protocols[]` from plain type annotations

## Files changed

| New | Modified |
|-----|----------|
| `src/components/SymbolAutocomplete.jsx` | `src/pages/SignalsWorkbenchPage.jsx` |
| `src/components/symbol-autocomplete.css` | `src/pages/signals-workbench.css` |
| `src/components/ProtocolChecklist.jsx` | `nest/src/modules/signals/signals.controller.ts` |
| `src/components/protocol-checklist.css` | `nest/src/modules/signals/signal-envelope.service.ts` |
| `nest/src/modules/signals/dto/signal-ladder.dto.ts` | |

## Testing
- Backend: `POST /api/signals/ladder` with `{"symbols":["EURUSD","GBPUSD"],"protocols":["default","btc-speed-v1"]}` returns `{protocols:[...], comparison:[...]}`
- Frontend: SymbolAutocomplete dropdown works, ProtocolChecklist loads 47 protocols, Comparison tab renders
- Both builds pass

## Known limitations
- Single-protocol mode still uses original `SignalLadder` format (backward compat)
- Multi-protocol mode runs sequentially (not parallel) — acceptable for 2-3 protocols
