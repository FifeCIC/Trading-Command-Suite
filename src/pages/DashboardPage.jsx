/**
 * DashboardPage — the widget cockpit (epic #746)
 * ==============================================
 * This page used to be ~520 lines of hard-coded cards with their own queries.
 * Those cards are now registered widgets (`src/components/widgets/`), so the
 * dashboard is simply a board: add, drag, resize, remove — and the same widgets
 * can be placed on any other board (e.g. the Lab board, or a future screen).
 *
 * `defaultWidgets` is the cockpit as shipped. It is not just "first run": a
 * board that was seeded before a widget existed has it appended once, tracked by
 * the `seeded` list in the stored board document (see src/core/board-store.js),
 * so converting more of the app into widgets never strands it.
 *
 * `home-dashboard.css` still supplies the `dash-*` content classes the widgets
 * render (stat rows, tables, hot-pick rows, session popovers).
 *
 * Board storage: `tcs:view-state:widgets-board:dashboard`, per breakpoint.
 */
import SetupBanner from '../components/SetupBanner';
import WidgetBoard from '../components/WidgetBoard';
import { boardLabel, defaultWidgetsFor } from '../core/board-defaults';
import './home-dashboard.css';

export default function DashboardPage() {
  return (
    <div className="dash-page">
      <SetupBanner />
      {/* ⚠️ THE LOOP CONTROLS ARE NO LONGER HERE (owner, 2026-11-06). They moved INTO the System
          Status widget, so the loop is controllable from any board that places it — not just the
          Dashboard. `toolbarPosition="top-row"` puts the board's controls on the same line as the
          page's ℹ instead of in a second near-empty band beneath it.
          ⚠️ Started here 2026-10-02 by moving them off /automation/automation-dashboard; that
          history is recorded in LoopControls' header rather than lost with this line. */}
      <WidgetBoard
        boardId="dashboard"
        title={boardLabel('dashboard')}
        defaultWidgets={defaultWidgetsFor('dashboard')}
        toolbarPosition="top-row"
      />
    </div>
  );
}
