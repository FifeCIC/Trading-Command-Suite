import { useState, useEffect, useCallback } from 'react';
import './protocols-overview.css';

const API = '/api/scoring/protocols';

// ── Component ──────────────────────────────────────────────

export default function ProtocolsOverviewPage() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [expandedProtocol, setExpandedProtocol] = useState(null);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await fetch(API);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setData(await res.json());
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Auto-refresh every 10s (protocols may re-score every 10-60s)
  useEffect(() => {
    const interval = setInterval(load, 10_000);
    return () => clearInterval(interval);
  }, [load]);

  const protocols = data?.protocols ?? [];
  const scheduler = data?.scheduler ?? {};
  const activity = data?.recentActivity ?? [];

  const formatTime = (iso) => {
    if (!iso) return '—';
    try { return new Date(iso).toLocaleTimeString(); } catch { return iso; }
  };

  const formatDuration = (ms) => {
    if (ms == null) return '—';
    return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
  };

  const formatNextRun = (ms) => {
    if (ms == null) return '—';
    if (ms < 1000) return '< 1s';
    return `${(ms / 1000).toFixed(0)}s`;
  };

  const statusIcon = (status) => {
    switch (status) {
      case 'running': return '⚡';
      case 'idle': return '✅';
      case 'error': return '❌';
      case 'disabled': return '⏸';
      default: return '⬜';
    }
  };

  // ── Render ───────────────────────────────────────────────

  if (loading && !data) {
    return <div className="po-page"><div className="po-loading">Loading protocols...</div></div>;
  }

  return (
    <div className="po-page">
      {/* Header */}
      <div className="po-header">
        <h1>Protocols Overview</h1>
        <p className="po-subtitle">
          {protocols.length} protocol{protocols.length !== 1 ? 's' : ''} registered
          {scheduler.enabled && (
            <span className="po-scheduler-badge po-scheduler-on">
              ⚡ Auto-scoring every {formatDuration(scheduler.intervalMs)}
            </span>
          )}
          {!scheduler.enabled && (
            <span className="po-scheduler-badge po-scheduler-off">
              ⏸ Scheduler disabled
            </span>
          )}
        </p>
      </div>

      {/* Error */}
      {error && (
        <div className="po-error">
          <p>⚠️ {error}</p>
          <button type="button" className="po-retry-btn" onClick={load}>Retry</button>
        </div>
      )}

      {/* Scheduler status card */}
      <div className="po-scheduler-card">
        <div className="po-scheduler-row">
          <span className="po-scheduler-label">Background Scoring</span>
          <span className={`po-scheduler-value ${scheduler.isRunning ? 'po-running' : ''}`}>
            {scheduler.isRunning ? 'Running now...' : scheduler.enabled ? 'Idle' : 'Disabled'}
          </span>
        </div>
        <div className="po-scheduler-row">
          <span className="po-scheduler-label">Interval</span>
          <span className="po-scheduler-value">{formatDuration(scheduler.intervalMs)}</span>
        </div>
        <div className="po-scheduler-row">
          <span className="po-scheduler-label">Next run</span>
          <span className="po-scheduler-value">{formatNextRun(scheduler.nextRunIn)}</span>
        </div>
        {scheduler.lastRun && (
          <div className="po-scheduler-row">
            <span className="po-scheduler-label">Last run</span>
            <span className="po-scheduler-value">
              {scheduler.lastRun.symbolsScored} symbols in {formatDuration(scheduler.lastRun.durationMs)}
              {' · '}{formatTime(scheduler.lastRun.completedAt)}
            </span>
          </div>
        )}
      </div>

      {/* Protocols grid */}
      <div className="po-section">
        <h2>Protocols</h2>
        {protocols.length === 0 ? (
          <div className="po-empty">
            <p>No protocols configured yet.</p>
            <p className="po-empty-hint">Create your first protocol from the "Create Protocols" page.</p>
          </div>
        ) : (
          <div className="po-grid">
            {protocols.map((proto) => (
              <div
                key={proto.id}
                className={`po-card ${expandedProtocol === proto.id ? 'po-card-expanded' : ''}`}
              >
                <button
                  type="button"
                  className="po-card-header"
                  onClick={() => setExpandedProtocol(expandedProtocol === proto.id ? null : proto.id)}
                >
                  <span className="po-card-status">{statusIcon(proto.status)}</span>
                  <span className="po-card-name">{proto.name}</span>
                  <span className="po-card-dirs">{proto.directiveCount} directives</span>
                  <span className="po-card-max">max {proto.maxPossibleScore}</span>
                  <span className="po-card-expand">{expandedProtocol === proto.id ? '▾' : '▸'}</span>
                </button>

                {expandedProtocol === proto.id && (
                  <div className="po-card-body">
                    {proto.description && (
                      <p className="po-card-desc">{proto.description}</p>
                    )}
                    <div className="po-card-meta">
                      <div className="po-meta-row">
                        <span>Status</span>
                        <span className={`po-status-${proto.status}`}>{proto.status}</span>
                      </div>
                      <div className="po-meta-row">
                        <span>Max Score</span>
                        <span>{proto.maxPossibleScore}</span>
                      </div>
                      <div className="po-meta-row">
                        <span>Directives</span>
                        <span>{proto.directiveCount}</span>
                      </div>
                      <div className="po-meta-row">
                        <span>Last Run</span>
                        <span>{proto.lastRunAt ? formatTime(proto.lastRunAt) : 'Never'}</span>
                      </div>
                      <div className="po-meta-row">
                        <span>Created</span>
                        <span>{formatTime(proto.createdAt)}</span>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Activity feed */}
      <div className="po-section">
        <h2>Recent Activity</h2>
        {activity.length === 0 ? (
          <p className="po-empty-hint">No scoring activity recorded yet.</p>
        ) : (
          <div className="po-activity-feed">
            {activity.map((entry, i) => (
              <div key={i} className={`po-activity-entry po-activity-${entry.event}`}>
                <span className="po-activity-time">{formatTime(entry.timestamp)}</span>
                <span className="po-activity-event">
                  {entry.event === 'started' ? '▶' : entry.event === 'completed' ? '✅' : '❌'}
                </span>
                <span className="po-activity-name">{entry.protocolName}</span>
                <span className="po-activity-detail">
                  {entry.event === 'completed' && `${entry.symbolsScored ?? '?'} symbols · ${formatDuration(entry.durationMs)}`}
                  {entry.event === 'failed' && entry.error}
                  {entry.event === 'started' && 'Scoring started'}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Footer */}
      <p className="po-footer">
        Auto-refresh every 10s · <button type="button" className="po-refresh-link" onClick={load}>Refresh now</button>
      </p>
    </div>
  );
}
