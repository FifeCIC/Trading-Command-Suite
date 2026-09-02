/**
 * Monitoring settings — market tape, notifications, log retention.
 * Moved from SettingsPage (2026-09-02): everything that configures
 * observation surfaces lives here instead of cluttering General settings.
 */
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { usePreferences } from '../core/hooks/usePreferences';
import { apiGet, apiPost, apiPut, apiDelete } from '../core/api/client';
import './settings.css';

function SettingRow({ label, children, hint }) {
  return (
    <div className="setting-row">
      <div className="setting-info">
        <strong>{label}</strong>
        {hint && <p>{hint}</p>}
      </div>
      <div className="setting-control">{children}</div>
    </div>
  );
}

export default function MonitoringPage() {
  const { prefs, set } = usePreferences();

  return (
    <div className="settings-page">
      <header className="settings-header">
        <p>Monitoring configuration — market tape, notifications, and log retention.</p>
      </header>

      {/* ── Market Tape (header ticker) ── */}
      <section className="settings-section">
        <h2>Market Tape</h2>
        <SettingRow label="Globally-impacting headline" hint="Show the top-level (macro) news headline in the market tape.">
          <div className="inline-actions">
            <button
              type="button"
              className={prefs.newsTapeGlobal ? 'cta' : ''}
              onClick={() => set('newsTapeGlobal', !prefs.newsTapeGlobal)}
            >
              {prefs.newsTapeGlobal ? '✓ On' : 'Off'}
            </button>
          </div>
        </SettingRow>
        <SettingRow label="Symbol-priority headline" hint="Show a headline for symbols with open positions or actively scored (open positions first).">
          <div className="inline-actions">
            <button
              type="button"
              className={prefs.newsTapeSymbol ? 'cta' : ''}
              onClick={() => set('newsTapeSymbol', !prefs.newsTapeSymbol)}
            >
              {prefs.newsTapeSymbol ? '✓ On' : 'Off'}
            </button>
          </div>
        </SettingRow>
        <SettingRow label="Rotation interval" hint="Seconds between headline rotation in the tape.">
          <select value={prefs.newsTapeRotateSec} onChange={(e) => set('newsTapeRotateSec', Number(e.target.value))}>
            <option value={15}>15s</option>
            <option value={30}>30s</option>
            <option value={60}>60s</option>
            <option value={120}>2m</option>
          </select>
        </SettingRow>
      </section>

      {/* ── Logging / retention ── */}
      <section className="settings-section">
        <h2>Logging & Retention</h2>
        <SettingRow label="Log Retention" hint="Number of days to keep activity and audit logs.">
          <code>90</code>
        </SettingRow>
        <SettingRow label="Analytics Queue Purge" hint="How often local analytics events are purged (hours).">
          <code>24</code>
        </SettingRow>
        <SettingRow label="Cache TTL" hint="Default cache time-to-live for API responses (seconds).">
          <code>30</code>
        </SettingRow>
      </section>

      <NotificationSettingsSection />
    </div>
  );
}

/** Notifications — alert volume, auto-dismiss, cleanup. Moved from SettingsPage. */
function NotificationSettingsSection() {
  const qc = useQueryClient();
  const { data: count } = useQuery({
    queryKey: ['notif-settings-count'],
    queryFn: () => apiGet('/api/alerts/count').catch(() => ({ active: 0, critical: 0 })),
    refetchInterval: 30_000,
  });
  const { data: settings } = useQuery({
    queryKey: ['notif-settings'],
    queryFn: () => apiGet('/api/alerts/settings').catch(() => ({ maxAlerts: 200, autoDismissDays: 3, mutedTypes: [] })),
    staleTime: 60_000,
  });

  const activeCount = count?.active || 0;

  const handleDismissAll = async () => {
    const r = await apiPost('/api/alerts/dismiss-all').catch(() => null);
    if (r) qc.setQueryData(['notif-settings-count'], { active: 0, critical: 0 });
  };

  const handleCleanup = async (days) => {
    await apiDelete(`/api/alerts/cleanup?retainDays=${days}`).catch(() => null);
    qc.invalidateQueries({ queryKey: ['notif-settings-count'] });
  };

  const updateSetting = async (key, value) => {
    const body = { [key]: value };
    await apiPut('/api/alerts/settings', body).catch(() => {});
    qc.invalidateQueries({ queryKey: ['notif-settings'] });
  };

  return (
    <section className="settings-section">
      <h2>Notifications</h2>

      <SettingRow label="Active Alerts" hint={`${activeCount} alert${activeCount !== 1 ? 's' : ''} currently active. Dismiss clears all.`}>
        <div className="inline-actions">
          <code style={{ fontSize: '0.85rem', fontWeight: 700, color: activeCount > 50 ? '#ef4444' : activeCount > 0 ? '#f59e0b' : '#22c55e' }}>
            {activeCount}
          </code>
          <button type="button" className="cta" onClick={handleDismissAll} disabled={activeCount === 0}>
            Dismiss All
          </button>
        </div>
      </SettingRow>

      <SettingRow label="Max Alerts" hint="Maximum active alerts to keep. Older alerts are auto-dismissed.">
        <select
          className="settings-select"
          value={settings?.maxAlerts || 200}
          onChange={(e) => updateSetting('maxAlerts', parseInt(e.target.value, 10))}
        >
          <option value={50}>50</option>
          <option value={100}>100</option>
          <option value={200}>200</option>
          <option value={500}>500</option>
        </select>
      </SettingRow>

      <SettingRow label="Auto-Dismiss Days" hint="Alerts older than this are auto-dismissed.">
        <select
          className="settings-select"
          value={settings?.autoDismissDays || 3}
          onChange={(e) => updateSetting('autoDismissDays', parseInt(e.target.value, 10))}
        >
          <option value={1}>1 day</option>
          <option value={3}>3 days</option>
          <option value={7}>7 days</option>
          <option value={14}>14 days</option>
          <option value={30}>30 days</option>
        </select>
      </SettingRow>

      <SettingRow label="Cleanup Old Alerts" hint="Delete alerts older than the retention period (permanently removes from DB).">
        <div className="inline-actions">
          <button type="button" onClick={() => handleCleanup(3)}>Delete &gt;3d</button>
          <button type="button" onClick={() => handleCleanup(7)}>Delete &gt;7d</button>
          <button type="button" onClick={() => handleCleanup(30)}>Delete &gt;30d</button>
        </div>
      </SettingRow>

      <p style={{ fontSize: '0.65rem', color: 'var(--ink-soft)', fontStyle: 'italic', margin: '0.5rem 0 0' }}>
        Notifications aggregate from provider health, automation errors, MT5 bridge state, and API key warnings.
        Configure retention in the server's .env for persistent storage limits.
      </p>
    </section>
  );
}
