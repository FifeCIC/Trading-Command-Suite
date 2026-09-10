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
import './home-dashboard.css';

/** The dashboard as it shipped, expressed as widget ids. */
const COCKPIT_DEFAULTS = [
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
];

export default function DashboardPage() {
  return (
    <div className="dash-page">
      <SetupBanner />
      <WidgetBoard boardId="dashboard" title="Cockpit" defaultWidgets={COCKPIT_DEFAULTS} />
    </div>
  );
}
