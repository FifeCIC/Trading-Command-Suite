import { useQuery } from '@tanstack/react-query';
import { useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiGet } from '../core/api/client';
import { NAV_TREE } from '../core/nav-tree';
import './HomeDashboard.css';

const AREA_ICONS = {
  qa: '🧪', trading: '📈', scoring: '🎯', research: '🔬', data: '🗄️',
  watchlists: '👁️', automation: '⚙️', platforms: '🔌',
  focus: '🎯', training: '🕯️', testing: '🧪',
  status: '📡', settings: '⚙️', wizard: '🧙', ops: '🛡️',
};

/** Trading workflow areas — shown first as a focused group */
const WORKFLOW_AREAS = ['qa', 'watchlists', 'scoring', 'trading'];

export default function HomeDashboard() {
  const navigate = useNavigate();
  const [restarting, setRestarting] = useState(false);
  const [restartMsg, setRestartMsg] = useState(null);

  const healthQuery = useQuery({
    queryKey: ['home-health'],
    queryFn: () => apiGet('/api/').catch(() => null),
    staleTime: 30_000,
  });

  const serverData = healthQuery.data;
  const isApiOnline = Boolean(serverData?.database);
  const version = serverData?.version || '—';
  const statusDot = isApiOnline ? '🟢' : healthQuery.isLoading ? '⏳' : '🔴';
  const statusLabel = isApiOnline ? `API Online (v${version})` : healthQuery.isLoading ? 'Checking…' : 'API Offline';

  // MT5 bridge/AutoTrading status
  const mt5 = serverData?.mt5Bridge;
  const mt5Connected = mt5?.connected;
  const mt5TradeAllowed = mt5?.tradeAllowed;
  const mt5StatusClass = mt5Connected ? (mt5TradeAllowed ? 'ok' : 'warn') : 'err';

  // Stop Guardian status
  const sg = serverData?.stopGuardian;
  const sgEnabled = sg?.enabled;
  const sgGuardedCount = sg?.guardedCount ?? 0;

  const handleRestartBackend = useCallback(async () => {
    setRestarting(true);
    setRestartMsg('Sending start command...');
    try {
      const res = await fetch('/intranet/api-tasks.php?action=start&task=tradercore:all', {
        method: 'POST',
        signal: AbortSignal.timeout(15000),
      });
      if (res.ok) {
        setRestartMsg('Start command sent. Waiting for NestJS to come online...');
        // Poll until API responds
        let attempts = 0;
        const poll = setInterval(async () => {
          attempts++;
          try {
            const health = await apiGet('/api/version');
            if (health?.version) {
              clearInterval(poll);
              setRestartMsg('Backend is online! Refreshing...');
              setRestarting(false);
              healthQuery.refetch();
              setTimeout(() => setRestartMsg(null), 3000);
            } else if (attempts > 20) {
              clearInterval(poll);
              setRestartMsg('Backend did not respond after 40s. Check the terminal for errors.');
              setRestarting(false);
            }
          } catch {
            if (attempts > 20) {
              clearInterval(poll);
              setRestartMsg('Backend did not respond after 40s. Check the terminal for errors.');
              setRestarting(false);
            }
          }
        }, 2000);
      } else {
        setRestartMsg('Failed to send start command. Is WAMP running?');
        setRestarting(false);
      }
    } catch (err) {
      setRestartMsg(`Failed: ${err.message || 'Could not reach task runner'}`);
      setRestarting(false);
    }
  }, [healthQuery]);

  const areas = Object.entries(NAV_TREE).map(([id, area]) => ({
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
      {/* ── Header ── */}
      <header className="nd-header">
        <div className="nd-header-left">
          <img src="/tcs-logo.png" alt="Trading Command Suite" className="nd-logo" />
          <div>
            <h1 className="nd-title">Navigation Dashboard</h1>
            <p className="nd-subtitle">Trading Command Suite — algorithmic analysis & portfolio management</p>
          </div>
        </div>
        <div className="nd-header-right">
          <div className="nd-status-badge" title={statusLabel}>
            <span className="nd-status-dot">{statusDot}</span>
            <span>{statusLabel}</span>
          </div>
        </div>
      </header>

      {/* ── System Status & Tips ── */}
      <div className="nd-bottom-grid">
        <section className="nd-section nd-status-section">
          <h2>🖥️ System Status</h2>
          <div className="nd-status-grid">
            <div className="nd-status-item">
              <span className="nd-status-label">NestJS API</span>
              <span className={`nd-status-value ${isApiOnline ? 'ok' : 'err'}`}>
                {isApiOnline ? 'Running' : 'Offline'}
              </span>
            </div>
            <div className="nd-status-item">
              <span className="nd-status-label">Database</span>
              <span className="nd-status-value ok">MySQL (tradingcs)</span>
            </div>
            <div className="nd-status-item">
              <span className="nd-status-label">MT5 Bridge</span>
              <span className={`nd-status-value ${mt5StatusClass}`}>
                {mt5Connected ? `Port 5000 — $${mt5?.balance?.toLocaleString() ?? '—'}` : 'Offline'}
              </span>
            </div>
            <div className="nd-status-item">
              <span className="nd-status-label">MT5 AutoTrading</span>
              <span className={`nd-status-value ${mt5TradeAllowed === null ? '' : mt5TradeAllowed ? 'ok' : 'warn'}`}>
                {mt5TradeAllowed === null ? '—' : mt5TradeAllowed ? '✅ Enabled' : '❌ Disabled'}
              </span>
            </div>
            <div className="nd-status-item">
              <span className="nd-status-label">Stop Guardian</span>
              <span className={`nd-status-value ${sgEnabled ? 'ok' : ''}`}>
                {sgEnabled ? `🛡️ Guarding ${sgGuardedCount}` : '⏸ Stopped'}
              </span>
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
              <span className="nd-status-value">{version}</span>
            </div>
          </div>
        </section>
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

      {!isApiOnline && (
        <section className="nd-section nd-setup" style={{ marginTop: '1.5rem', borderColor: 'rgba(239,68,68,0.3)' }}>
          <h2>⚠️ Backend Not Connected</h2>
          <p style={{ color: '#94a3b8', fontSize: '0.9rem' }}>
            The NestJS API server isn't running.
          </p>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap', marginTop: '0.75rem' }}>
            <button
              onClick={handleRestartBackend}
              disabled={restarting}
              style={{
                padding: '0.5rem 1.25rem',
                background: restarting ? '#334155' : '#dc2626',
                color: '#fff',
                border: 'none',
                borderRadius: '6px',
                cursor: restarting ? 'not-allowed' : 'pointer',
                fontSize: '0.85rem',
                fontWeight: 600,
              }}
            >
              {restarting ? '⏳ Starting...' : '🔁 Restart Backend'}
            </button>
            {restartMsg && (
              <span style={{ color: '#94a3b8', fontSize: '0.8rem' }}>{restartMsg}</span>
            )}
          </div>
          <p style={{ color: '#64748b', fontSize: '0.75rem', marginTop: '0.5rem' }}>
            Or run manually: <code style={{ padding: '0.15rem 0.4rem', background: '#0f172a', borderRadius: '3px', fontSize: '0.8rem' }}>npm --prefix c:/wamp64/www/trading-command-suite/nest run start:dev</code>
          </p>
        </section>
      )}
    </div>
  );
}
