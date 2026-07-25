---
date: 2026-07-25
area: infra
type: refactor
---

## What Changed

Dropped the `uplot` npm dependency (used only by dead `UPlotChart.jsx` component). Converted `mermaid` from a static import (~1MB in main bundle) to a dynamic `import()` in the DiagramsPage `useEffect` — code-split out of the main bundle. Also built `/api/ai/usage` and `/api/ai/usage/breakdown` endpoints with graceful zero-data fallback.

## Files Changed

- `package.json` — Removed `"uplot": "^1.6.32"` from dependencies
- `src/pages/DiagramsPage.jsx` — Replaced `import mermaid from 'mermaid'; mermaid.initialize(...)` (static, line 2-4) with `import('mermaid').then(({ default: mermaid }) => { mermaid.initialize(...); mermaid.render(...) })` inside the render `useEffect`
- `nest/src/modules/ai/ai-usage.service.ts` — NEW. Raw SQL queries against `ai_api_call` table with zero-data fallback
- `nest/src/modules/ai/ai-usage.controller.ts` — NEW. `GET /api/ai/usage?period=today|week|month`, `GET /api/ai/usage/breakdown`
- `nest/src/modules/ai/ai.module.ts` — Registered AiUsageController + AiUsageService
- DB: Created `ai_api_call` table (MySQL) via `nest/create_ai_usage.sql`

## Capability Map Entry

- **name:** AI Cost Tracking & Bundle Optimization
- **persistence:** stored
- **uiSurfaces:** 1
- **pipeline:** none
- **completion:** partial (AI usage endpoints active, tracking table ready — DeepSeekService not yet wired to logCall())

## QA Test Entry

- **area:** Infrastructure / Performance
- **name:** Verify mermaid lazy-loads and AI usage endpoints return
- **procedure:** (1) Open browser DevTools Network tab. Navigate to /lab/diagrams. Verify `mermaid` chunk loads on-demand (not in initial bundle). (2) `curl http://localhost:3201/api/ai/usage` returns `{"totalCost":0,"totalCalls":0,"totalTokens":0}`.
- **expected:** Mermaid chunk only loads when Diagrams page is visited. AI usage endpoints return clean JSON with zero values (no 404s).

## Architecture Framework Entry

- **section:** infra
- **summary:** Runtime dependencies: 11 (was 12). uplot dropped — lightweight-charts is the sole charting library. mermaid is dynamically imported — 1MB saved from main bundle. AI cost tracking endpoints active with `ai_api_call` MySQL table ready for DeepSeekService integration.
