# Handoff: Utility Migration — Consolidate 17 files to shared core utilities

**Date:** 2026-08-11
**Agent:** GitHub Copilot (DeepSeek V4 Pro)

## Summary
Removed 17 duplicated local utility functions across page files, replacing them with imports from centralized `src/core/` modules. Enhanced `formatCurrency` to support multi-currency and absolute-value display. Build passes clean — 2955 modules, 0 errors.

## Changes

### Enhanced: `src/core/format-utils.js` — `formatCurrency`
- Added `abs` option (default `false`): uses `Math.abs()` for display of absolute values
- Added `currency` option (default `'USD'`): supports multi-currency via `toLocaleString`

### `timeAgo` — 7 files migrated
| File | Old | New |
|------|-----|-----|
| `src/pages/AILogViewerPage.jsx` | 9-line local `timeAgo(iso)` | `import { timeAgo } from '../core/format-utils'` |
| `src/pages/HealthDashboardPage.jsx` | 5-line local `timeAgo(iso)` | `import { timeAgo } from '../core/format-utils'` |
| `src/pages/Mt5StatusPage.jsx` | Both `formatTime` + `timeAgo` locals | `import { formatTime, timeAgo } from '../core/format-utils'` |
| `src/pages/SymbolFocusPage.jsx` | 8-line local `timeAgo(ts)` | `import { timeAgo } from '../core/format-utils'` |
| `src/pages/PortfolioPage.jsx` | 6-line computed `timeAgo` string | `timeAgo(lastUpdated.toISOString())` |
| `src/pages/ProviderHealthPage.jsx` | Misnamed `formatTime` (was actually timeAgo) | `import { timeAgo } from '../core/format-utils'` |
| `src/pages/RecentlyAnalysedSymbolsPage.jsx` | Misnamed `formatTime` (was actually timeAgo) | `import { timeAgo } from '../core/format-utils'` |

### `formatTime` / `formatDateTime` — 5 files migrated
| File | Old | New |
|------|-----|-----|
| `src/pages/ApiActivityPage.jsx` | Local `formatTime` | `import { formatTime } from '../core/format-utils'` |
| `src/pages/AutomationDashboardPage.jsx` | Local `formatTime` + inline `pnlColor` | `formatTime(iso, { seconds: true })` + `import { pnlColor }` |
| `src/pages/ExecutionQueuePage.jsx` | Locals: `formatTime`, `formatDuration`, `elapsedSince` | Shared `formatTime`, `formatDuration`, `timeAgo`; `elapsedSince`→`timeAgo` |
| `src/pages/ImportJobsPage.jsx` | Local `formatTime` (was `toLocaleString()` = datetime) | `import { formatDateTime }`; kept local `formatDuration` (different 2-date signature) |
| `src/pages/Mt5StatusPage.jsx` | (covered above) | (covered above) |

### `getProtocolType` — 2 files migrated
| File | Old | New |
|------|-----|-----|
| `src/pages/ProtocolsPage.jsx` | 18-line local duplicate | `import { getProtocolType } from '../core/protocol-utils'` |
| `src/pages/ProtocolsPageB.jsx` | 7-line local duplicate | `import { getProtocolType } from '../core/protocol-utils'` |

### `scoreColor` — 1 file migrated
| File | Old | New |
|------|-----|-----|
| `src/pages/DashboardPage.jsx` | Inline ternary: `pick.score >= 50 ? 'var(--color-profit)' : ...` | `import { scoreColor } from '../core/signal-utils'`; now uses DB-backed thresholds (65/40) |

### `formatCurrency` — 3 files, 20 call sites migrated
| File | Old | New |
|------|-----|-----|
| `src/pages/AccountsDashboardPage.jsx` | `formatCurrency(val, currency)` — 9 call sites | `formatCurrency(val, { currency })` with options object |
| `src/pages/DailyBriefingPage.jsx` | Local with `Math.abs()` — 2 call sites | `formatCurrency(n, { abs: true })` |
| `src/pages/DailySummaryReportPage.jsx` | Local with `Math.abs()` — 2 call sites | `formatCurrency(n, { abs: true })` |

## Files Changed (17 total)
| File | Change |
|------|--------|
| `src/core/format-utils.js` | Enhanced `formatCurrency` with `abs` + `currency` options |
| `src/pages/AILogViewerPage.jsx` | timeAgo → shared |
| `src/pages/HealthDashboardPage.jsx` | timeAgo → shared |
| `src/pages/Mt5StatusPage.jsx` | timeAgo + formatTime → shared |
| `src/pages/SymbolFocusPage.jsx` | timeAgo → shared |
| `src/pages/PortfolioPage.jsx` | computed timeAgo → shared |
| `src/pages/ProviderHealthPage.jsx` | misnamed formatTime → timeAgo shared |
| `src/pages/RecentlyAnalysedSymbolsPage.jsx` | misnamed formatTime → timeAgo shared |
| `src/pages/ApiActivityPage.jsx` | formatTime → shared |
| `src/pages/AutomationDashboardPage.jsx` | formatTime + pnlColor → shared |
| `src/pages/ExecutionQueuePage.jsx` | formatTime + formatDuration + elapsedSince → shared |
| `src/pages/ImportJobsPage.jsx` | formatTime → formatDateTime shared |
| `src/pages/ProtocolsPage.jsx` | getProtocolType → shared |
| `src/pages/ProtocolsPageB.jsx` | getProtocolType → shared |
| `src/pages/DashboardPage.jsx` | inline scoreColor → shared (now DB-backed thresholds) |
| `src/pages/AccountsDashboardPage.jsx` | formatCurrency → shared (multi-currency) |
| `src/pages/DailyBriefingPage.jsx` | formatCurrency → shared (abs mode) |
| `src/pages/DailySummaryReportPage.jsx` | formatCurrency → shared (abs mode) |

## Verification
- ✅ Vite build: 2955 modules, 0 errors
- ✅ All import paths resolve correctly
- ✅ Function signatures matched with appropriate options (`{ seconds: true }`, `{ abs: true }`, `{ currency }`)
