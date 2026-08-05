# Handoff — #437 Protocols Page: Directive Tooltips with Real Data

**Date:** 2026-07-21
**Agent:** DeepSeek V4 Pro
**Issue:** [#437](https://github.com/FifeCIC/Trading-Command-Suite/issues/437)

## What Changed

### Backend: Enriched Directive Data
`GET /api/scoring/gated/protocols` now returns `name` and `description` for each directive (from `DirectivesService` registry), in addition to the existing `id` and `maxScore`. Previously only returned `id` and `maxScore`.

- Injected `DirectivesService` into `ProtocolGatingController`
- Directive objects now include: `{ id, name, description, maxScore }`

### Frontend: CSS Hover Popovers
Directive `<li>` items in the protocol detail panel now show:
- **Display name** instead of raw directive ID (falls back to ID if no name)
- **Hover popover** with: directive name, description text, max score
- `cursor: help` on items with descriptions
- Popover styled with accent border, dark panel background, matching app theme

### Files Changed
- `nest/src/modules/scoring/protocol-gating.controller.ts` — added DirectivesService, enriched directive objects
- `src/pages/ProtocolsPage.jsx` — show `d.name || d.id`, added popover markup
- `src/pages/ProtocolsPage.css` — added `.protocols-directive-popover` hover styles

### Build Verification
- NestJS: `tsc -p tsconfig.build.json` — clean
- Vite: `vite build` — 2907 modules, no errors
