# Handoff: Config Reload Policy (#509)

**Agent:** DeepSeek V4 Pro
**Date:** 2026-07-29
**Issue:** #509 — [Discuss] Define which config changes require app restart/reload

## Decision

**Two-tier policy adopted.** Hot-reload via `POST /api/system/reload-config` covers 80% of day-to-day config changes (~20ms). Full restart only needed for structural/compiled changes.

### Tier 1 — Hot Reload
| Change | Mechanism | Latency |
|--------|-----------|---------|
| Toggle directive active/inactive | `DirectivesService.loadDirectiveMetadata()` | ~20ms |
| Update directive weights/maxScore | Same | ~20ms |
| Change protocol status | `ProtocolDbService.preloadAll()` | ~20ms |
| Scoring strategy thresholds | DB-read on next tick | Immediate |
| Settings changes | DB-read per call | Immediate |
| Trading strategy config | DB-read per tick | Immediate |

### Tier 2 — Restart Required
| Change | Reason |
|--------|--------|
| New directive TypeScript class | Compiled code — must re-register in `DirectivesService.registry` |
| Protocol group restructure | New directive-to-group relationships need module init |
| New provider adapter | `AdapterFactory.registry` populated at module init |
| Calibration overrides | `CalibrationService.cache` loaded at startup, no reload method |
| Prisma schema changes | Migration + rebuild required |
| Environment variables | `.env` loaded at `ConfigModule.forRoot()` |

### Config surface audit

| Surface | Storage | Reloadable |
|---------|---------|------------|
| Directive metadata | In-memory Map | ✅ reload-config |
| Protocol cache | In-memory Map | ✅ reload-config |
| Scoring strategies | DB-read per tick | ✅ always fresh |
| Settings | DB-read per call | ✅ always fresh |
| Trading strategies | DB-read per tick | ✅ always fresh |
| Calibration overrides | In-memory Map | ❌ startup only |
| Adapter registrations | In-memory Map | ❌ startup only |
| Directive classes | Compiled TS | ❌ restart only |
| Prisma schema | Compiled | ❌ migration + restart |

## Files changed

| File | Change |
|------|--------|
| `nest/src/modules/system/config-reload.controller.ts` | Updated JSDoc header with full two-tier policy |

## Future work

- Add `CalibrationService.reload()` method to bring calibrations into Tier 1
- Add "Restart Required" badge to UI when Tier 2 changes are detected
- Consider file watcher for `.env` changes with auto-restart
