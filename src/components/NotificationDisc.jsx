/**
 * NotificationDisc — header bell icon with dropdown notification list.
 *
 * Aggregates notifications from multiple sources:
 *   - Provider health changes (connect/disconnect/error)
 *   - Automation loop errors (repeated failures)
 *   - Bridge state changes
 *   - API key warnings
 *
 * Each notification has severity (critical/warning/info), timestamp, and optional action.
 */
import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiGet } from '../core/api/client';
import './notification-disc.css';

const SEVERITY = {
  critical: { color: '#ef4444', icon: '🔴', label: 'Critical' },
  warning:  { color: '#f59e0b', icon: '🟡', label: 'Warning' },
  info:     { color: '#3b82f6', icon: '🔵', label: 'Info' },
  success:  { color: '#22c55e', icon: '🟢', label: 'Success' },
};

function timeAgo(iso) {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  const s = Math.floor(diff / 1000);
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return m + 'm ago';
  const h = Math.floor(m / 60);
  if (h < 24) return h + 'h ago';
  return Math.floor(h / 24) + 'd ago';
}

export default function NotificationDisc() {
  const [open, setOpen] = useState(false);
  const [dismissed, setDismissed] = useState(new Set());

  // ── Provider health ──
  const healthQuery = useQuery({
    queryKey: ['notif-health'],
    queryFn: () => apiGet('/api/providers/health').catch(() => null),
    refetchInterval: 60_000,
  });

  // ── Automation status ──
  const autoQuery = useQuery({
    queryKey: ['notif-auto'],
    queryFn: () => apiGet('/api/automation/status').catch(() => null),
    refetchInterval: 30_000,
  });

  // ── Build notifications from data ──
  const notifications = useMemo(() => {
    const items = [];
    const now = new Date().toISOString();

    // 1. Provider health issues
    const providers = healthQuery.data?.providers || [];
    providers.forEach(p => {
      if (p.status === 'degraded') {
        items.push({
          id: `prov-${p.provider}-degraded`,
          severity: 'warning',
          title: `${p.displayName} degraded`,
          detail: p.message || 'Provider performance degraded',
          timestamp: p.checkedAt || now,
          action: `/status/status`,
        });
      }
      if (p.status === 'error' || p.status === 'unreachable') {
        items.push({
          id: `prov-${p.provider}-down`,
          severity: 'critical',
          title: `${p.displayName} unreachable`,
          detail: p.message || 'Provider is not responding',
          timestamp: p.checkedAt || now,
          action: `/status/status`,
        });
      }
    });

    // 2. Automation loop errors
    const recentDecisions = autoQuery.data?.recentDecisions || [];
    const errorDecisions = recentDecisions.filter(d => d.decision === 'ERROR' || d.decision === 'BLOCKED');
    if (errorDecisions.length > 0) {
      items.push({
        id: 'auto-recent-errors',
        severity: 'warning',
        title: `${errorDecisions.length} automation error${errorDecisions.length > 1 ? 's' : ''}`,
        detail: errorDecisions.slice(0, 3).map(d => `${d.symbol}: ${d.reason}`).join('; '),
        timestamp: now,
        action: `/automation/automation-dashboard`,
      });
    }

    // 3. Bridge offline
    const mt5Prov = providers.find(p => p.provider === 'mt5');
    if (mt5Prov && mt5Prov.status !== 'healthy' && mt5Prov.status !== 'connected') {
      items.push({
        id: 'bridge-offline',
        severity: 'critical',
        title: 'MT5 Bridge offline',
        detail: mt5Prov.message || 'Bridge is not responding — trading paused',
        timestamp: mt5Prov.checkedAt || now,
        action: `/status/mt5-status`,
      });
    }

    // 4. API key warnings
    const missingCreds = providers.filter(p => p.status === 'missing-credentials');
    if (missingCreds.length > 0) {
      items.push({
        id: 'api-keys-missing',
        severity: 'info',
        title: `${missingCreds.length} provider${missingCreds.length > 1 ? 's' : ''} unconfigured`,
        detail: missingCreds.map(p => p.displayName).join(', ') + ' — missing API credentials',
        timestamp: now,
        action: `/settings/settings`,
      });
    }

    return items;
  }, [healthQuery.data, autoQuery.data]);

  const visibleNotifications = notifications.filter(n => !dismissed.has(n.id));
  const criticalCount = visibleNotifications.filter(n => n.severity === 'critical').length;
  const totalUnread = visibleNotifications.length;

  const handleDismiss = (id, e) => {
    e.stopPropagation();
    setDismissed(prev => new Set([...prev, id]));
  };

  const handleDismissAll = () => {
    setDismissed(new Set(notifications.map(n => n.id)));
  };

  return (
    <div className="notif-disc">
      <button
        type="button"
        className={`notif-bell ${open ? 'active' : ''} ${criticalCount > 0 ? 'has-critical' : ''}`}
        onClick={() => setOpen(!open)}
        aria-label={`Notifications — ${totalUnread} unread`}
        title={`${totalUnread} notification${totalUnread !== 1 ? 's' : ''}`}
      >
        <svg className="notif-svg-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.73 21a2 2 0 0 1-3.46 0" />
        </svg>
        {totalUnread > 0 && (
          <span className="notif-badge">{totalUnread}</span>
        )}
      </button>

      {open && (
        <>
          <div className="notif-backdrop" onClick={() => setOpen(false)} />
          <div className="notif-dropdown">
            <div className="notif-header">
              <h3>Notifications</h3>
              {totalUnread > 0 && (
                <button className="notif-dismiss-all" onClick={handleDismissAll}>
                  Clear all
                </button>
              )}
            </div>

            {visibleNotifications.length === 0 ? (
              <p className="notif-empty">All clear — no notifications.</p>
            ) : (
              <div className="notif-list">
                {visibleNotifications.map(n => {
                  const sev = SEVERITY[n.severity];
                  return (
                    <div key={n.id} className={`notif-item notif-${n.severity}`}>
                      <div className="notif-item-left">
                        <span className="notif-severity-dot" style={{ color: sev.color }} title={sev.label}>
                          {sev.icon}
                        </span>
                        <div className="notif-item-body">
                          <strong className="notif-item-title">{n.title}</strong>
                          <span className="notif-item-detail">{n.detail}</span>
                          <span className="notif-item-time">{timeAgo(n.timestamp)}</span>
                        </div>
                      </div>
                      <div className="notif-item-actions">
                        {n.action && (
                          <a href={n.action} className="notif-action-link" title="Go to related page">
                            →
                          </a>
                        )}
                        <button
                          className="notif-dismiss-btn"
                          onClick={(e) => handleDismiss(n.id, e)}
                          title="Dismiss"
                        >
                          ✕
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
