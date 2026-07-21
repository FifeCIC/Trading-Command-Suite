---
date: 2026-07-16
area: ui
type: feature
---

## What Changed

Implemented Parts A + C of #367 — Dashboard news sentiment status indicator and protocol type badges. Parts B (auto-deactivation), D (news consumption exploration), and E (agentic AI) deferred.

## Files Changed

- `src/pages/DashboardPage.jsx` — added providers query, News & Sentiment card with Finnhub/FMP status dots and summary
- `src/pages/HomeDashboard.css` — added `.dash-news-list`, `.dash-news-row`, `.dash-news-dot`, `.dash-news-name`, `.dash-news-status`, `.dash-news-summary`
- `src/pages/ProtocolsPage.jsx` — added `getProtocolType()` classifier (5 categories), type badge in detail header, mini badge in sidebar list items
- `src/pages/ProtocolsPage.css` — added `.protocols-type-badge` and `.protocols-type-mini` styles

## Capability Map Entry

- **name:** News Sentiment Status + Protocol Type Badges
- **persistence:** ephemeral
- **uiSurfaces:** 2
- **pipeline:** scoring
- **completion:** partial

## QA Test Entry

- **area:** Dashboard
- **name:** News & Sentiment card shows provider status
- **procedure:** Navigate to /dashboard. Check right sidebar for "📰 News & Sentiment" card. Verify Finnhub/FMP status shown with colored dots. Navigate to /scoring/protocols, select a protocol, verify type badge shown (e.g. "📈 Technical-Only").
- **expected:** News card visible with provider status. All protocols tagged with type classifier. Badge colors match category.

## Architecture Framework Entry

- **section:** ui
- **summary:** Dashboard News & Sentiment card — queries /api/providers/health, filters for Finnhub/FMP, displays status dots (green=healthy, amber=degraded/unknown, red=down) with summary line. Protocol Type Badges — getProtocolType() classifier maps protocol ID/name to 5 categories (News-Reactive, Analyst-Driven, Insider-Aware, Macro-Driven, Technical-Only). Shown on ProtocolsPage sidebar and detail header. Files: DashboardPage.jsx, ProtocolsPage.jsx.
