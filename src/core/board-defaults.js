/**
 * Board defaults — the shipped widget set for each named board
 * ===========================================================
 * A **board** is a screen-sized canvas of widgets (`src/core/board-store.js`).
 * Boards are identified by an id, and each id has a default widget set that is
 * applied on first visit. Multiple pages render boards, so the default lists
 * live here rather than inside any one page:
 *
 *   dashboard : DashboardPage        (/dashboard/dashboard) — the widget cockpit
 *   lab       : WidgetBoardLabPage   (/development/widget-library)  — the prototype
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
    // Placed high on purpose (#943): the owner asked for the caps to be visible
    // without hunting for them. Existing boards receive it appended once via the
    // `seeded` list; this order applies to a first-run board.
    'risk-caps',
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

/**
 * Human labels for the board picker. Falls back to the raw id.
 *
 * ⚠️ These are SCREEN names, not page names (2026-09-17).
 * The picker on `/settings/screen-assignment` assigns a BOARD to a physical monitor. It used to
 * label them `dashboard: 'Cockpit'` and `lab: 'Widget Board (Lab)'` — both of which read
 * like page names, so choosing "Cockpit" looked like navigating to a Cockpit view when it
 * actually assigns the *dashboard* board to that monitor. Since `/settings/screen-assignment` and
 * `/development/meta-stack-cockpit` are pages that both say "cockpit", a board also called "Cockpit"
 * was the third meaning of the word in one screen.
 *
 * Rule: a board label names the screen the board fills, and must not repeat a page name.
 */
export const BOARD_LABELS = {
  dashboard: 'Dashboard',
  // The lab board is only ever assigned on `/settings/screen-assignment`. That view used to be
  // premium-only, so this entry was dropped from the free build — removed 2026-10-28. There is one
  // edition now, so it always renders.
  // ⚠️ Note it *repeats a page name* ('Widget Library'), which the rule above forbids. That was
  // tolerated only because the view was unreachable; worth renaming when this board is next touched.
  lab: 'Widget Library (Lab)',
};

/** Board ids the app ships with (before anything is stored). */
export const BUILT_IN_BOARDS = Object.keys(BOARD_DEFAULTS);

export const defaultWidgetsFor = (boardId) => BOARD_DEFAULTS[boardId] || [];

export const boardLabel = (boardId) => BOARD_LABELS[boardId] || boardId;
