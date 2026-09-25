import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { apiGet } from '../core/api/client';
import PageInfoPopover from '../components/PageInfoPopover';
import { normaliseAlert } from '../core/alerts';
import './alert-center.css';

const TYPE_COLORS = {
  signal: '#4ade80', drawdown: '#f87171', daily: '#fbbf24',
  backtest: '#60a5fa', system: '#94a3b8', trading: '#a78bfa',
};

/** Category → colour band when the API gives no usable level. */
const SEVERITY_LEVELS = {
  drawdown: 'high', system: 'medium', signal: 'low',
  daily: 'low', trading: 'medium', backtest: 'low',
};
/** API level (6 values) → the 3 colour bands this page renders. */
const LEVEL_SEVERITY = {
  critical: 'high', high: 'high',
  warning: 'medium', medium: 'medium',
  info: 'low', low: 'low',
};
const SEVERITY_COLORS = { high: '#ef4444', medium: '#f59e0b', low: '#64748b' };

// Fallback routes by alert type
const TYPE_FALLBACKS = {
  // §9.14 — `/scoring/live-ordering-stack` (the Ladder) is PREMIUM. A free user is sent to the same
  // fallback a daily alert uses, rather than to a path that does not exist. The Vite define folds
  // at build time, so the premium path never reaches the free bundle.
  signal: import.meta.env.VITE_EDITION === 'free' ? '/dashboard' : '/scoring/live-ordering-stack',
  drawdown: '/trading/portfolio-overview',
  backtest: '/training/backtest',
  system: '/status/setup',
  daily: '/dashboard',
};

/** Deduplicate consecutive identical alerts (normalised fields only) */
function dedupeAlerts(raw) {
  if (!raw?.length) return [];
  const result = [];
  let prev = null;
  for (const a of raw) {
    const key = `${a.category || ''}|${a.title || ''}|${a.message || ''}`;
    if (prev && prev.key === key) {
      prev.count = (prev.count || 1) + 1;
      prev.timestamps.push(a.time || a.timestamp || '');
    } else {
      const entry = { ...a, key, count: 1, timestamps: [a.time || a.timestamp || ''] };
      result.push(entry);
      prev = entry;
    }
  }
  return result;
}

