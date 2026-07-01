Task ID: Q235
Goal: Multi-Screen Dashboard Prototype (Phase A)

See: github-issues/MULTI-SCREEN-DASHBOARD.md

What to build:

1. Dashboard Page (src/pages/MultiScreenDashboardPage.jsx + .css)
   - Route: /dashboard/multi-screen
   - 3-zone CSS Grid layout:
     - Left: 30% width — "🔒 Fixed Zone"
     - Center: 40% width — "🤖 AI Managed Zone"  
     - Right: 30% width — "🔔 Conditional Zone"
   - Responsive: on narrow screens, zones stack vertically in priority order

2. Fixed Zone Widgets (always visible):
   - Portfolio Summary Card: balance, equity, P&L, open positions
   - SEES Mini Stack: top 5 scoring symbols, compact view
   - Alert Stream: most recent 5 alerts/notifications

3. Dynamic Zone Widgets (AI context rules):
   - Earnings Watch: shows chart for each held/watchlisted symbol with earnings in 7 days
     - Rule: if no earnings within 7 days → widget minimizes to a thin bar "No earnings this week"
   - Position Charts: mini chart for each open position
     - Rule: if zero open positions → widget hides completely
   - News Feed: filtered to held symbols + watchlist

4. Conditional Zone Widgets:
   - Speed Trading Panel: visible when speed trading mode active, hidden otherwise
   - Correlation Warning: appears when 2+ positions have correlation > 0.7
     - Rule: if correlation drops below 0.7 → auto-dismisses

5. Widget Contract System:
   - Define DashboardWidget interface
   - Widget registry for adding new widgets
   - Each widget declares: id, title, defaultZone, visibilityRule, priority

6. Zone Labels:
   - Each zone header shows behavior type and explanation
   - "🔒 Fixed — These widgets stay where you put them"
   - "🤖 AI Managed — Widgets appear based on context rules"
   - "🔔 Conditional — Widgets triggered by events"

Validation:
- Page loads with all 3 zones visible
- Widget in dynamic zone hides when condition not met
- On narrow viewport, zones stack
- npm --prefix c:/wamp64/www/trading-command-suite run build

Priority: P1 — prototype for validation
Estimated: 4h
