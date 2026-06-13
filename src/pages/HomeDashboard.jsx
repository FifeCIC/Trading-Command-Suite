import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { apiGet } from '../core/api/client';
import './HomeDashboard.css';

const QUICK_NAV = [
  { id: 'trading', label: 'Trading', icon: '📊', desc: 'Portfolio, signals, execution', color: '#0ea5a6' },
  { id: 'research', label: 'Research', icon: '🔬', desc: 'Directives, scoring, symbols', color: '#8f7dff' },
  { id: 'data', label: 'Data', icon: '📈', desc: 'Feeds, imports, status', color: '#ffb347' },
  { id: 'ops', label: 'Operations', icon: '⚙️', desc: 'Queues, logs, automation', color: '#ff6b6b' },
  { id: 'settings', label: 'Settings', icon: '⚙️', desc: 'Appearance, API, config', color: '#64748b' },
];

export default function HomeDashboard() {
  const navigate = useNavigate();
  const [error] = useState(null);

  const healthQuery = useQuery({
    queryKey: ['home-health'],
    queryFn: () => apiGet('/api/version').catch(() => null),
    staleTime: 30_000,
  });

  const version = healthQuery.data?.version || '—';
  const isApiOnline = Boolean(healthQuery.data?.version);

  return (
    <div className="home-dashboard">
      <div className="hd-welcome">
        <h1>Welcome to Trading Command Suite</h1>
        <p className="hd-subtitle">
          Your algorithmic trading command surface —
          {isApiOnline
            ? <span className="hd-online"> API online (v{version})</span>
            : <span className="hd-offline"> API offline (running in demo mode)</span>
          }
        </p>
      </div>

      {error && <div className="hd-error">{error}</div>}

      <div className="hd-section">
        <h2>Quick Stats</h2>
        <div className="hd-stats">
          <div className="hd-stat-card">
            <div className="hd-stat-value">{healthQuery.data?.services?.databaseConnected ? '✓' : '✗'}</div>
            <div className="hd-stat-label">Database</div>
          </div>
          <div className="hd-stat-card">
            <div className="hd-stat-value">{healthQuery.data?.services?.queueEnabled ? '✓' : '✗'}</div>
            <div className="hd-stat-label">Queue</div>
          </div>
          <div className="hd-stat-card">
            <div className="hd-stat-value">{isApiOnline ? '✓' : '✗'}</div>
            <div className="hd-stat-label">API Status</div>
          </div>
          <div className="hd-stat-card">
            <div className="hd-stat-value">{version}</div>
            <div className="hd-stat-label">Version</div>
          </div>
        </div>
      </div>

      <div className="hd-section">
        <h2>Quick Navigation</h2>
        <div className="hd-nav-grid">
          {QUICK_NAV.map((item) => (
            <button
              key={item.id}
              className="hd-nav-card"
              style={{ borderTopColor: item.color }}
              onClick={() => navigate(`/${item.id}`)}
            >
              <span className="hd-nav-icon">{item.icon}</span>
              <span className="hd-nav-label">{item.label}</span>
              <span className="hd-nav-desc">{item.desc}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="hd-section">
        <h2>Getting Started</h2>
        <ul className="hd-tips">
          <li>Connect your <strong>Trading212</strong> account in Settings to see real portfolio data</li>
          <li>Explore the <strong>Scoring</strong> section to see directive-based symbol analysis</li>
          <li>Use the <strong>Strategy Builder</strong> to create custom trading strategies</li>
          <li>Check <strong>Operations</strong> for system health and scheduled tasks</li>
        </ul>
      </div>

      {!isApiOnline && (
        <div className="hd-section hd-section-warn">
          <h2>⚠️ Backend Not Connected</h2>
          <p>
            The NestJS API server doesn't appear to be running. Start it with
            <code> npm --prefix c:/wamp64/www/trading-command-suite/nest run start:dev</code>
            to enable full functionality.
          </p>
        </div>
      )}
    </div>
  );
}