export default function AlertCenterPage() {
  const navigate = useNavigate();
  const [filter, setFilter] = useState('all');
  const [readIds, setReadIds] = useState(new Set());
  const [expandedId, setExpandedId] = useState(null);
  const [showR3NK, setShowR3NK] = useState(true);

  const alertsQuery = useQuery({
    queryKey: ['alerts'],
    queryFn: () => apiGet('/api/alerts/active').catch(() => []),
    staleTime: 10_000,
    refetchInterval: 30_000,
  });

  // Rows arrive in two column layouts (see src/core/alerts.js) — normalise
  // once here so every read below gets a trustworthy title/category/level.
  const rawAlerts = useMemo(
    () => (alertsQuery.data || []).map(normaliseAlert),
    [alertsQuery.data]
  );
  const MAX_ALERTS = 200;

  // Deduplicate consecutive identical alerts, then apply filters
  const alerts = useMemo(() => {
    let list = dedupeAlerts(rawAlerts);
    // Filter out R3NK if toggled off
    if (!showR3NK) {
      list = list.filter(a => !`${a.title} ${a.message}`.toLowerCase().includes('r3nk'));
    }
    // Limit
    if (list.length > MAX_ALERTS) list = list.slice(0, MAX_ALERTS);
    return list.map(a => ({ ...a, read: readIds.has(a.id) }));
  }, [rawAlerts, readIds, showR3NK]);

  const filtered = filter === 'all' ? alerts : alerts.filter(a => a.category === filter);
  const unread = alerts.filter(a => !a.read).length;
  const totalRaw = rawAlerts.length;

  const markRead = (id) => setReadIds(prev => new Set([...prev, id]));
  const markAllRead = () => setReadIds(new Set(alerts.map(a => a.id)));

  const handleAlertClick = (alert) => {
    markRead(alert.id);
    if (alert.ticker) {
      navigate(`/research/symbol/${alert.ticker}`);
    } else if (alert.link) {
      window.location.href = alert.link;
    } else {
      const fallback = TYPE_FALLBACKS[alert.category];
      if (fallback) navigate(fallback);
    }
  };

  const typeCounts = useMemo(() => {
    const counts = {};
    for (const a of alerts) { counts[a.category] = (counts[a.category] || 0) + 1; }
    return counts;
  }, [alerts]);

  return (
    <div className="ac-page">
      <header className="ac-header">
        <h1>Alert Center
          <PageInfoPopover>
            Central alert hub for trading signals, drawdown warnings, system events, and backtest results.
            Consecutive identical alerts are merged with a count. Use the R3NK toggle to filter automated risk alerts.
          </PageInfoPopover>
        </h1>
        <div className="ac-header-stats">
          <span className="ac-unread-badge">{totalRaw > MAX_ALERTS ? `${MAX_ALERTS}+` : totalRaw}</span>
          <span className="ac-unread-label">{unread} unread</span>
          <button className="ac-mark-all-btn" onClick={markAllRead}>Mark All Read</button>
        </div>
      </header>

      <div className="ac-controls">
        <div className="ac-tabs">
          {['all', 'signal', 'drawdown', 'daily', 'system', 'trading'].map(f => (
            <button
              key={f}
              className={`ac-tab ${filter === f ? 'ac-tab-active' : ''}`}
              onClick={() => setFilter(f)}
            >
              {f.toUpperCase()}
              {f !== 'all' && typeCounts[f] ? <span className="ac-tab-count">{typeCounts[f]}</span> : null}
            </button>
          ))}
        </div>
        <label className="ac-r3nk-toggle">
          <input type="checkbox" checked={showR3NK} onChange={() => setShowR3NK(!showR3NK)} />
          Show R3NK
        </label>
      </div>

      {totalRaw > MAX_ALERTS && (
        <div className="ac-limit-banner">
          Showing {MAX_ALERTS} of {totalRaw} alerts. Older alerts are hidden.
        </div>
      )}

      <div className="ac-alert-list">
        {filtered.length === 0 && !alertsQuery.isLoading && (
          <div className="ac-empty">No alerts match this filter.</div>
        )}
        {alertsQuery.isLoading && <div className="ac-empty">Loading alerts…</div>}
        {filtered.map(a => {
          const severity = LEVEL_SEVERITY[a.level] || SEVERITY_LEVELS[a.category] || 'low';
          const sevColor = SEVERITY_COLORS[severity];
          const isExpanded = expandedId === a.id;

          return (
            <div
              key={a.id}
              className={`ac-alert-card ${a.read ? 'ac-read' : ''} ac-sev-${severity}`}
              onClick={() => handleAlertClick(a)}
            >
              <div className="ac-alert-row">
                <span className="ac-severity-dot" style={{ background: sevColor }} title={`Severity: ${a.level}`} />
                <span className="ac-alert-type" style={{ color: TYPE_COLORS[a.category] || '#94a3b8' }}>
                  {a.category}
                </span>
                <strong className="ac-alert-title">
                  {!a.read && <span className="ac-unread-dot">●</span>}
                  {a.title}
                </strong>
                {a.count > 1 && (
                  <span
                    className="ac-dup-badge"
                    onClick={(e) => { e.stopPropagation(); setExpandedId(isExpanded ? null : a.id); }}
                    title="Consecutive duplicate — click to expand"
                  >
                    ×{a.count}
                  </span>
                )}
                <span className="ac-alert-time">{a.time}</span>
              </div>
              <p className="ac-alert-detail">{a.message || a.detail}</p>

              {/* Duplicate timestamps accordion */}
              {isExpanded && a.timestamps?.length > 1 && (
                <div className="ac-dup-list">
                  {a.timestamps.map((ts, i) => (
                    <div key={i} className="ac-dup-item">
                      <span>#{i + 1}</span>
                      <span>{ts}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <p className="ac-footer">
        {filtered.length} shown · {totalRaw} raw alerts · auto-refresh 30s
      </p>
    </div>
  );
}
