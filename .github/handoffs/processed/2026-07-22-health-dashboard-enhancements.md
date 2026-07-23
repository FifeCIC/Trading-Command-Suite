# Handoff: Health Dashboard Enhancements + Commands Reference

**Date:** 2026-07-22
**Files created/changed:**
- `nest/src/modules/system/system-health.service.ts` — 10 diagnostic methods
- `nest/src/modules/system/system-health.controller.ts` — health-dashboard + health-summary
- `nest/src/modules/system/settings.service.ts` — HealthChecksConfig
- `nest/src/modules/system/settings.controller.ts` — health-checks endpoints
- `src/pages/HealthDashboardPage.jsx` + `health-dashboard.css`
- `src/pages/CommandsReferencePage.jsx` + `commands-reference.css`
- `src/pages/SettingsPage.jsx` — Health & Diagnostics toggle section
- `scripts/health-check.ps1` — agent CLI health check
- `src/core/view-routes.jsx`, `nav-tree.js`, `view-meta.js` — registrations

## Health dashboard (`/status/health-check`)
6 sections: System Vitals, Provider Health Grid, API Trends bar chart, DB Tables vs Retention, Slow Queries, Trace Correlations. Auto-refresh 15s. All data from `GET /api/system/health-dashboard`.

## Health settings toggles
10 check toggles in Settings → 🩺 Health & Diagnostics. Backed by `HealthChecksConfig` in AppSettings. Dashboard respects disabled checks — excluded sections are never computed.

## Agent tooling
- `pwsh scripts/health-check.ps1` — 1-command system snapshot
- `GET /api/system/health-summary` — ~300 char text blob for LLM context
- `GET /api/system/settings/health-checks` — toggle state

## Commands Reference (`/status/commands`)
27 CLI commands across 6 categories (services, health, build, db, debug, trading). Click-to-copy with filter tabs.

## New diagnostics beyond Phase 1
Disk space, error rates, cron heartbeats, port status checks.
