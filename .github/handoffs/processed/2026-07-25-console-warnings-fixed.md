---
date: 2026-07-25
area: ui
type: bugfix
---

## What Changed

Fixed 10+ React console warnings across 8 files. Warnings addressed: duplicate keys, uncontrolled→controlled inputs, invalid DOM properties, nested DOM elements, missing key props.

## Files Changed

**Duplicate keys:**
- `src/pages/ProtocolsPage.jsx` — Added deduplication by `id` when building protocols array (API returned duplicate protocol IDs from code+database sources)
- `src/pages/CreateStrategyPage.jsx` — Same deduplication fix for protocols loaded from API
- `src/data/qa-checklist.js` — Renamed 19 duplicate QA item IDs (qa-data-001→qa-dt-001, qa-ui-005→qa-ui-005-v2, etc.). All 141 IDs now unique.
- `src/pages/DecisionTrailPage.jsx` — Fixed key: `trail.ticket || trail.timestamp` → `trail.id || `${trail.ticket || trail.timestamp}-${i}`` (multiple trails share same tick timestamp)
- `nest/src/modules/scoring/protocol-gating.controller.ts` — Root cause fix: DB strategies now merge into existing code-registry entries instead of being pushed as duplicates. API verified: 44 unique protocols, 0 duplicates.

**Uncontrolled→controlled inputs:**
- `src/pages/DirectivesManagerPage.jsx` — Loading-state search input added `value="" readOnly` to be controlled from initial render

**Invalid DOM properties:**
- `src/pages/MetaStackExplorerPage.jsx` — `popoverTarget` → `popovertarget` (React requires lowercase for non-standard DOM attributes)
- `src/pages/ThemeLabPopover.jsx` — Same fix × 3 instances
- `src/pages/PipelineGraphLabPage.jsx` — `stroke-dasharray` → `strokeDasharray` (SVG attributes must be camelCase in React)

**Nested DOM elements:**
- `src/pages/ScoringActivityLogsPage.jsx` — Removed outer `<tbody>` wrapper around `<AnimatePresence>` so `<motion.tbody>` elements are direct children of `<table>`

**Missing key props:**
- `src/pages/SystemStatusPage.jsx` — Added index fallback (`|| i`) to `<li>` key props (`pr.provider`, `a.accountNumber`) which could be undefined at runtime

**Crash fix:**
- `src/pages/DailySummaryReportPage.jsx` — Added `Array.isArray()` guard for `deals` (API could return non-array data, causing `deals.filter is not a function` crash)

## QA Test Entry

- **area:** UI / Console
- **name:** Verify zero React warnings in console
- **procedure:** Navigate through each fixed page (Protocols, Create Strategy, QA Testing, Decision Trail, Directives Manager, System Status, Daily Summary). Check browser console for warnings.
- **expected:** No React warnings in console for any of the fixed pages.

## Architecture Framework Entry

- **section:** ui
- **summary:** Console warning cleanup: 10+ React warnings fixed across 8 files. Protocol deduplication fixed at both frontend (defensive .filter by id) and backend (protocol-gating.controller.ts merges DB entries into code-registry). No more duplicate key, invalid DOM property, or uncontrolled input warnings.
