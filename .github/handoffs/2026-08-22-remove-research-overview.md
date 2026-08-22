---
date: 2026-08-22
area: research
type: change
---

# Removed Research Overview page (/research/research-overview)

## What Changed

- Deleted `src/pages/ResearchOverviewPage.jsx` and `research-overview.css`
  (placeholder aggregate page).
- Removed all registrations: nav-tree view entry, view-routes mapping +
  import, experience-levels entry, page-data-status entry,
  plugin-tab-skeletons entry, and the unused App.jsx import.
- Research area now leads with Symbols Browser.

## What Was Kept

- Backend `nest/src/modules/research/` (controller + module +
  `research-overview.service.ts`) and the `GET /api/research/overview`
  endpoint are INTENTIONALLY untouched — candidates for reuse during the
  news-foundation review of the Research area.

## Next (per user direction)

- Review Research area to drive data-import + news foundations for
  research, scoring, gating, and position monitoring (high-impact news →
  position re-evaluation). News features will be built up gradually on
  that foundation (#648 → #629 → Signals Overview build-out).
