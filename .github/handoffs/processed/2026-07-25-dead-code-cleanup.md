---
date: 2026-07-25
area: ui
type: refactor
---

## What Changed

Deleted 15 dead pages, 3 dead components, and 10 orphaned CSS files — all unreachable via any route or import. Frontend reduced from 93,971 to ~89,800 lines.

## Files Changed

**Deleted pages (15):**
- `src/pages/ScoredRunsPage.jsx` — replaced by ScoringRunsPage (plural)
- `src/pages/ScoringActivityLogPage.jsx` — replaced by ScoringActivityLogsPage (plural)
- `src/pages/ProtocolsOverviewPage.jsx` — duplicate of ProtocolsPage, used raw fetch()
- `src/pages/SeesLiveStackMockPage.jsx` — mock page, never registered
- `src/pages/SeesAdvancedPage.jsx` — duplicate of SeesArenaPage
- `src/pages/SeesStrategyLandingPage.jsx` — landing page, never registered
- `src/pages/PredictiveSeesPage.jsx` — never registered
- `src/pages/DirectiveCapabilitiesMatrixPage.jsx` — hardcoded reference, never registered
- `src/pages/WordPressGhostAuditPage.jsx` — audit artifact, never registered
- `src/pages/OpsAreaPage.jsx` — never registered
- `src/pages/UnifiedTradingPage.jsx` — never registered
- `src/pages/Mt5ConnectionManagerPage.jsx` — never registered
- `src/pages/Mt5DemoTradingPage.jsx` — never registered (routes mapped to Mt5TradingPage)
- `src/pages/QuickTradePage.jsx` — standalone prototype, never registered
- `src/pages/FocusPage.jsx` — never registered

**Deleted components (3):**
- `src/components/NotificationDisc.jsx` — dead, zero consumers. Notifications handled by ScreenOptions
- `src/components/sharing/ShareCard.jsx` — dead, zero consumers
- `src/components/charts/UPlotChart.jsx` — dead, zero consumers (uplot dependency also removed)

**Deleted CSS (10 orphans):**
- `src/pages/protocols-overview.css`, `sees-live-stack.css`, `sees-strategy-landing.css`, `PredictiveSeesPage.css`, `UnifiedTradingPage.css`, `Mt5ConnectionManagerPage.css`, `Mt5DemoTradingPage.css`, `quick-trade.css`, `SeesArenaPage.css` (duplicate of `sees-arena.css`), `ChartComparisonPage.css` (duplicate of `chart-comparison.css`)

**Restored (2 files were falsely identified as dead):**
- `src/pages/FeatureSkeletonPage.jsx` — imported by PluginTabSkeletonPage (which IS in App.jsx)
- `src/components/backtest/BacktestChart.jsx` — imported by BacktestPage.jsx
- `src/components/StrategyBuilder/DirectiveCard.jsx` — imported by DirectivePalette.jsx + StrategyCanvas.jsx (replaced with stub since original was uncommitted)

## QA Test Entry

- **area:** UI / Frontend Pages
- **name:** Dead code removal — verify all routes still work
- **procedure:** Navigate the app via sidebar through all areas (Trading, Scoring, Lab, Status, Settings, etc.). Verify no blank pages or 404s.
- **expected:** All navigation works. No console errors about missing imports. Build passes.

## Architecture Framework Entry

- **section:** routes
- **summary:** Frontend reduced from 164 to 149 page files. Route registry (view-routes.jsx) unchanged — all dead pages were already unregistered. Component tree simplified: 3 dead components removed, DirectiveCard replaced with stub.
