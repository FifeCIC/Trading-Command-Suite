---
date: 2026-07-17
area: ui
type: feature
---

## What Changed

Created AI Log Viewer (#375) at /status/ai-logs — browse AI request/response logs with full prompt/response expansion, filter by provider and feature, cost summaries. Backend API not yet deployed; page falls back gracefully.

## Files Changed

- `src/pages/AILogViewerPage.jsx` (NEW) — log list with expandable rows, provider/feature filters, cost summary cards, prompt/response detail view
- `src/pages/ai-log-viewer.css` (NEW) — ~180 lines of styling
- `src/core/nav-tree.js` — added ai-logs entry under Status
- `src/core/view-routes.jsx` — added import + VIEW_COMPONENTS entry
- `src/App.jsx` — added AILogViewerPage import

## Capability Map Entry

- **name:** AI Log Viewer
- **persistence:** ephemeral
- **uiSurfaces:** 1
- **pipeline:** none
- **completion:** partial

## QA Test Entry

- **area:** AI
- **name:** AI Log Viewer shows empty state when backend unavailable
- **procedure:** Navigate to /status/ai-logs. Change provider and feature filters. Click Refresh. Verify empty state message.
- **expected:** Summary cards show zeros. Empty state with helpful message. Filters interactive. No crashes.

## Architecture Framework Entry

- **section:** ai
- **summary:** AI Log Viewer (/status/ai-logs) — queries /api/ai/logs with provider (deepseek/gemini) and feature filters. Expandable log rows show full prompt/response in styled code blocks. Cost summary cards show total requests, tokens, cost, avg latency. Log rows display provider badge, feature, model, tokens, estimated cost, status, timestamp. 30s auto-refresh. Files: AILogViewerPage.jsx, ai-log-viewer.css.
