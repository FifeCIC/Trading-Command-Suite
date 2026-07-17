---
date: 2026-07-16
area: ui
type: feature
---

## What Changed

Implemented notification disc UI (#378 Part 4) — floating bell icon with dropdown notification list. Parts 1-3 (circuit breaker, bridge events DB table, error suppression) are backend work, deferred.

## Files Changed

- `src/components/NotificationDisc.jsx` (NEW) — bell icon component with dropdown, severity colors, dismiss, aggregation from provider health + automation status APIs
- `src/components/notification-disc.css` (NEW) — fixed positioning, pulse animation, dropdown styling, severity left-border accents
- `src/App.jsx` — imported NotificationDisc, placed at BrowserRouter root level for all-page visibility

## Capability Map Entry

- **name:** Notification Disc
- **persistence:** ephemeral
- **uiSurfaces:** 1
- **pipeline:** none
- **completion:** partial

## QA Test Entry

- **area:** UI
- **name:** Notification bell shows provider issues and errors
- **procedure:** Open the app. Look for bell icon in top-right. Click to open dropdown. Verify notifications show for degraded providers, bridge offline, missing API keys. Dismiss individual notifications and "Clear all".
- **expected:** Bell visible on all pages. Badge shows unread count. Dropdown lists notifications with severity colors and action links. Dismiss works. Critical notifications pulse the bell.

## Architecture Framework Entry

- **section:** ui
- **summary:** NotificationDisc — floating bell (fixed top-right, z-index 200) aggregating notifications from /api/providers/health and /api/automation/status. Generates 4 notification types: provider degraded/down, automation errors, bridge offline, API key warnings. Each has severity (critical/warning/info/success) with colored dot + left-border accent. Dismiss via individual button or "Clear all". Unread count badge with red pulse animation for critical. Dropdown with backdrop click-to-close. Files: NotificationDisc.jsx, notification-disc.css, App.jsx.
