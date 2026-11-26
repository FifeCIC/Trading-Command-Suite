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

  /**
   * The PERSISTENT fault registry (#1348 option A). Its whole purpose is that a fault which blocks
   * trading must reach a page somebody already opens — a registry is a graveyard unless it is on a
   * surface with a cadence beat beside it, which is why the "Reviewed" column exists.
   *
   * ⚠️ THE ERROR IS NOT AN EMPTY LIST. `data === undefined` (the request failed) and `rows: []`
   * (the registry answered "nothing is open") are different facts, and rendering both as "no faults"
   * is the defect this panel exists to end.
   */
  const faultQuery = useQuery({
    queryKey: ['faults-open'],
    queryFn: () => apiGet('/api/faults?status=open'),
    refetchInterval: 60_000,
  });
  const faultRows = faultQuery.data?.rows ?? [];
  const faultRead = faultQuery.isSuccess;

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

      {/* ── Persistent faults ── */}
      <section className="sh-section">
        <h2>Persistent Faults</h2>
        <p className="sh-subtitle">
          Faults that survive a restart, counted in EPISODES. A quote that could not price an order
          appears here by cause — stale, ahead-of-clock, no tick time, no quote — instead of
          vanishing into the run totals as “this symbol never signalled” (#1348).
        </p>
        {!faultRead ? (
          <p className="sh-empty">
            {faultQuery.isLoading
              ? 'Reading the fault registry…'
              : 'The fault registry could not be read — this is NOT “no faults”. Is the API running?'}
          </p>
        ) : faultRows.length === 0 ? (
          <p className="sh-empty">No open faults recorded.</p>
        ) : (
          <table className="sh-faults">
            <thead>
              <tr>
                <th>Code</th>
                <th>Severity</th>
                <th>What it means</th>
                <th>Count</th>
                <th>Last seen</th>
                <th>Reviewed</th>
              </tr>
            </thead>
            <tbody>
              {faultRows.map((f) => (
                <tr key={f.id} className={`sh-fault sh-fault-${f.severity}`}>
                  <td className="sh-fault-code">
                    {f.issueUrl
                      ? <a href={f.issueUrl} target="_blank" rel="noreferrer">{f.code}</a>
                      : f.code}
                  </td>
                  <td><span className={`sh-sev sh-sev-${f.severity}`}>{f.severity}</span></td>
                  <td>
                    {f.title}
                    {f.evidence?.symbol && <span className="sh-fault-ev"> · {f.evidence.symbol}</span>}
                  </td>
                  <td className="sh-fault-num">{f.count}</td>
                  <td>{f.lastSeen ? new Date(f.lastSeen).toLocaleString() : '—'}</td>
                  {/* The cadence beat. A row nobody has ever reviewed says "never", never "0 days ago". */}
                  <td>{f.neverReviewed ? 'never' : `${f.daysSinceReview}d ago`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
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
