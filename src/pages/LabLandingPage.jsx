import { Link } from 'react-router-dom';
import './lab-landing.css';
import PageInfoPopover from '../components/PageInfoPopover';

/**
 * LabLandingPage — the Lab Directory.
 *
 * ⚠️ REWRITTEN 2026-09-23, during the Lab/Development split.
 *
 * The previous version was ALREADY BROKEN, independently of this split: it linked to
 * `/builder/backtest`, `/training/order-testing` and `/builder/performance-lab` — three areas
 * that have not existed for months — so three of its eight cards went nowhere. It simply was not
 * updated when those areas were renamed. A directory page that 404s is worse than no directory,
 * because it is the page a newcomer is meant to trust.
 *
 * The list is the Lab area's own contents (`nav-tree.js` → `lab.views`) minus this page.
 *
 * ⚠️ IT IS HAND-MAINTAINED, AND THAT IS A KNOWN GAP. `scripts/verify-view-meta-routes.cjs` sweeps
 * nav → view-meta; nothing sweeps nav → this list. So a page can be added to or removed from Lab
 * without any gate firing here. If a page joins or leaves Lab, update BOTH files.
 */

const LAB_PAGES = [
  // ── Backtesting & replay — "what would have happened?" ──
  {
    id: 'backtest',
    label: 'Backtest Engine',
    icon: '⬡',
    description: 'Run a bot or a symbol over a period and read the trades it would have taken.',
    route: '/lab/backtest',
    status: 'active',
  },
  {
    id: 'snapshot-replay',
    label: 'Snapshot Replay',
    icon: '⏮',
    description: 'Replay stored bars across any window — 1× to 20×, or instant — scoring each step.',
    route: '/lab/snapshot-replay',
    status: 'active',
  },
  {
    id: 'snapshots',
    label: 'Snapshots',
    icon: '🔬',
    description: 'Saved snapshots with mini-charts; compare one date range against another.',
    route: '/lab/snapshots',
    status: 'active',
  },
  // ── Charts & data inspection ──
  {
    id: 'charts-lab',
    label: 'Charts Lab',
    icon: '📊',
    description: 'Experimental charting playground — building a custom chart towards TradingView quality.',
    route: '/lab/charts-lab',
    status: 'active',
  },
  {
    id: 'timeline',
    label: 'Timeline',
    icon: '📅',
    description: 'Trades and events laid out on a single timeline.',
    route: '/lab/timeline',
    status: 'active',
  },
  {
    id: 'position-lifecycle',
    label: 'Position Lifecycle',
    icon: '🛡️',
    description: 'The full recorded life of a position: open → broker ticket linked → closed.',
    route: '/lab/position-lifecycle',
    status: 'active',
  },
  // ── Trading theory under test ──
  {
    id: 'speed-trading',
    label: 'Speed Trading',
    icon: '⚡',
    description: 'The speed day-trading model under test.',
    route: '/lab/speed-trading',
    status: 'active',
  },
  {
    id: 'gold-speed',
    label: 'Gold Speed',
    icon: '🔬',
    description: 'Focused XAUUSD scalping cockpit, locked to the xau-speed-v1 protocol.',
    route: '/lab/gold-speed',
    status: 'active',
  },
  // ── Comparison & allocation experiments ──
  {
    id: 'ab-testing',
    label: 'A/B Protocol Testing',
    icon: '⚖️',
    description: 'Two protocols against the same symbols — agreement rate and divergence. No money.',
    route: '/lab/ab-testing',
    status: 'active',
  },
  {
    id: 'allocator',
    label: 'Strategy Allocator',
    icon: '📊',
    description: 'Cross-broker strategy allocation and diversification.',
    route: '/lab/allocator',
    status: 'active',
  },
  {
    id: 'portfolio-lab',
    label: 'Portfolio Lab',
    icon: '🧪',
    description: 'Portfolio experiments, backed by the /api/lab chat and analysis endpoints.',
    route: '/lab/portfolio-lab',
    status: 'active',
  },
];

export default function LabLandingPage() {
  return (
    <div className="ll-page">
      <header className="ll-header">
        <h1>Lab
          <PageInfoPopover>
            Where we test theories and data. The pages here answer "what does the market do, and
            what would have happened?" — replay, backtesting, charts and theory experiments.
            Engineering tooling lives in the Development area.
          </PageInfoPopover>
        </h1>
      </header>

      <div className="ll-grid">
        {LAB_PAGES.map((page) => (
          <div key={page.id} className="ll-card">
            <div className="ll-card-header">
              <span className="ll-card-icon">{page.icon}</span>
              <h3>{page.label}</h3>
            </div>
            <p className="ll-card-desc">{page.description}</p>
            <Link to={page.route} className="ll-card-link">
              Open →
            </Link>
          </div>
        ))}
      </div>
    </div>
  );
}
