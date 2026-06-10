# Plugin React Tab Parity Checklist

Status: synced from current React shell  
Sprint prompt: P15  
Last updated: 2026-06-10

## Source Files

This checklist reflects the current code state from:

- `src/core/nav-tree.js`
- `src/pages/plugin-tab-skeletons.js`
- `src/pages/skeleton-rollout.js`
- `src/App.jsx`

## Summary

| Measure | Count | Notes |
|---|---:|---|
| Navigation views | 107 | All secondary views registered in `NAV_TREE`. |
| Implemented or inline views | 22 | Routed to a real page component or inline app surface in `App.jsx`. |
| Generic skeleton views | 85 | Routed through `PluginTabSkeletonPage` using `PLUGIN_TAB_SKELETONS`. |
| Unmapped nav views | 0 | Every current nav view resolves to either real content or a skeleton. |

## Area Parity

| Area | Total views | Implemented | Skeleton | Phase emphasis |
|---|---:|---:|---:|---|
| Trading | 10 | 3 | 7 | SEES cockpit and strategy execution. |
| Scoring | 12 | 1 | 11 | Directive configuration and strategy scoring. |
| Research | 12 | 3 | 9 | Symbols, news, events, and market context. |
| Analysis | 3 | 0 | 3 | Technical analysis views not yet upgraded. |
| Data | 14 | 2 | 12 | Provider data, imports, endpoint catalog, and tables. |
| Watchlists | 3 | 0 | 3 | Active symbols and user watchlists. |
| Automation | 6 | 1 | 5 | Queue surface exists; rules/schedules are skeletons. |
| Development | 20 | 4 | 16 | Architecture and runtime tools partially implemented. |
| Focus | 4 | 0 | 4 | Focus/advisor pages are skeletons. |
| Trading Platforms | 4 | 1 | 3 | Provider comparison is real; other controls are skeletons. |
| Wizard | 2 | 1 | 1 | Setup is real; SEES readiness is a skeleton. |
| Ops | 5 | 4 | 1 | Status, risk, analytics, and security are real. |
| Testing | 3 | 0 | 3 | QA/performance/long-run labs are skeletons. |
| Settings | 9 | 2 | 7 | General settings and theme packs are real. |

## Implemented Views

| View ID | Label | Area | Current implementation |
|---|---|---|---|
| `sees-live-stack` | SEES Live Stack | Trading | `SeesLiveStackMockPage` with local deterministic ranking and API polling. |
| `signals-workbench` | SEES Diagnostics | Trading | `SignalsWorkbenchPage`. |
| `strategy-builder` | Strategy Builder | Trading | `StrategyBuilderPage`. |
| `directives-manager` | Directives | Scoring | `DirectivesManagerPage`. |
| `symbols-browser` | Symbols | Research | `SymbolsBrowserPage`. |
| `news-intel` | News Intel | Research | `NewsIntelPage`. |
| `events-calendar` | Events Calendar | Research | `EventsCalendarPage`. |
| `trading-platforms` | Sources | Data | `TradingPlatformsPage`. |
| `database-tables` | Tables | Data | `DatabaseTablesPage`. |
| `execution-queue` | Execution Queue | Automation | `ExecutionQueuePage`. |
| `architecture-framework` | Architecture | Development | `ArchitectureFrameworkPage`. |
| `theme-lab` | Theme Lab | Development | Inline `App.jsx` theme diagnostics surface. |
| `component-lab` | Component Lab | Development | Inline `App.jsx` component preview surface. |
| `runtime` | Dev Runtime | Development | Inline `App.jsx` runtime diagnostics surface. |
| `platform-comparisons` | API Provider Comparisons | Trading Platforms | `PlatformComparisonsPage`. |
| `setup` | Setup Checklist | Wizard | `SetupWizardPage`. |
| `status` | System Status | Ops | `SystemStatusPage`. |
| `risk-controls` | Risk Controls | Ops | `RiskControlsPage`. |
| `analytics` | Analytics | Ops | Inline `App.jsx` analytics/performance surface. |
| `security` | Security | Ops | Inline `App.jsx` security controls surface. |
| `settings` | General | Settings | `SettingsPage`. |
| `theme-packs` | Theme Packs | Settings | `ThemePage`. |

## Skeleton Views

These views are registered in navigation and backed by `PluginTabSkeletonPage`.

