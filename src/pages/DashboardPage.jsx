import { useNavigate } from 'react-router-dom';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiGet } from '../core/api/client';
import { NAV_TREE } from '../core/nav-tree';
import ScreenOptions from '../components/ScreenOptions';
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
  const [screenOptionsOpen, setScreenOptionsOpen] = useState(false);

  // ── Portfolio data ──
  const diagQuery = useQuery({
    queryKey: ['dash-diag'],
    queryFn: () => apiGet('/api/providers/mt5/diagnostics').catch(() => null),
    refetchInterval: 30_000,
  });
  const diag = diagQuery.data || {};
  const mt5Connected = diag.connected === true;
  const balance = diag.balance ?? 0;
  const equity = diag.equity ?? 0;

  const posQuery = useQuery({
    queryKey: ['dash-positions'],
    queryFn: () => apiGet('/api/providers/mt5/positions').catch(() => ({ positions: [] })),
    refetchInterval: 30_000,
    enabled: mt5Connected,
  });
  const positions = posQuery.data?.positions || [];
  const totalPnl = positions.reduce((s, p) => s + (p.profit || 0), 0);
  const posCount = positions.length;

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

      {/* ── Dashboard 2-Column Grid ── */}
      <div className="dash-grid">
        <div className="dash-col dash-col-main">
          <div className="dash-card">
            <h3>📊 Portfolio Summary</h3>
            <div className="dash-card-stats">
              <div className="dash-stat">
                <span className="dash-stat-label">MT5 Bridge</span>
                <span className={`dash-stat-value ${mt5Connected ? 'ok' : 'err'}`}>
                  {mt5Connected ? 'Connected' : 'Offline'}
                </span>
              </div>
              <div className="dash-stat">
                <span className="dash-stat-label">Balance</span>
                <span className="dash-stat-value ok">${balance.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
              </div>
              <div className="dash-stat">
                <span className="dash-stat-label">Equity</span>
                <span className="dash-stat-value ok">${equity.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
              </div>
              <div className="dash-stat">
                <span className="dash-stat-label">Open Positions</span>
                <span className="dash-stat-value">{posCount}</span>
              </div>
              <div className="dash-stat">
                <span className="dash-stat-label">Unrealized P&amp;L</span>
                <span className={`dash-stat-value ${totalPnl >= 0 ? 'ok' : 'err'}`}>
                  {totalPnl >= 0 ? '+' : ''}{totalPnl.toFixed(2)}
                </span>
              </div>
            </div>
          </div>

          {posCount > 0 && (
            <div className="dash-card">
              <h3>📈 Open Positions</h3>
              <div className="dash-table-wrap">
                <table className="dash-table">
                  <thead><tr><th>Symbol</th><th>Type</th><th>Vol</th><th>Open</th><th>Current</th><th>P&amp;L</th></tr></thead>
                  <tbody>
                    {positions.slice(0, 5).map((p) => (
                      <tr key={p.ticket}>
                        <td><strong>{p.symbol}</strong></td>
                        <td className={p.type === 'buy' ? 'dash-buy' : 'dash-sell'}>{p.type?.toUpperCase()}</td>
                        <td>{p.volume}</td>
                        <td>{p.priceOpen?.toFixed(2)}</td>
                        <td>{p.priceCurrent?.toFixed(2)}</td>
                        <td className={p.profit >= 0 ? 'dash-profit' : 'dash-loss'}>
                          {p.profit >= 0 ? '+' : ''}{p.profit?.toFixed(2)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {posCount > 5 && (
                <p className="dash-hint">+{posCount - 5} more — <button className="dash-link" onClick={() => navigate('/trading/positions-monitor')}>view all</button></p>
              )}
            </div>
          )}

          {posCount === 0 && mt5Connected && (
            <div className="dash-card"><h3>📈 Open Positions</h3><p className="dash-hint">No open positions.</p></div>
          )}
          {!mt5Connected && (
            <div className="dash-card"><h3>📈 Open Positions</h3><p className="dash-hint">MT5 bridge offline — connect to see positions.</p></div>
          )}
        </div>

        <div className="dash-col dash-col-side">
          <div className="dash-card">
            <h3>🌍 Market Sessions</h3>
            <div className="dash-sessions">
              {[{ label: 'London', open: 8, close: 16 }, { label: 'New York', open: 9, close: 16 }, { label: 'Tokyo', open: 9, close: 15 }].map((s) => {
                const now = new Date();
                const utc = now.getUTCHours();
                const offsets = { London: 1, 'New York': -4, Tokyo: 9 };
                const local = (utc + offsets[s.label] + 24) % 24;
                const isOpen = local >= s.open && local < s.close;
                return (
                  <div key={s.label} className={`dash-session ${isOpen ? 'dash-session-open' : 'dash-session-closed'}`}>
                    <span className="dash-session-dot" style={{background: isOpen ? '#22c55e' : '#ef4444'}}/>
                    <span>{s.label}</span>
                    <span className="dash-session-status">{isOpen ? 'Open' : 'Closed'}</span>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="dash-card">
            <h3>🔧 Dev Updates</h3>
            <p className="dash-hint">Release notes and community updates coming soon — pending TCS website and social presence.</p>
          </div>
        </div>
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
      <ScreenOptions
        activeView={null}
        isOpen={screenOptionsOpen}
        onToggle={() => setScreenOptionsOpen((v) => !v)}
      />
    </div>
  );
}
