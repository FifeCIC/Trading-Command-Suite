---
date: 2026-09-10
area: ui
type: feature
---

## What Changed

Added a widget registry + snapped-grid widget board so any existing card/component can be pulled into other views as a widget (epic #746) — drag/resize/grid-snap via the standard `react-grid-layout` library, with a live grid overlay while arranging; layouts persist per board id and per breakpoint.

## Files Changed

- src/core/board-store.js — NEW: the persistence seam. One versioned board document per board (`{v, items, layouts}`), `loadBoard`/`saveBoardLocal`/`subscribeBoard`/`listBoards`, plus the grid geometry maths and the v1↔v2 migration.
- src/core/widget-registry.js — NEW: `registerWidget`/`getWidget`/`getWidgets`; the contract that lets one component be reused across surfaces. Widgets declare `size: { w, h, minW, minH }` on a 12-column reference grid.
- src/components/widgets/builtin-widgets.jsx — NEW: 7 real-data widgets (Market Context, System Health, Open Positions, Top Signals, Automation Pulse, Active Alerts, Protocol Readiness) + registration side-effects.
- src/components/widgets/dashboard-widgets.jsx — NEW: the 9 data-bearing Dashboard cards, extracted into widgets (MT5 Portfolio, P&L by Broker, Diversification, Open Positions (live), Recent Trades, Worst-Case Monitor, Market Sessions, News Sources, Hot Picks). Query keys kept as `dash-*` so shared sources collapse into one request.
- src/pages/DashboardPage.jsx — now 46 lines: `SetupBanner` + the board with `COCKPIT_DEFAULTS`. All card markup and queries deleted (they live in the widgets).
- src/components/WidgetBoard.jsx — NEW: board (add/remove/reset/clear, drag, resize, keyboard arrange) + `WidgetLibrary` picker. Built on `react-grid-layout` v2 `Responsive` + `useContainerWidth` + `verticalCompactor`; grid overlay from `react-grid-layout/extras` `GridBackground`.
- src/components/widget-board.css — NEW: grid shell/overlay, tile chrome, RGL theme overrides (placeholder + resize handle), keyboard arrange strip, bare widget content primitives. 44px tap targets at `pointer: coarse`.
- src/pages/WidgetBoardLabPage.jsx — NEW: Lab host page for the library/board.
- src/pages/DashboardPage.jsx — hosts the board (`boardId="dashboard"`, defaults market-context/alerts/top-signals/automation) in place of the hard-coded `MarketContextWidget`; 10 legacy `dash-card`s remain below.
- src/core/view-routes.jsx, src/core/nav-tree.js, src/core/view-meta.js — registered `/lab/widget-board` (view `widget-board`).
- package.json — added `react-grid-layout@^2.2.4` (+79.7 kB raw / +21.9 kB gzip on the main bundle).

## Capability Map Entry

- **name:** Widget Board & Widget Library
- **persistence:** localStorage
- **uiSurfaces:** 2
- **pipeline:** none
- **completion:** complete
## QA Test Entry

- **area:** Lab / Dashboard
- **name:** Widget board — add, drag, resize, keyboard arrange, persist
- **procedure:** Open `/lab/widget-board` or `/dashboard/dashboard`. Add a widget from the library; drag a tile by its header onto another tile (it snaps to cells and pushes its neighbours); resize from the bottom-right corner; toggle `▦ Grid` to see the cells while idle; focus a tile's grip and use the arrange strip. Reload the page.
- **expected:** Tiles snap to whole grid cells, the grid overlay appears while dragging/resizing, the arrangement survives reload (`tcs:view-state:widgets-layout:<boardId>`, per breakpoint), and the keyboard strip moves/resizes identically to the mouse.

## Architecture Framework Entry

- **section:** routes
- **summary:** Widget system — `src/core/widget-registry.js` holds widget definitions (`frame: true` = board draws chrome, `frame: false` = component draws its own card; `size` = 12-col footprint); `WidgetBoard` renders registered widgets into a `react-grid-layout` responsive grid per `boardId` (drag/resize/grid-snap/compaction, layout persisted per breakpoint). Grid overlay built from the library's `GridBackground`. Live at `/lab/widget-board` and on the Dashboard; the foundation for the widget-based multi-screen cockpit (epic #746).

## Integration notes (react-grid-layout v2)

- ⚠️ **`onLayoutChange` does not fire on every drop.** Persist from `onDragStop` / `onResizeStop`, whose first argument is the committed layout (`EventCallback`). Relying on `onLayoutChange` left tiles visually moved while storage stayed stale.
- ⚠️ **Derive the active breakpoint from the measured width**, not from `onBreakpointChange`. If the two disagree, edits are written under the wrong breakpoint key and the tile snaps back on the next render. `onLayoutChange` must also skip the active breakpoint (it delivered the pre-drop layout and clobbered the commit).
- Companion CSS: import `react-grid-layout/css/styles.css` (it includes the resize-handle styles — `react-resizable` is no longer a dependency in v2). Library defaults are greys/red; re-themed with tokens in `widget-board.css`.
- Keyboard parity is ours, not the library's: `react-grid-layout` is pointer-only, so each tile's grip opens `ArrangeKeys` (move ×4, resize ×4).

## Dashboard conversion (all data-bearing cards → widgets)

| Was a card in `DashboardPage` | Now a widget | Source |
|---|---|---|
| MT5 Portfolio Summary | `mt5-portfolio` | `/api/providers/mt5/diagnostics` + `/positions` |
| P&L by Broker | `broker-pnl` | MT5 + `/api/portfolio?source=trading212` + `/api/isa/dashboard` |
| Diversification | `diversification` | `/api/diversification/summary` |
| Open Positions | `mt5-positions` | `/api/providers/mt5/positions` |
| Recent Trades | `recent-trades` | `/api/providers/mt5/history?limit=5` |
| Worst-Case Monitor | `worst-case` | derived from MT5 positions |
| Market Sessions | `market-sessions` | client-side clock |
| News & Sentiment | `news-sources` | `/api/news/counts` |
| Hot Picks | `hot-picks` | `/api/scoring/ranked?limit=5` |

Library is now **16 widgets** across Research / Status / Trading / Signals / Risk. `Dev Updates` (a static "coming soon" placeholder with no data) was dropped rather than converted.

**Bug found while porting — fixed:** the News card hard-coded `['finnhub', 'fmp']` as source keys, but `/api/news/counts` keys `counts` by PROVIDER NAME (`{SeekingAlpha, Yahoo, Benzinga, ChartMill, CNBC, Fintel}`). The lookup never matched, so the dashboard claimed "0 sources · 2 unverified" while 3,614 articles existed. The widget is now data-driven: `3,614 total articles across 6 sources`.

## Existing boards pick up new widgets (board-store v3)

The stored document gained `seeded: [widgetId]`. On load, any default widget a board has never been offered is appended once, at the bottom. Without this, converting a card into a widget would strand every existing board (changing `defaultWidgets` only affects brand-new boards), and re-adding removed widgets would be equally wrong. Verified: a board seeded with 4 widgets came back with the 9 converted ones appended, and a reload kept it at 13 (no duplication).

## Persistence (board-store.js)

- A board IS a screen: `dashboard`, `lab`, later `cockpit-1/2/3`. One document per board id, stored under `tcs:view-state:widgets-board:<boardId>` with `v: 3`.
- **Why the seam exists:** storage used to be two ad-hoc keys written from inside the component, so every shape change meant another bespoke migration and moving to the server would have meant rewriting persistence in the UI. `loadBoard`/`saveBoardLocal` are the swap point — a remote implementation drops in beside them and `WidgetBoard` does not change.
- Migration is one-time and automatic: the retired `widgets:<id>` + `widgets-layout:<id>` keys are read, merged into a versioned document, then deleted (verified on both existing boards). Add future shape changes as a step in `migrate()` — the version stamp is what makes that safe (v1 split keys → v2 single document → v3 `seeded`).
- `subscribeBoard` keeps several windows showing the same board in step via the `storage` event (multi-screen runs side by side).

## Notes / Gotchas

- **Bridge limitation:** inline JSX inside a page cannot be registered as a widget until it is extracted into its own component. `DashboardPage` is now fully converted (13 widgets, zero `dash-card` markup). What is left inline: the six widgets inside `ComponentLabPage.jsx` and the prototype on `TripleScreenPage.jsx`. Registered widgets receive no props — a widget needing arguments needs a thin wrapper component. ⚠️ `ComponentLabPage`'s inline widgets use **demo data** (`fakePrice`/`SAMPLE_SIGNALS`), so they cannot be lifted into the shared library as-is under the no-demo-data policy.
- **Colour-blind trap (again):** the library group wrapper was first named `.wb-library-group`; the substring `up` triggered the global colour-blind `::before` arrow injection, printing a phantom ▲ next to each category. Renamed to `.wb-lib-section`. Avoid `up`/`down`/`buy`/`sell`/`win`/`lose` substrings in new class names.
- `DetachableWidget` (resize/detach/minimise) is **not** used by the board yet — the board tiles are plain frames. Wiring it in is a follow-up decision (it brings its own drag/resize that would conflict with grid reordering).
- Found while building: `AlertTriggerService` wrote alerts with shifted arguments, leaving titles as "trading" — fixed, see `2026-09-10-alert-shape-fix.md`.
