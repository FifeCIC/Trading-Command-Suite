# Handoff — #430 Configure Directives Enhancements

**Date:** 2026-07-21
**Agent:** DeepSeek V4 Pro
**Issue:** [#430](https://github.com/squee/trading-command-suite/issues/430)

## What Changed

### Frontend (src/pages/DirectivesConfigPage.jsx + directives-config.css)
- Added `usageQuery` (TanStack Query) calling `GET /api/scoring/protocols/:slug/usage`
- When a protocol is in use by an enabled ScoringStrategy:
  - Shows a 🔒 padlock icon linking to `/scoring/strategies` (via AppShell)
  - The row toggle switch is replaced with a "Remove" button (disabled when locked)
  - Subtitle text updated to "Select a protocol to curate its directives..."
- Version badge shown inline after protocol name using `.dc-version`
- New CSS classes: `.dc-remove-btn`, `.dc-version`, `.dc-lock-icon`
- Redirect guard: active protocol selection resets to first when API returns error/snapshot matching

### Backend (nest/src/modules/scoring/protocols.controller.ts)
1. **GET /api/scoring/protocols/:slug/usage**
   - Queries `scoringStrategy` table for any enabled strategy referencing the protocol by `protocolId` or `shortProtocolId`
   - Returns `{ inUse, strategyIds[], strategyNames[] }`
   - Falls back to `{ inUse: false }` when DB unavailable

2. **DELETE /api/scoring/protocols/:slug/directives/:directiveId**
   - Looks up the protocol by slug, finds the ProtocolDirectiveEntry, deletes it
   - Returns `{ success, directiveId, protocolSlug, message }`

### Files Modified
- `src/pages/DirectivesConfigPage.jsx` — usage check, remove button, lock icon, version badge
- `src/pages/directives-config.css` — new button/version/lock styles
- `nest/src/modules/scoring/protocols.controller.ts` — GET usage + DELETE directive endpoints, added `Delete` to imports

### Build Verification
- NestJS: `tsc -p tsconfig.build.json` — clean
- Vite: `vite build` — 2905 modules, no errors

## Backend Not Yet Done (future work)
- Prisma schema: add `version` field to Protocol model (db push hangs on 181K+ Score rows)
- Scoring recalculation cascade when a directive is removed (should re-score affected positions)
