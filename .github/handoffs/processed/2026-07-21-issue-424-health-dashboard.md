# Handoff: Health & Diagnostics Dashboard (#424) + Enhancements

**Date:** 2026-07-21
**Issue:** [#424](https://github.com/FifeCIC/Trading-Command-Suite/issues/424)
**Files changed:**
- `nest/src/modules/system/system-health.service.ts` — 10 diagnostic methods (6 original + 4 new)
- `nest/src/modules/system/system-health.controller.ts` — health-dashboard + health-summary endpoints
- `src/pages/HealthDashboardPage.jsx` — dashboard page
- `src/pages/health-dashboard.css` — dashboard styles
- `src/pages/CommandsReferencePage.jsx` — CLI commands cheatsheet page
- `src/pages/commands-reference.css` — commands page styles
- `scripts/health-check.ps1` — agent CLI health check script
- `src/core/view-routes.jsx` — registered health-check + commands views
- `src/core/view-meta.js` — registered /status/health-check + /status/commands meta
- `src/core/nav-tree.js` — added nav entries under Status section

## What changed

### Backend — extended existing SystemHealthService (not a new class)

Added 6 diagnostic methods to the existing `SystemHealthService`:

1. **`getSystemVitals()`** — CPU load (1m/5m/15m), cores, model; memory total/used/free/%; uptime hours; Node.js version; platform; PID; heap used/total. Uses built-in `os` module — no dependencies.

2. **`getDbDiagnostics()`** — Queries `information_schema.TABLES` for all tables in the current DB. Cross-references with `RETENTION_DAYS` config (mirrored from DataRetentionService's TABLE_CONFIG). For tables with retention, queries MIN/MAX date to compute actual age vs target. Status: ok ✅ / warn ⚠️ (at limit) / critical 🔴 (1.5x over limit). Also flags tables with >1M rows.

3. **`getSlowQueries()`** — Queries `api_activity_log` for entries where `durationMs > 1000`, ordered by recency. Returns endpoint, method, duration, status code, timestamp.

4. **`getApiTrends()`** — Aggregates `AVG(durationMs)` per hour from `api_activity_log` over the last 24h. Returns hour label, avg ms, estimated p95, count.

5. **`getProviderGrid()`** — Queries `provider_health` table. Returns provider name, status, latency, message, credentialsOk, checkedAt.

6. **`getTraceCorrelations()`** — Queries `api_trace` table for cacheKey, url, method, statusCode, durationMs, cached flag, createdAt.

### Controller — extended existing SystemHealthController

New endpoint: `GET /api/system/health-dashboard`

Runs all 6 diagnostics in parallel via `Promise.all()`, returns unified payload with `fetchedAt` timestamp.

### Frontend — `/status/health-check`

Six collapsible sections:

1. **System Vitals** — 5-card grid: CPU Load, Memory, Uptime, Heap, Platform. Color-coded thresholds (green/yellow/red for CPU and memory).

2. **Provider Health Grid** — Horizontal chip layout per provider. Shows status icon (🟢/🟡/🔴), name, latency, credentials warning (🔑), time since last check.

3. **API Response Times (24h)** — Horizontal bar chart. Each bar shows hour label, proportional bar width, avg ms (color-coded: green <500ms, yellow <2s, red >2s), request count.

4. **Database Tables vs Retention** — Sortable table (sorted by data size descending). Columns: table name, row count, data size, retention days, status hint. Row background: warn (yellow tint) / critical (red tint).

5. **Slow Queries (>1s)** — Table with endpoint (truncated to last 60 chars), HTTP method badge (color-coded), duration (red >3s, yellow), status code, relative time.

6. **Trace Correlations** — Table with cache key (first 12 chars, monospace), URL tail (last 50 chars), method badge, duration, cached (♻️/🆕), relative time.

Auto-refresh: 15s. All sections gracefully handle empty/missing data.

## Design decisions

- **Extended existing classes** rather than creating a new HealthDiagnosticsService. The `SystemHealthService` already had `runAllChecks()` for the basic `/api/system/health-check` — diagnostics are a natural extension of the same responsibility.
- **All try/catch guarded** — each diagnostic method returns `[]` on failure instead of throwing. The dashboard degrades gracefully even if some tables don't exist.
- **No new dependencies** — CPU/memory comes from Node.js `os` module. All data from existing Prisma models.
- **Parallel Promise.all** in controller — 6 queries run concurrently for fast response.

## For developers and agents diagnosing issues

- Open `/status/health-check` to see at a glance: is the system healthy?
- CPU/Memory cards show real-time load — if memory >85%, the heap may be leaking
- DB table table shows which tables exceed retention — if a table shows 🔴 critical, the daily 3am prune cron may have failed
- Slow queries table shows which endpoints are slow — use this to identify N+1 queries or missing indexes
- Provider health grid shows which data sources are degraded — if MT5/finnhub show 🔴, scoring data will be stale
- API trends bar chart shows response time patterns — spikes at specific hours may indicate cron job overlap
- Trace correlations table links cache keys to URLs — useful for debugging caching issues

## Verification

- NestJS tsc: clean
- Vite: 2911 modules, clean
- Services restarted: all online
