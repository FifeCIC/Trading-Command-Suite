import { useNavigate } from 'react-router-dom';
import { NAV_TREE } from '../core/nav-tree';
import './HomeDashboard.css'; // reuses nav-card styles

const AREA_ICONS = {
  qa: '🧪', trading: '📈', scoring: '🎯', research: '🔬', data: '🗄️',
  watchlists: '👁️', automation: '⚙️', platforms: '🔌',
  focus: '🎯', training: '🕯️', testing: '🧪',
  status: '📡', settings: '⚙️', wizard: '🧙', ops: '🛡️',
  analysis: '📊', builder: '🔧', planner: '📋', lab: '🧪',
};

/** Trading workflow areas — shown first as a focused group */
const WORKFLOW_AREAS = ['qa', 'watchlists', 'scoring', 'trading'];

export default function DashboardPage() {
  const navigate = useNavigate();

  const areas = Object.entries(NAV_TREE)
    .filter(([id]) => id !== 'dashboard') // exclude self
    .map(([id, area]) => ({
      id,
      label: area.label,
      icon: AREA_ICONS[id] || '📋',
      viewCount: (area.views || []).length,
      firstView: (area.views || [])[0]?.id || 'overview',
    }));

  const workflowAreas = areas.filter(a => WORKFLOW_AREAS.includes(a.id));
  const supportingAreas = areas.filter(a => !WORKFLOW_AREAS.includes(a.id));

  return (
    <div className="nav-dashboard">
      {/* ── Top-Left Logo Bar ── */}
      <div className="nd-topbar">
        <img src="/tcs-logo.png" alt="Trading Command Suite" className="nd-topbar-logo" />
      </div>

      {/* ── Trading Workflow ── */}
      <section className="nd-section nd-workflow">
        <h2 className="nd-section-label">🧪 Trading Workflow</h2>
        <div className="nd-nav-grid nd-nav-grid-primary">
          {workflowAreas.map((area) => (
            <button
              key={area.id}
              className="nd-nav-card nd-nav-card-primary"
              onClick={() => navigate(`/${area.id}/${area.firstView}`)}
            >
              <span className="nd-nav-icon">{area.icon}</span>
              <span className="nd-nav-label">{area.label}</span>
              <span className="nd-nav-count">{area.viewCount} views</span>
            </button>
          ))}
        </div>
      </section>

      {/* ── Supporting Areas ── */}
      <section className="nd-section nd-supporting">
        <h2 className="nd-section-label">🔧 Supporting Areas</h2>
        <div className="nd-nav-grid nd-nav-grid-secondary">
          {supportingAreas.map((area) => (
            <button
              key={area.id}
              className="nd-nav-card nd-nav-card-secondary"
              onClick={() => navigate(`/${area.id}/${area.firstView}`)}
            >
              <span className="nd-nav-icon">{area.icon}</span>
              <span className="nd-nav-label">{area.label}</span>
              <span className="nd-nav-count">{area.viewCount} views</span>
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}