| Area | Skeleton view IDs |
|---|---|
| Trading | `trading-strategies`, `calculators`, `portfolio-overview`, `trade-history`, `manual-trading`, `positions-monitor`, `trade-journal` |
| Scoring | `scoring-overview`, `configure-directives`, `directives-status`, `algorithm-lab`, `create-scoring-strategies`, `manage-scoring-strategies`, `view-scoring-strategies`, `scoring-runs`, `scoring-activity-logs`, `strategy-templates`, `scoring-developer-mode` |
| Research | `research-overview`, `sector-rotation`, `market-correlations`, `technical-indicators`, `earnings-calendar`, `social-networks`, `price-forecast`, `pattern-scanner`, `macro-monitor` |
| Analysis | `recently-analysed-symbols`, `support-resistance`, `volatility-analysis` |
| Data | `data-elements`, `manual-import`, `decoder`, `imports-history`, `api-activity`, `api-endpoints`, `transient-caches`, `create-source`, `provider-health`, `api-keys`, `sources-list`, `api-errors` |
| Watchlists | `active-symbols`, `user-watchlists`, `create-watchlist` |
| Automation | `automation-dashboard`, `background-activity`, `automation-rules`, `cron-scheduler`, `alert-center` |
| Development | `current-task`, `algorithm-debugger`, `diagrams`, `explore-tasks`, `duplicate-checker`, `create-task`, `dev-ai`, `pointers`, `layouts`, `light-ui-library`, `dark-ui-library`, `jquery-ui`, `assets`, `developer-snippets`, `listener-testing`, `workflow-wizards` |
| Focus | `focus-priority`, `focus-daily`, `focus-weekly`, `focus-advisor` |
| Trading Platforms | `platform-api-management`, `platform-api-efficiency`, `platform-switches` |
| Wizard | `wizard-sees-readiness` |
| Ops | `audit-log` |
| Testing | `qa-lab`, `performance-lab`, `long-run-tests` |
| Settings | `settings-trading-api`, `settings-shortcodes`, `settings-symbols`, `settings-database`, `settings-bugnet`, `settings-education`, `user-preferences` |

## Phase Mapping

The rollout file currently gives explicit phase metadata to 19 views.

| View ID | Phase | Order | Status | Current parity |
|---|---|---|---|---|
| `api-endpoints` | Phase 0 | 1/15 | foundation | Skeleton |
| `api-activity` | Phase 0 | 2/15 | foundation | Skeleton |
| `data-elements` | Phase 0 | 3/15 | foundation | Skeleton |
| `active-symbols` | Phase 0 | 4/15 | foundation | Skeleton |
| `events-calendar` | Phase 1 | 1/6 | foundation | Implemented |
| `news-intel` | Phase 1 | 2/6 | foundation | Implemented |
| `configure-directives` | Phase 1 | 5/15 | decision | Skeleton |
| `algorithm-lab` | Phase 1 | 6/15 | decision | Skeleton |
| `create-scoring-strategies` | Phase 1 | 7/15 | decision | Skeleton |
| `signals-workbench` | Phase 2 | 3/6 | decision | Implemented |
| `strategy-builder` | Phase 2 | 4/6 | decision | Implemented |
| `trading-strategies` | Phase 2 | 8/15 | execution | Skeleton |
| `manual-trading` | Phase 2 | 11/15 | execution | Skeleton |
| `risk-controls` | Phase 3 | 5/6 | controls | Implemented |
| `execution-queue` | Phase 3 | 6/6 | controls | Implemented |
| `trade-history` | Phase 3 | 12/15 | controls | Skeleton |
| `platform-comparisons` | Phase 3 | 13/15 | controls | Implemented |
| `focus-priority` | Phase 4 | 14/15 | intelligence | Skeleton |
| `performance-lab` | Phase 4 | 15/15 | validation | Skeleton |

## Known Gaps

| Gap | Impact | Suggested next action |
|---|---|---|
| Most parity views are navigation-complete but skeleton-backed. | Operators can find tabs, but core workflows are not yet functional. | Upgrade highest-impact skeletons from P12: `configure-directives`, `active-symbols`, `trading-strategies`, `trade-history`, `api-endpoints`. |
| `sees-live-stack` is implemented but still named as a mock page in code. | It can confuse agents reviewing real-vs-placeholder state. | Rename or wrap once Task 7 converts it to the live SEES panel. |
| `theme-lab`, `component-lab`, and `runtime` are inline in `App.jsx`. | They are real surfaces but not page components, making parity audits less obvious. | Extract only if these views grow beyond simple diagnostics. |
| Rollout metadata covers only 18 of 107 nav views. | Phase planning is incomplete for many plugin parity tabs. | Extend `SKELETON_ROLLOUT` when a skeleton enters Now/Next planning. |
| Skeleton registry includes `sees-ready` and `sees-pro`, but these IDs are not present in `NAV_TREE`. | Registry contains orphan skeleton definitions. | Either add planned nav entries or remove orphan definitions during a future cleanup pass. |

## Validation Commands

Run after parity sync:

```powershell
npm --prefix c:/wamp64/www/trading-command-suite run build
```
