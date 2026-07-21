---
date: 2026-07-17
area: infra
type: feature
---

## What Changed

Connected Architecture Framework page to the DB-backed API (#366). The backend (ArchitectureModule with 9 endpoints, 13 sections, 10 status entries) was already built in prior sessions. This session added the frontend API query and status indicator.

## Files Changed

- `src/pages/ArchitectureFrameworkPage.jsx` — added arch API query (GET /api/architecture/index), status chip showing "N sections" when online, "static" fallback, 30s auto-refresh

## Capability Map Entry

- **name:** Architecture Framework API Integration
- **persistence:** cached
- **uiSurfaces:** 1
- **pipeline:** none
- **completion:** complete

## QA Test Entry

- **area:** Infrastructure
- **name:** Architecture Framework shows live API status
- **procedure:** Navigate to /builder/architecture-framework. Check status bar for "Arch API: N sections" chip. Verify green tone when API online.
- **expected:** Arch API chip visible with section count. Green when API responds, grey "static" when offline.

## Architecture Framework Entry

- **section:** status
- **summary:** Architecture Framework DB-backed — GET /api/architecture/index returns 13 sections with entry counts. ArchitectureFrameworkPage queries this alongside existing provider/system/alerts queries. Status bar chip shows "Arch API: N sections" (green) or "static" (grey fallback). 30s auto-refresh. All static imports preserved as rendering fallback. Files: ArchitectureFrameworkPage.jsx, architecture-index.js, ArchitectureModule (nest/).
