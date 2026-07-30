# Handoff: Strategy Page Consolidation (#504)

**Agent:** DeepSeek V4 Pro
**Date:** 2026-07-29
**Issue:** #504 — [Discuss] Consolidate 9 strategy-related pages

## Decision

**9 → 4 canonical pages.** Old pages preserved under a sidebar section header — nothing deleted.

### 4 Canonical Pages

| Route | Page | Lines | Role |
|-------|------|-------|------|
| `/trading/strategies-index` | StrategiesListPage | 198 | Filterable card index (all/active/trading/scoring), inline toggle, expand details |
| `/trading/strategy-monitor` | StrategyMonitorPage | 215 | Tabbed hub: Overview (stats+card grid), Compare (PnL table), Ladders (ranked list) |
| `/trading/strategy-builder` | StrategyBuilderPage | 274 | Existing — drag-and-drop directive canvas. Now registered in routes. |
| `/trading/strategy-create` | StrategyCreatePage | 285 | Tabbed creation: Form (structured with broker compatibility, risk defaults) and Wizard (StrategyWizard component) |

### Sidebar Structure (Trading section)
```
Strategies           ← NEW StrategiesListPage
Strategy Monitor     ← NEW StrategyMonitorPage (tabs)
Strategy Builder     ← NEW StrategyBuilderPage (was unregistered)
Create Strategy      ← NEW StrategyCreatePage (tabs)
── Legacy Strategy Pages ──
Market Context
Positions Monitor
Trading Strategies (old)
Strategy Library
Strategy Dashboard (old)
Create Strategy (old)
Strategy Comparison (old)
...
```

### Dead code identified (NOT deleted)
| Page | Issue |
|------|-------|
| `StrategiesPage.jsx` | Imported but never routed. Hardcoded seed JSON. |
| `ViewStrategyPage.jsx` | Not in view-routes. All mock data. |
| `StrategyWizardPage.jsx` | 9-line thin wrapper around StrategyWizard component. |
| `StrategyLaddersPage.jsx` | 80 lines, self-admitted "hardcoded, will be DB-driven." |

### Files created
| File | Description |
|------|-------------|
| `src/pages/StrategiesListPage.jsx` | Filterable strategy index with expand/collapse cards |
| `src/pages/strategies-list.css` | Card grid, filter chips, detail panel styles |
| `src/pages/StrategyMonitorPage.jsx` | Tabbed monitoring hub (overview/compare/ladders) |
| `src/pages/strategy-monitor.css` | Tab bar, stat grid, card grid, ladder rows |
| `src/pages/StrategyCreatePage.jsx` | Tabbed creation (form/wizard) with broker compatibility |
| `src/pages/strategy-create.css` | Form layout, tab bar, field rows, compat badges |

### Files updated
| File | Change |
|------|--------|
| `src/core/view-routes.jsx` | 3 new imports + 4 route registrations |
| `src/core/nav-tree.js` | 4 new entries at top, section-header divider, old entries labeled '(old)' |

## Verification
- Vite build: 2948 modules, 1.02s ✅
- All 4 routes render correctly in browser
- StrategyBuilderPage was previously imported but not registered — now accessible at `/trading/strategy-builder`
