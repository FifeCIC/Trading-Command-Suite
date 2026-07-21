---
date: 2026-07-16
area: ui
type: feature
---

## What Changed

Created Daily Briefing page (#368 Parts A+B) — morning/evening trading briefings with priority-tiered symbol triage. Parts C (AI drill-down) and D (submission flow) deferred.

## Files Changed

- `src/pages/DailyBriefingPage.jsx` (NEW) — full page component with morning/evening modes, portfolio snapshot, calendar events, overnight movers, P&L table, priority-tiered symbol briefs with expandable cards
- `src/pages/daily-briefing.css` (NEW) — ~300 lines of styling
- `src/core/nav-tree.js` — added daily-briefing entry under Lab
- `src/core/view-routes.jsx` — added import + VIEW_COMPONENTS entry
- `src/App.jsx` — added DailyBriefingPage import

## Capability Map Entry

- **name:** Daily Briefing
- **persistence:** ephemeral
- **uiSurfaces:** 1
- **pipeline:** scoring
- **completion:** partial

## QA Test Entry

- **area:** Scoring
- **name:** Daily Briefing page renders morning/evening views with tiered symbols
- **procedure:** Navigate to /lab/daily-briefing. Toggle between Morning and Evening modes. Click tier filter chips. Expand a symbol card. Click Refresh now.
- **expected:** Morning shows calendar + overnight gainers/losers. Evening shows P&L table + tomorrow preview. Tier chips filter correctly. Cards expand with Research/Watch/Alert actions.

## Architecture Framework Entry

- **section:** ui
- **summary:** Daily Briefing page (/lab/daily-briefing) — morning/evening session briefings consuming 5 APIs (timeline, MT5 diagnostics, MT5 positions, scoring/ranked, watchlists). Morning: calendar events, overnight gainers/losers. Evening: P&L positions table, tomorrow preview. Priority triage: invested > watchlist > other, with filter chips and tier-colored badges. Expandable symbol cards with quick actions. 60s auto-refresh. Files: DailyBriefingPage.jsx, daily-briefing.css.
