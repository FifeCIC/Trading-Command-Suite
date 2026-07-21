---
date: 2026-07-16
area: ui
type: feature
---

## What Changed

Keyboard navigation audit (#360) — added skip-to-main-content link and fixed keyboard traps on DevOverlay.

## Files Changed

- `src/App.jsx` — skip link at BrowserRouter root level (all pages), `id="main-content"` on main element, removed duplicate from AppShell
- `src/components/DevOverlay.jsx` — Escape key handler: dismisses inspect mode, then closes overlay
- `src/pages/DashboardPage.jsx` — changed root div to `<main id="main-content">` for skip link target
- `src/index.css` — `.skip-link` styles (hidden-until-focused, accent background, slide-down animation)

## Capability Map Entry

- **name:** Skip-to-Main-Content Link
- **persistence:** ephemeral
- **uiSurfaces:** 1
- **pipeline:** none
- **completion:** complete

## QA Test Entry

- **area:** Accessibility
- **name:** Skip link appears on Tab and navigates to main content
- **procedure:** Load any page. Press Tab. Verify "Skip to main content" appears at top. Press Enter. Verify focus moves to main content area and skip link hides.
- **expected:** Skip link visible on first Tab press. Enter moves focus to #main-content. Works on all pages including /dashboard and /:area/:view routes.

## Architecture Framework Entry

- **section:** ui
- **summary:** Skip-to-main-content link — rendered at BrowserRouter root in App.jsx, targets `#main-content` on AppShell `<main>` and DashboardPage `<main>`. CSS hidden-until-focused pattern: position absolute top -100%, slides to top 0 on :focus. DevOverlay Escape key exits inspect mode first, then closes overlay. ScreenOptions and help modals already Escape-safe. 30+ views use useKeyboardShortcuts hook. Files: App.jsx, DevOverlay.jsx, DashboardPage.jsx, index.css.
