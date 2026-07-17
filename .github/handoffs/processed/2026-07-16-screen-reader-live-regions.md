---
date: 2026-07-16
area: ui
type: feature
---

## What Changed

Added `aria-live` regions for screen reader announcements of real-time data updates (#361):
- **MarketTape** — `aria-live="polite"` on ticker container
- **DashboardPage** — `aria-live="polite"` on dashboard (balance/equity/positions)
- **PositionsMonitorPage** — `aria-live="polite"` on positions data
- **SpeedScannerPage** — `aria-live="polite"` on scanner results
- **HomeDashboardPage** — `aria-live="polite"` on navigation dashboard
- **App.jsx** — global `aria-live="assertive" role="alert"` div for critical notifications
- **index.css** — `.sr-only-alert` visually-hidden class

## Files Changed

- `src/components/MarketTape.jsx` — added aria-live="polite" aria-atomic="true"
- `src/pages/DashboardPage.jsx` — added aria-live="polite" aria-atomic="true"
- `src/pages/PositionsMonitorPage.jsx` — added aria-live="polite" aria-atomic="true"
- `src/pages/SpeedScannerPage.jsx` — added aria-live="polite" aria-atomic="true"
- `src/pages/HomeDashboardPage.jsx` — added aria-live="polite" aria-atomic="true"
- `src/App.jsx` — added assertive alert region in main stage
- `src/index.css` — added .sr-only-alert class

## Capability Map Entry

- **name:** Screen Reader Live Regions
- **persistence:** ephemeral
- **uiSurfaces:** 5
- **pipeline:** none
- **completion:** complete

## QA Test Entry

- **area:** Accessibility
- **name:** Screen reader announces real-time data changes
- **procedure:** Enable a screen reader (NVDA/VoiceOver). Navigate to /dashboard, /trading/positions-monitor, /lab/speed-scanner. Wait for auto-refresh cycles. Verify that updated content (balances, positions, scan results) is announced.
- **expected:** Screen reader announces content changes politely without flooding. Critical alerts use assertive priority. Market tape ticker changes are announced.

## Architecture Framework Entry

- **section:** ui
- **summary:** Screen Reader Live Regions — `aria-live="polite"` on 5 real-time components (MarketTape, Dashboard, PositionsMonitor, SpeedScanner, HomeDashboard) with `aria-atomic="true"` for full-content announcements. Global `aria-live="assertive" role="alert"` div in App.jsx main stage for critical notifications, visually hidden via `.sr-only-alert` CSS class. All regions debounced naturally by React's 30s refetch intervals. Files: MarketTape.jsx, DashboardPage.jsx, PositionsMonitorPage.jsx, SpeedScannerPage.jsx, HomeDashboardPage.jsx, App.jsx, index.css.
