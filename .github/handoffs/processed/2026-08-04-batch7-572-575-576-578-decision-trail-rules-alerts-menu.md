# Batch 7: Issues #572, #575, #576, #578 — Decision Trail, Automation Rules, Alert Center, Menu

**Date:** 2026-08-04  
**Agent:** Copilot (DeepSeek V4 Pro)  
**Build:** ✅ Frontend (2953 modules) clean

**Skipped** (discussion label): #573 Speed Scanner, #574 Execution Queue, #577 Meta: Audit 8 market areas

---

## #572 — Decision Trail: Theme Sync + Accordion + Completeness Bar

### Changes
- **`src/pages/decision-trail.css`**: Replaced hardcoded `#1a1d2e`, `#2d3040`, `#f1f5f9`, `#64748b`, `#e2e8f0`, `#475569`, `#111318` with theme vars `--panel`, `--line`, `--ink`, `--ink-soft`, `--bg`. Cards, filters, inputs, summary, timeline, and empty state now all use theme variables.
- **`src/pages/DecisionTrailPage.jsx`**: 
  - Removed duplicate values from accordion expanded detail (Decision, Composite, Signal, Reason, Ticket already shown in summary). Expanded now shows only additional fields: Price, Qty, Strategy, Broker, Watchlist, Protocol. Shows "No additional data available" when pipeline stages aren't populated.
  - Completeness bar: Added `anyData` flag to stats computation. Bar only renders when `stats.anyData` is true (stage data actually exists in trails). This hides the all-0% bar until the META.Stack pipeline populates stage tracking.

### Reason
Decision trail cards were dark-themed even in light mode. Accordion showed redundant values. Completeness bar always showed 0% because trails don't yet have `stages` populated — now hidden until data pipeline is ready.

---

## #575 — Automation Rules: SEES Score Label + Threshold Slider

### Changes
- **`src/pages/AutomationRulesPage.jsx`**:
  - Renamed rule `min-sees-score` label from "Minimum SEES Score" → "Minimum SEES Aggregate Score (%)".
  - Changed `config.unit` from `'score (0-100)'` → `'%'`.
  - Added `<input type="range" min="0" max="100">` slider to the min-sees-score rule row when enabled, with `accentColor: 'var(--accent)'`. Slider updates threshold value in state immediately.

### Reason
User wanted clarity for "dummies" — the % symbol makes it obvious this is a percentage. The slider allows adjusting the threshold without editing code.

---

## #576 — Alert Center: Full Rewrite (Theme, Dedup, Severity, Limits)

### Changes
- **`src/pages/AlertCenterPage.jsx`**: Complete rewrite.
  - **Theme**: Extracted all inline styles into new `alert-center.css`. Cards use `--panel`/`--line`/`--ink`/`--ink-soft` theme vars.
  - **Deduplication**: Added `dedupeAlerts()` function that merges consecutive identical alerts (same type + title + detail) into one row with a `×N` count badge. Clicking the badge expands a timestamp list accordion.
  - **Severity/priority**: Added `SEVERITY_LEVELS` map (drawdown=high, system/trading=medium, signal/daily/backtest=low). Cards get `ac-sev-high/medium/low` class with color-coded left border (red/orange/gray). Severity dot shown beside type label.
  - **R3NK filter**: Added `showR3NK` toggle checkbox. When off, alerts whose title contains "r3nk" are filtered out.
  - **Alert limit**: Max 200 alerts displayed. Banner shown when raw count exceeds limit.
  - **Type counts**: Tab buttons now show count badges (e.g., "SIGNAL 42").
  - **New types**: Added `trading` to TYPE_COLORS and filter tabs.
  - Added `PageInfoPopover` with description.
- **`src/pages/alert-center.css`**: NEW — full stylesheet with theme-synced colors, severity borders, duplicate badge, accordion list, limit banner, R3NK toggle, tab counts.

### Reason
Alert Center was the most broken view — hardcoded dark colors, no dedup, 1922 alerts, no severity, no theme sync. Now it's a proper notification center with filtering, grouping, and theme support.

---

## #578 — Menu Re-arrangement: Split Scoring into Protocols + Scoring Strategies

### Changes
- **`src/core/nav-tree.js`**: Split the `scoring` area into two:
  - **`scoring` (label: "Protocols")**: directives-manager, directive-impact-audit, directive-audit, directive-detail, configure-directives, protocols, create-protocols, sees-arena
  - **`scoringStrategies` (label: "Scoring Strategies")**: live-ordering-stack, signals-workbench, exit-signals, strategy-ladders, scoring-activity-logs, strategy-builder

### Reason
User wanted "Protocols" and "Scoring Strategies" as separate primary menu areas. Directive-related views live under Protocols. SEES Arena stays in Protocols (user will revisit after sprint). Scoring strategy views (ladder, workbench, etc.) are now clearly separated.

---

## Files Changed
| File | Change |
|------|--------|
| `src/core/nav-tree.js` | Split scoring into Protocols + Scoring Strategies |
| `src/pages/AlertCenterPage.jsx` | Full rewrite — theme, dedup, severity, R3NK filter, limits |
| `src/pages/alert-center.css` | NEW — theme-synced alert center styles |
| `src/pages/DecisionTrailPage.jsx` | Removed duplicate accordion values, hide 0% completeness bar |
| `src/pages/decision-trail.css` | Theme-synced all hardcoded colors → CSS vars |
| `src/pages/AutomationRulesPage.jsx` | Renamed SEES label + % + threshold slider |
