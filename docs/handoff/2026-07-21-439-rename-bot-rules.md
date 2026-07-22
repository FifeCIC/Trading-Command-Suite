# Handoff — #439 Rename "Bot Rules" → "Automation Rules"

**Date:** 2026-07-21
**Agent:** DeepSeek V4 Pro
**Issue:** [#439](https://github.com/FifeCIC/Trading-Command-Suite/issues/439)

## What Changed

Renamed "Bot Rules" to "Automation Rules" in all functional references:

| File | Change |
|------|--------|
| `src/pages/AutomationRulesPage.jsx` | Page title `<h1>` |
| `src/core/nav-tree.js` | Sidebar nav label |
| `src/core/view-meta.js` | View meta label |
| `src/pages/plugin-tab-skeletons.js` | Plugin tab title |

Historical changelog references in `architecture-framework.data.js` and `.backup` files left unchanged (they reference the old name in issue #336 description context).

### Deferred
- Settings page mirror for Automation Rules (requires adding API-backed section to SettingsPage.jsx — larger feature)

### Build Verification
- Vite: `vite build` — 2906 modules, no errors
