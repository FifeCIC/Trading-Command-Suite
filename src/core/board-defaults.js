/**
 * Board defaults — the shipped widget set for each named board
 * ===========================================================
 * A **board** is a screen-sized canvas of widgets (`src/core/board-store.js`).
 * Boards are identified by an id, and each id has a default widget set that is
 * applied on first visit. Multiple pages render boards, so the default lists
 * live here rather than inside any one page:
 *
 *   dashboard : DashboardPage        (/dashboard/dashboard) — the cockpit
 *   lab       : WidgetBoardLabPage   (/lab/widget-board)    — the prototype
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * The screenshot-the-cockpit route (`/dashboard/screen`) renders *any* board for
 * a given monitor, so it needs the same defaults as the page that owns that
 * board. Importing a page module just to read its defaults would create a
 * page→page dependency, so the lists live in core instead and every surface
 * reads them from here.
 *
 * ⚠️ A board id that is not listed here still works (the board store creates it
 * empty and the user fills it from the widget library) — `defaultWidgetsFor()`
 * returns an empty list rather than throwing.
 */

/** defaultWidgets per board id — the shipped arrangement. */
export const BOARD_DEFAULTS = {
  dashboard: [
    'market-context',
    'alerts',
    'hot-picks',
    'mt5-portfolio',
    'broker-pnl',
    'worst-case',
    'mt5-positions',
    'recent-trades',
    'diversification',
    'top-signals',
    'market-sessions',
    'news-sources',
    'automation',
  ],
  lab: ['market-context', 'top-signals', 'positions', 'system-health'],
};

/** Human labels for the board picker. Falls back to the raw id. */
export const BOARD_LABELS = {
  dashboard: 'Cockpit',
  lab: 'Widget Board (Lab)',
};

/** Board ids the app ships with (before anything is stored). */
export const BUILT_IN_BOARDS = Object.keys(BOARD_DEFAULTS);

export const defaultWidgetsFor = (boardId) => BOARD_DEFAULTS[boardId] || [];

export const boardLabel = (boardId) => BOARD_LABELS[boardId] || boardId;
