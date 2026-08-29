---
date: 2026-08-27
area: automation
type: feature
---

## What Changed

META.Stack control plane (#615) — layer kill switches with a backend-enforced mandate hierarchy and visible UI:

- **Backend mandate** (automation-loop.service.ts): `LoopState` now carries `protocolsEnabled` (default true) and `tradingEnabled` (default false).
  - Protocols OFF → `tick()` returns before scoring (forced tick proven: `Tick #2 skipped — protocols layer disabled`, zero decisions).
  - Trading OFF → `dispatchTrade()` blocks before any safety chain (signals still produced).
  - `emergencyStop()` also switches the trading layer off.
- **Persistence**: layer flags stored in `global_setting` (`automation.protocolsEnabled`, `automation.tradingEnabled`) and restored on boot. Restart never silently re-enables trading — the only path to ON is an explicit `POST /api/automation/layer` call (or restoring a previously explicit enable).
- **Endpoints**: `POST /api/automation/layer { layer: 'protocols'|'trading', enabled }`; `GET /api/automation/status` now includes `layers`.
- **UI**: Settings → Automation → **META.Stack Control** (two On/Off rows); `/status/meta-stack-pipeline` gets a layer strip with live pills + toggle buttons.

## Adaptation

Issue #615 specified three toggles (Protocols / Scoring Strategies / Trading). The scoring-strategy layer was retired from the loop on 2026-08-27 (user decision — pipeline is now Protocol → Trading Strategy → Execution), so the control plane implements **two** layers. The retired layer has no loop behaviour to switch off.

## Files Changed

- `nest/src/modules/automation/automation-loop.service.ts` — layer state, `setLayer()`, `restoreLayerFlags()`, tick skip, dispatch gate, emergencyStop integration.
- `nest/src/modules/automation/automation.controller.ts` — `POST /api/automation/layer`; `layers` in status.
- `src/pages/SettingsPage.jsx` — META.Stack Control section.
- `src/pages/MetaStackPipelinePage.jsx` + `meta-stack-pipeline.css` — layer strip.

## Capability Map Entry

- **name:** META.Stack control plane (layer kill switches)
- **persistence:** stored
- **uiSurfaces:** 2 (Settings Automation, META.Stack Pipeline)
- **pipeline:** automation
- **completion:** complete

## QA Test Entry

- **area:** Automation
- **name:** Layer kill switches enforce the mandate and persist safely
- **procedure:** Toggle Trading OFF in Settings → run-now tick still scores, decisions BLOCKED with "Trading layer disabled". Toggle Protocols OFF → forced tick skips scoring. Restart backend → trading stays OFF, protocols restore from global_setting.
- **expected:** Mandate cascades; restart never silently re-enables trading.

## Architecture Framework Entry

- **section:** routes
- **summary:** New route `POST /api/automation/layer` (protocols/trading kill switches, persisted in global_setting). Status includes `layers`. LoopState gained protocolsEnabled/tradingEnabled with fail-safe defaults (protocols ON, trading OFF).
