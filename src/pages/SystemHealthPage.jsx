/**
 * SystemHealthPage — Pre-flight health check & setup verification.
 *
 * Route: /settings/health-check
 */

import { useQuery } from '@tanstack/react-query';
import { apiGet } from '../core/api/client';
import './system-health.css';

const STATUS_ICONS = { pass: '✅', fail: '❌', warn: '⚠️' };
const STATUS_LABELS = { pass: 'Passed', fail: 'Failed', warn: 'Warning' };

export default function SystemHealthPage() {
  const healthQuery = useQuery({
    queryKey: ['system-health'],
    queryFn: () => apiGet('/api/system/health-check').catch(() => null),
    refetchInterval: 60_000,
  });

  const result = healthQuery.data;
  const checks = result?.checks || [];
  const overall = result?.overall || 'unknown';
  const timestamp = result?.timestamp;

  return (
    <div className="sh-page">
      <header className="sh-header">
        <h1>🩺 System Health</h1>
        <p className="sh-subtitle">
          Pre-flight checks to verify all core systems are operational.
          {timestamp && <> — Last checked: {new Date(timestamp).toLocaleTimeString()}</>}
        </p>
      </header>

      {/* ── Overall Status ── */}
      <div className={`sh-overall sh-overall-${overall}`}>
        <span className="sh-overall-icon">
          {overall === 'healthy' ? '✅' : overall === 'degraded' ? '⚠️' : '❌'}
        </span>
        <div>
          <span className="sh-overall-label">System Status: {overall.toUpperCase()}</span>
          {result && (
            <span className="sh-overall-summary">
              {result.passed} passed · {result.warned} warnings · {result.failed} failed
            </span>
          )}
        </div>
        <button className="sh-refresh-btn" onClick={() => healthQuery.refetch()}>
          {healthQuery.isFetching ? '⟳ Checking...' : '⟳ Re-check'}
        </button>
      </div>

      {/* ── Check List ── */}
      <section className="sh-section">
        <h2>Checks</h2>
        <div className="sh-checks">
          {healthQuery.isLoading ? (
            <p className="sh-loading">Running system checks...</p>
          ) : checks.length === 0 ? (
            <p className="sh-empty">Health check unavailable — is the API running?</p>
          ) : (
            checks.map((check) => (
              <div key={check.name} className={`sh-check sh-check-${check.status}`}>
                <span className="sh-check-icon">{STATUS_ICONS[check.status]}</span>
                <div className="sh-check-body">
                  <span className="sh-check-name">{check.name}</span>
                  <span className="sh-check-detail">{check.detail}</span>
                </div>
                <span className="sh-check-label">{STATUS_LABELS[check.status]}</span>
              </div>
            ))
          )}
        </div>
      </section>

      {/* ── Quick Actions ── */}
      <section className="sh-section">
        <h2>Quick Actions</h2>
        <div className="sh-actions">
          <a href="/settings/data-management" className="sh-action-card">
            <span className="sh-action-icon">🗄️</span>
            <strong>Data Management</strong>
            <span>Prune old data, view table stats</span>
          </a>
          <a href="/status/system-status" className="sh-action-card">
            <span className="sh-action-icon">📡</span>
            <strong>System Status</strong>
            <span>Provider health, API status</span>
          </a>
          <a href="/settings/server-controls" className="sh-action-card">
            <span className="sh-action-icon">🔧</span>
            <strong>Server Controls</strong>
            <span>Start/stop MT5 bridge, NestJS, Vite</span>
          </a>
          <a href="/automation/dashboard" className="sh-action-card">
            <span className="sh-action-icon">⚙️</span>
            <strong>Automation Dashboard</strong>
            <span>Enable trading, configure strategies</span>
          </a>
        </div>
      </section>
    </div>
  );
}
