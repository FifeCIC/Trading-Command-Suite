import { useQuery } from '@tanstack/react-query';
import { apiGet } from '../core/api/client';
import { NAV_TREE } from '../core/nav-tree';
import { useNavigate } from 'react-router-dom';

const AREA_ICONS = {
  trading: '📈', scoring: '🎯', research: '🔬', data: '🗄️',
  watchlists: '👁️', automation: '⚙️', platforms: '🔌',
  focus: '🎯', training: '🕯️', testing: '🧪',
  settings: '⚙️', wizard: '🧙', ops: '🛡️',
};

const SETUP_STEPS = [
  { id: 'connect-mt5', label: 'Connect MT5 Bridge', done: false, desc: 'Link MetaTrader 5 for live forex data & trading' },
  { id: 'import-portfolio', label: 'Import Trading212 Portfolio', done: true, desc: 'Live portfolio connected — 16 positions loaded' },
  { id: 'add-api-keys', label: 'Add Provider API Keys', done: false, desc: 'Yahoo, Finnhub, Polygon for free data' },
  { id: 'create-strategy', label: 'Create First Strategy', done: false, desc: 'Build a scoring strategy with directives' },
  { id: 'run-backtest', label: 'Run a Backtest', done: false, desc: 'Validate strategy against historical data' },
  { id: 'first-trade', label: 'Place First Trade', done: false, desc: 'Execute a demo trade via MT5 bridge' },
];

export default function HomeDashboardPage() {
  const navigate = useNavigate();

  const healthQuery = useQuery({
    queryKey: ['health'],
    queryFn: () => apiGet('/api/version'),
  });

  const statusDot = healthQuery.data ? '🟢' : healthQuery.isLoading ? '⏳' : '🔴';
  const statusLabel = healthQuery.data ? 'API Online' : healthQuery.isLoading ? 'Checking\u2026' : 'API Offline';

  const areas = Object.entries(NAV_TREE).map(([id, area]) => ({
    id,
    label: area.label,
    icon: AREA_ICONS[id] || '\uD83D\uDCCB',
    viewCount: (area.views || []).length,
    firstView: (area.views || [])[0]?.id || 'overview',
  }));

  const doneSteps = SETUP_STEPS.filter(s => s.done).length;
  const totalSteps = SETUP_STEPS.length;
  const progressPct = Math.round((doneSteps / totalSteps) * 100);

  return (
    <div className="nav-dashboard">
      <header className="nd-header">
        <div className="nd-header-left">
          <h1 className="nd-title">Navigation Dashboard</h1>
          <p className="nd-subtitle">Trading Command Suite — algorithmic analysis & portfolio management</p>
        </div>
        <div className="nd-header-right">
          <div className="nd-status-badge" title={statusLabel}>
            <span className="nd-status-dot">{statusDot}</span>
            <span>{statusLabel}</span>
          </div>
        </div>
      </header>

      <section className="nd-section nd-setup">
        <div className="nd-section-header">
          <h2>🚀 Getting Started</h2>
          <span className="nd-progress-badge">{doneSteps}/{totalSteps} complete</span>
        </div>
        <div className="nd-progress-bar">
          <div className="nd-progress-fill" style={{ width: `${progressPct}%` }} />
        </div>
        <div className="nd-setup-grid">
          {SETUP_STEPS.map((step) => (
            <div key={step.id} className={`nd-setup-card ${step.done ? 'is-done' : ''}`}>
              <span className="nd-setup-check">{step.done ? '✅' : '⬜'}</span>
              <div className="nd-setup-info">
                <strong>{step.label}</strong>
                <span>{step.desc}</span>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="nd-section">
        <h2>📂 Navigation Areas</h2>
        <div className="nd-nav-grid">
          {areas.map((area) => (
            <button
              key={area.id}
              className="nd-nav-card"
              onClick={() => navigate(`/${area.id}/${area.firstView}`)}
            >
              <span className="nd-nav-icon">{area.icon}</span>
              <span className="nd-nav-label">{area.label}</span>
              <span className="nd-nav-count">{area.viewCount} views</span>
            </button>
          ))}
        </div>
      </section>

      <div className="nd-bottom-grid">
        <section className="nd-section nd-status-section">
          <h2>🖥️ System Status</h2>
          <div className="nd-status-grid">
            <div className="nd-status-item">
              <span className="nd-status-label">NestJS API</span>
              <span className={`nd-status-value ${healthQuery.data ? 'ok' : 'err'}`}>
                {healthQuery.data ? 'Running' : 'Offline'}
              </span>
            </div>
            <div className="nd-status-item">
              <span className="nd-status-label">Database</span>
              <span className="nd-status-value ok">MySQL (tradingcs)</span>
            </div>
            <div className="nd-status-item">
              <span className="nd-status-label">MT5 Bridge</span>
              <span className="nd-status-value ok">Port 5000</span>
            </div>
            <div className="nd-status-item">
              <span className="nd-status-label">Trading212</span>
              <span className="nd-status-value ok">Live — $2,393</span>
            </div>
            <div className="nd-status-item">
              <span className="nd-status-label">Frontend</span>
              <span className="nd-status-value ok">Vite (5173)</span>
            </div>
            <div className="nd-status-item">
              <span className="nd-status-label">Version</span>
              <span className="nd-status-value">{healthQuery.data?.version || '—'}</span>
            </div>
          </div>
        </section>

        <section className="nd-section">
          <h2>💡 Tips</h2>
          <ul className="nd-tips">
            <li><strong>SEES Live Stack</strong> — See which symbols score highest right now.</li>
            <li><strong>Strategy Builder</strong> — Combine directives with custom weights.</li>
            <li><strong>Speed Trading</strong> — Use keyboard shortcuts (B=buy, S=sell) for fast execution.</li>
            <li><strong>Candle Patterns</strong> — Training area with visual pattern detection.</li>
          </ul>
        </section>
      </div>
    </div>
  );
}
