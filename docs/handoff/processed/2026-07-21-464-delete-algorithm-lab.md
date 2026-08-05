# Handoff — #464 Delete Algorithm Lab, Salvage Pipeline Stages to SEES

**Date:** 2026-07-21
**Agent:** DeepSeek V4 Pro
**Issue:** [#464](https://github.com/FifeCIC/Trading-Command-Suite/issues/464)

## What Changed

### a) Algorithm Lab Deleted
Files removed:
- `src/pages/AlgorithmLabPage.jsx`
- `src/pages/AlgorithmLabPage.css`
- `nest/src/modules/scoring/algorithm-lab.controller.ts`

References cleaned from:
- `src/App.jsx` — import
- `src/core/view-routes.jsx` — import + VIEW_COMPONENTS entry
- `src/core/nav-tree.js` — nav entry (was last item in Development > views)
- `src/core/page-data-status.js` — status entry
- `src/index.css` — comment reference
- `src/pages/LabLandingPage.jsx` — lab card entry
- `nest/src/modules/scoring/scoring.module.ts` — import + controllers array

### b) Pipeline Stages Salvaged to SEES Landing Page
Added to `SeesStrategyLandingPage.jsx`:
- **Static Pipeline Stages diagram**: 5-step visual (Fetch Data → Score Directives → Rank Symbols → Filter Noise → Signal Out) with icons, labels, and descriptions
- **Concept Explainer**: collapsible "How the Algorithm Works" section explaining directives → strategy weights → SEES pipeline
- Both gated behind **Training Mode** (`experienceLevel === 'beginner'` from `tcs:preferences`). Expert/Experienced users see the original page without training content.
- New CSS in `sees-strategy-landing.css`: `.ssl-pipeline`, `.ssl-pipe-wrapper`, `.ssl-pipe-node`, `.ssl-pipe-arrow`, `.ssl-concept`, `.ssl-concept-toggle`, `.ssl-concept-body`

### c) Training Mode Toggle
Rather than adding a separate Training Mode checkbox, the existing `experienceLevel` preference is used:
- `beginner` → shows Pipeline Stages + Concept Explainer
- `experienced` / `expert` → hides training content

Users can change experience level in Settings or Screen Options → Global Preferences.

### Files Changed
- **Deleted**: AlgorithmLabPage.jsx, AlgorithmLabPage.css, algorithm-lab.controller.ts
- **Modified**: App.jsx, view-routes.jsx, nav-tree.js, page-data-status.js, index.css, LabLandingPage.jsx, scoring.module.ts
- **Enhanced**: SeesStrategyLandingPage.jsx + sees-strategy-landing.css

### Build Verification
- NestJS: `tsc -p tsconfig.build.json` — clean
- Vite: `vite build` — 2906 modules (down from 2908), no errors, CSS bundle 10KB smaller
