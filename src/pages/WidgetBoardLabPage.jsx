/**
 * Widget Library — /development/widget-library
 * ====================================
 * Prototype surface for the widget-based dashboard (epic #746, phase 1).
 *
 * ⚠️ RENAMED from "Widget Board" / `/lab/widget-board` (2026-09-17). The old name
 * collided with the widget *registry* vocabulary and, worse, with a BOARD label: the
 * board picker on /development/screen-assignment listed one board as "Widget Board (Lab)" and
 * another as "Cockpit", so the picker read as though it were a page chooser. See
 * `src/core/board-defaults.js` — board labels now name the SCREEN, not the page.
 *
 * This is where the widget LIBRARY lives first: pick widgets, arrange them by
 * dragging, remove them. Layout persists per board id, so the Lab board and the
 * eventual Dashboard board can be arranged independently.
 *
 * The widgets themselves come from `src/core/widget-registry.js`. Existing
 * components register as-is; inline page JSX must be extracted into its own
 * component before it can be reused here (see the page info note).
 */
import PageInfoPopover from '../components/PageInfoPopover';
import WidgetBoard from '../components/WidgetBoard';
import { defaultWidgetsFor } from '../core/board-defaults';

export default function WidgetBoardLabPage() {
  return (
    <div className="tl-page">
      <header className="tl-header">
        <h1>
          Widget Library
          <PageInfoPopover>
            Prototype widget dashboard. Add widgets from the library, drag tiles to reorder, and
            remove them — the layout persists per board. All widgets read stored data only; they
            never trigger imports or provider fetches.
            {'\n\n'}
            Widgets are registered in src/core/widget-registry.js. Components that already render
            their own card are registered with frame: false; bare components let the board draw the
            tile chrome. Inline JSX inside a page cannot be reused until it is extracted into a
            component of its own.
          </PageInfoPopover>
        </h1>
        <p className="tl-subtitle">
          Arrange your own cockpit. Drag a tile by its header to move it — it snaps to the grid and
          pushes its neighbours aside — or pull the bottom-right corner to resize. The{' '}
          <strong>▦ Grid</strong> toggle shows the cells the snap is committing to, and the grip on
          each tile opens keyboard controls for the same moves.
        </p>
      </header>

      <section className="tl-section">
        <WidgetBoard boardId="lab" defaultWidgets={defaultWidgetsFor('lab')} />
      </section>
    </div>
  );
}
