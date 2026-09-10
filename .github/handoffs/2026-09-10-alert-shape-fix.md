---
date: 2026-09-10
area: infra
type: bugfix
---

## What Changed

Fixed the alert pipeline storing every alert with the wrong columns — `AlertTriggerService.fireAlert()` called `AlertsService.addAlert()` with all four arguments shifted by one position, so titles read "trading" and the human message was stored in the `severity` column.

## Files Changed

- nest/src/modules/alerts/alert-trigger.service.ts — `addAlert(severity, 'trading', title, message)` → `addAlert('trading', title, message, severity)` + warning comment documenting the signature and the frontend's category expectation.
- src/core/alerts.js — NEW: `normaliseAlert()` so readers handle both the legacy (shifted) and corrected column layouts; also exports `ALERT_LEVELS`, `ALERT_CATEGORIES`, `ALERT_LEVEL_WEIGHT`.
- src/components/widgets/builtin-widgets.jsx — Active Alerts widget reads via `normaliseAlert()` instead of raw `title`/`severity`.

## Capability Map Entry

- **name:** Alert shape normalisation
- **persistence:** ephemeral (read-only helper; rows are stored in the `alert` table)
- **uiSurfaces:** 1
- **pipeline:** none
- **completion:** complete

## QA Test Entry

- **area:** Status / Alerts
- **name:** Alert fields carry title, message and severity correctly
- **procedure:** `GET /api/alerts/active` and inspect any alert fired *after* the NestJS restart. Compare `type`, `title`, `detail`, `severity`.
- **expected:** `type` = a category (`trading`), `title` = human headline (e.g. `Market Data Stale`), `detail` = the message, `severity` = a level (`critical|high|warning|info`). Rows created before the fix keep the legacy layout — the Alert Center and the Active Alerts widget must render both without showing "trading" as a headline.

## Architecture Framework Entry

- **section:** data
- **summary:** Alert write path — `AlertTriggerService.fireAlert(key, cfg, title, message, severity)` → `AlertsService.addAlert(type, title, detail, severity, ticker?, link?)` → `alert` table → `GET /api/alerts/active` → Alert Center + notification bell + Active Alerts widget. ⚠️ Positional-arg contract; a shift silently corrupts four columns at once and was invisible because the frontend looked up unknown values and fell back to grey.

## Notes / Gotchas

- The fix is in source and compiled; the running NestJS process must be **restarted** to apply it (the process is started by hand / Intranet, not watch-mode).
- Legacy rows are not migrated. `src/core/alerts.js` reads either layout, so no data fix is required — but any *other* consumer that reads `title`/`severity` directly (e.g. `AlertCenterPage`) is still wrong for legacy rows.
- Open question raised: should `type` stay the fixed category `'trading'`, or should each trigger key map to its own category (`mt5-disconnected` → `system`, `data-staleness` → `system`, `market-close` → `daily`)? The frontend's `TYPE_FALLBACKS` only knows signal/drawdown/daily/backtest/system/trading.
