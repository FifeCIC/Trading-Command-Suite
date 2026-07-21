# Global Diversification — Implementation Handoff

**Date:** 2026-07-16
**Feature:** Cross-broker global diversification with strategy allocation view

## What Was Built

### Problem
No cross-broker awareness existed — the app could open the same stock on MT5 AND Trading212 simultaneously, reducing diversification. There was no global view of strategy allocation across brokers.

### Solution
A full-stack global diversification system:

1. **GlobalSetting DB model** — key-value settings stored in `global_setting` table
2. **GlobalDiversificationService** — aggregates positions across ALL brokers, detects cross-broker duplicates, calculates global exposure, performs pre-trade checks
3. **REST API** at `/api/diversification/*` — summary, settings, pre-trade check
4. **Automation loop integration** — diversification check before every trade execution
5. **Global Allocator page** — `/allocator` showing all strategies grouped by broker, cross-broker duplicates, global exposure heatmap, mode selector
6. **Dashboard card** — diversification summary with duplicate warnings

## Files Changed

### Backend (NestJS)
| File | Change |
|------|--------|
| `nest/prisma/schema.prisma` | Added `GlobalSetting` model with `@@map("global_setting")` |
| `nest/src/modules/diversification/global-diversification.service.ts` | **NEW** — Core service: position aggregation, duplicate detection, exposure calc, pre-trade check, settings CRUD |
| `nest/src/modules/diversification/diversification.controller.ts` | **NEW** — REST controller (`diversification`, NOT `api/diversification` — app has `setGlobalPrefix('api')`) |
| `nest/src/modules/diversification/diversification.module.ts` | **NEW** — Module (imports DatabaseModule, exports GlobalDiversificationService) |
| `nest/src/app.module.ts` | Added `DiversificationModule` import and registration |
| `nest/src/modules/automation/automation-loop.service.ts` | Injected `GlobalDiversificationService`, added pre-trade diversification check before `placeOrder()` |
| `nest/src/modules/automation/automation.module.ts` | Added `DiversificationModule` to imports |

### Frontend (React/Vite)
| File | Change |
|------|--------|
| `src/pages/GlobalAllocatorPage.jsx` | **NEW** — Strategy allocation page with broker-grouped strategy tables, cross-broker duplicate detection, global exposure bars, diversification mode selector |
| `src/pages/global-allocator.css` | **NEW** — Styles for allocator page |
| `src/App.jsx` | Added `GlobalAllocatorPage` import and `/allocator` route |
| `src/pages/DashboardPage.jsx` | Added diversification query, new "🌐 Diversification" card with duplicate warnings, mode badge, link to allocator |
| `src/pages/HomeDashboard.css` | Added `dash-div-*` CSS for diversification card |
| `src/core/api/client.js` | Added `apiPut()` function (was missing, needed for settings updates) |

## Key Design Decisions

1. **`@Controller('diversification')` NOT `'api/diversification'`** — NestJS has `setGlobalPrefix('api')` in main.ts, so controller paths must omit the `api/` prefix
2. **DB-backed settings** — `global_setting` table uses simple key-value pairs. Defaults are hardcoded in the service as fallback
3. **Three diversification modes:**
   - `off` — No cross-broker checks (legacy behavior)
   - `warn` (default) — Allow trades but log warnings
   - `strict` — Block trades on cross-broker duplicates
4. **Pre-trade check in automation loop** — happens AFTER all other checks (cooldown, threshold, risk multiplier) but BEFORE `placeOrder()`
5. **apiPut added to client** — `src/core/api/client.js` was missing PUT method; added alongside existing GET/POST/PATCH/DELETE

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/diversification/summary` | Full diversification overview (positions, duplicates, exposures, settings, warnings) |
| GET | `/api/diversification/settings` | Current global settings |
| PUT | `/api/diversification/settings` | Update settings (body: `{ "key": "value" }`) |
| GET | `/api/diversification/check?symbol=X&brokerId=Y` | Pre-trade check for a symbol on a broker |

## Default Settings

```
diversification.mode=warn
diversification.maxCrossBrokerSymbols=0
diversification.maxGlobalExposurePct=25
diversification.maxSectorExposurePct=50
diversification.brokerAllocation.mt5=50
diversification.brokerAllocation.trading212=35
diversification.brokerAllocation.isa=15
```

## Testing

- Backend endpoint `/api/diversification/summary` returns JSON with 0 positions (no open positions currently)
- Settings CRUD works (PUT → GET verified)
- Pre-trade check returns `{ allowed: true, blocked: false, severity: "info" }` when no conflicts exist
- Vite build: 93 precache entries, 6187 KiB — passes clean

## Future Enhancements

- Add FX conversion for cross-currency global exposure (MT5=GBP, T212=USD, ISA=GBP)
- Add sector/industry exposure tracking (needs sector data per symbol)
- Per-strategy allocation % input fields on the allocator page
- "Max positions per symbol (global)" enforcement in automation loop
- Email/notification alerts when cross-broker duplicates are detected
- Historical diversification metrics (diversification score over time)
