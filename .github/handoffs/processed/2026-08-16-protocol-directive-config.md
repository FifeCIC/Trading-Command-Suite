---
date: 2026-08-16
area: scoring
type: feature
---

## What Changed

Added per-protocol directive weight overrides. A protocol can now tune a directive's `maxScore` independently of the global default, with the value persisted to `global_setting` under the `protocol:{slug}:{directiveId}:{field}` key pattern and surfaced in the Protocols Registry detail panel.

## Files Changed

- nest/src/modules/scoring/directive-config.service.ts — `getProtocolOverrides()`, `updateProtocolConfig()`, `deleteProtocolConfig()` (protocol-scoped key pattern `protocol:{slug}:{directiveId}:{field}`)
- nest/src/modules/scoring/protocols.controller.ts — `GET/PATCH :slug/directive-config` + `DELETE :slug/directive-config/:directiveId`
- nest/src/modules/directives/directives.module.ts — exported `DirectiveConfigService` so the scoring module can inject it
- src/pages/ProtocolsPageB.jsx — "Directive Weights" section (list + source badge + inline editor + reset + total)
- src/pages/protocols-page-b.css — styles for the weight editor

## Capability Map Entry

- **name:** Per-protocol directive weight overrides
- **persistence:** stored (global_setting, `protocol:*` keys)
- **uiSurfaces:** 1 (Protocols Registry)
- **pipeline:** scoring
- **completion:** complete

## QA Test Entry

- **area:** Scoring / Protocols
- **name:** Protocol directive weight override round-trip
- **procedure:** GET `/api/scoring/protocols/xau-speed-v1/directive-config`, PATCH `speed-momentum` maxScore to 180, GET again, then DELETE the override and GET again.
- **expected:** After PATCH, speed-momentum shows `source:"override"` + effective 180 + total +60; after DELETE it returns to `source:"global"` + 120.

## Architecture Framework Entry

- **section:** directives
- **summary:** Per-protocol directive config — `protocol:{slug}:{directiveId}:{field}` keys in global_setting override the global `directive:{id}:{field}` default. Endpoints: GET/PATCH `/api/scoring/protocols/:slug/directive-config`, DELETE `/api/scoring/protocols/:slug/directive-config/:directiveId`. UI: Protocols Registry detail panel.
