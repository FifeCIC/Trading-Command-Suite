# RUI010 — Research Overview (Signal Dashboard)

**Agent:** react-ui-agent
**Area:** Research
**Priority:** P3 — landing page, nice-to-have
**Depends on:** Scoring API, Market data, News API

## Current State
`research-overview` renders static content with no real data.

## Task

Transform into a signal-centric dashboard:

### Dashboard Widgets
- **Top Signals Right Now** — 5 highest-scoring symbols across all protocols, updating every 30s
- **Signal Changes** — symbols that changed signal status in the last hour (watch→entry, entry→exit)
- **Unusual Activity** — symbols with >2σ score deviation from 7-day average
- **Upcoming Events** — next 3 earnings/macro events affecting scored symbols
- **Protocol Health** — mini sparklines showing each protocol's average score over time
- **Market Regime** — current VIX level, sector breadth, correlation matrix thumbnail

### UI Guidance

**Layout:** Dashboard grid — 3 columns on desktop, 2 on tablet, 1 on mobile

**Visual styling:**
- Widget cards: glass-morphism panels with `backdrop-filter: blur(8px)` + subtle border
- Top signals: large score numbers animate in with `motion` spring (count-up effect)
- Signal changes: color-coded rows — green for new entries, red for new exits, amber for watch changes
- Protocol sparklines: tiny SVG paths that draw on mount with `motion` pathLength animation
- Clock showing "Last updated: Xs ago" with countdown

**Transitions:**
- Cards enter with staggered `motion` fade+slide (pattern from Theme Lab Motion)
- Data refresh: numbers crossfade rather than jump (View Transitions API or simple opacity)
- Click a widget: it expands into a detail panel with `AnimatePresence`
- Card order: drag to reorder (optional — nice-to-have)

**Responsive:** Uses Container Queries (now ✅ Accepted) for widget internal layout at different card sizes.
