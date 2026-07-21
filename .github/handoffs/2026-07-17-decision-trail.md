---
date: 2026-07-17
area: automation
type: feature
---

## What Changed

Created Decision Trail Browser (#351) at /automation/decision-trail — visualize the full scoring-to-execution pipeline with timeline view, completeness tracking, and filterable trail list. Backend depends on #350 (Decision-Trail storage) not yet deployed; page falls back gracefully.

## Files Changed

- `src/pages/DecisionTrailPage.jsx` (NEW) — pipeline completeness bar, trail list with expandable timeline, stage nodes, data panels, incompleteness warnings
- `src/pages/decision-trail.css` (NEW) — ~200 lines of styling including timeline track, stage dots, completeness nodes
- `src/core/nav-tree.js` — added decision-trail under Automation
- `src/core/view-routes.jsx` — added import + VIEW_COMPONENTS entry
- `src/App.jsx` — added DecisionTrailPage import

## Capability Map Entry

- **name:** Decision Trail Browser
- **persistence:** ephemeral
- **uiSurfaces:** 1
- **pipeline:** trading
- **completion:** partial

## QA Test Entry

- **area:** Automation
- **name:** Decision Trail Browser shows empty state when backend unavailable
- **procedure:** Navigate to /automation/decision-trail. Verify completeness bar and filter input render. Check empty state message.
- **expected:** Page renders without crash. Notice shows backend not deployed. Completeness bar with 6 stages visible.

## Architecture Framework Entry

- **section:** automation
- **summary:** Decision Trail Browser (/automation/decision-trail) — visualizes pipeline stages (Scoring→Comparison→Decision→Execution→SL Tracking→Close) with completeness bar, filterable trail list, expandable timeline with connected green/grey nodes. Depends on #350 Decision-Trail DB for live data. Queries /api/trails and /api/trails/incomplete. 30s auto-refresh. Files: DecisionTrailPage.jsx, decision-trail.css.
