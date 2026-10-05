/**
 * Monitoring settings — market tape, notifications, log retention.
 * Moved from SettingsPage (2026-09-02): everything that configures
 * observation surfaces lives here instead of cluttering General settings.
 */
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { usePreferences } from '../core/hooks/usePreferences';
import { apiGet, apiPost, apiPut, apiDelete } from '../core/api/client';
// ⚠️ SETTINGS SAVES GO THROUGH THE NOTICE REGISTRY, NOT INLINE PROSE.
// Three `setSaveError(\`… was NOT saved — ${err?.message}\`)` sites were the last raw error renders on
// this page and held the build red (#826 Phase 5 gate). `noticeFromError` keeps the server's own
// text as `detail` and gives the failure an identity that joins a log line to an issue.
import { noticeFromError } from '../core/notices/from-error.js';
import NoticeBlock from '../components/NoticeBlock';
import './settings.css';

const ALL_CHANNELS = ['windows', 'telegram', 'discord', 'email'];
const PRIORITIES = ['critical', 'high', 'normal', 'low'];
/** The three depth levels. `simple` is the default because it is the CURRENT behaviour. */
const DETAIL_LEVELS = [
  { id: 'simple', label: 'Simple', hint: 'Title and body — what the app sends today.' },
  { id: 'detailed', label: 'Detailed', hint: 'Adds the instrument and the strategy behind the signal.' },
  { id: 'advanced', label: 'Advanced', hint: 'Adds scores and richer styling.' },
];

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
      <NotificationDeliverySection />
    </div>
  );
}

/**
 * Notification DELIVERY — how much a notification says, how loud it must be to arrive, and which
 * channels carry which event.
 *
 * ⚠️ WHY THIS EXISTS (2026-10-05). The backend has had per-event preferences and a priority floor
 * since #972, reachable at `GET|PUT /api/notifications/preferences` — and NOTHING in the app called
 * them. Measured that day: no file under `src/` referenced those routes, so the owner asked for these
 * settings believing they already existed. They existed as an API with no surface — a buried ability.
 *
 * ⚠️ TWO WRITE PATHS, DELIBERATELY, and the difference is not cosmetic. The FLOOR goes through
 * `/api/notifications/min-priority` because that route also refreshes the running service's in-memory
 * floor; a registry-only write would persist the value and leave the live process on the old one until
 * the next restart — the "saved but nothing changed" defect this whole area was fixed for. The DETAIL
 * LEVEL has no runtime copy anywhere, so it is written straight to the settings registry.
 *
 * ⚠️ A `mandatory` EVENT IS RENDERED LOCKED, WITH THE REASON ON SCREEN. The backend refuses
 * `enabled: false` for these (`trade-disabled`) because muting it reproduces the outage it exists for:
 * AutoTrading off for days, 19 orders refused, every bridge reporting `connected`, nobody told.
 * Offering a control the server quietly ignores is worse than not offering one — it teaches the owner
 * to distrust every other control on the page.
 *
 * ⚠️ THE EVENT LIST CANNOT BE READ AS "NOTHING CONFIGURED". A failed request and an empty list are
 * rendered as different states below, because collapsing them is how "could not ask" becomes "none".
 */
function NotificationDeliverySection() {
  const qc = useQueryClient();
  const [saving, setSaving] = useState(false);
  /**
   * ⚠️ A FAILED SAVE MUST LOOK LIKE ONE. The first cut of this section ended every write with
   * `.catch(() => {})`, which made an API that REFUSED the value look identical to one that accepted
   * it — the control flips, nothing is stored, and the next refetch silently reverts it. That is the
   * precise failure this whole settings area was opened to fix, so replaying it here would have been
   * self-defeating. Measured 2026-10-05 why it matters immediately: until the API is rebuilt, the
   * `notifications.detailLevel` key is NOT DECLARED in the running build, the write is refused, and
   * without this state the button would have looked like it worked.
   */
  const [saveError, setSaveError] = useState(null);

  const { data: prefs, isLoading } = useQuery({
    queryKey: ['notif-delivery-prefs'],
    queryFn: () => apiGet('/api/notifications/preferences').catch(() => null),
    staleTime: 60_000,
  });

  // The floor and the detail level are DECLARED settings, so the registry reports both the effective
  // value and where it came from — "db" means someone set it, "default" means nobody has.
  const { data: registry } = useQuery({
    queryKey: ['settings-registry'],
    queryFn: () => apiGet('/api/system/settings/registry').catch(() => null),
    staleTime: 60_000,
  });

  const settingByKey = (key) => registry?.settings?.find((s) => s.key === key);
  const detailLevel = String(settingByKey('notifications.detailLevel')?.value ?? 'simple');
  const floor = String(settingByKey('notifications.minPriority')?.value ?? 'low');
  const events = Array.isArray(prefs) ? prefs : [];

  const savePrefs = async (next) => {
    qc.setQueryData(['notif-delivery-prefs'], next);
    setSaving(true);
    setSaveError(null);
    try {
      await apiPut('/api/notifications/preferences', next);
    } catch (err) {
        setSaveError(noticeFromError(err, 'TCS-SYS-007', { operation: 'save the delivery rules' }));
      qc.invalidateQueries({ queryKey: ['notif-delivery-prefs'] });
    } finally {
      setSaving(false);
      qc.invalidateQueries({ queryKey: ['notif-delivery-prefs'] });
    }
  };

  const patchEvent = (event, patch) =>
    savePrefs(events.map((p) => (p.event === event ? { ...p, ...patch } : p)));

  const toggleChannel = (pref, channel) => {
    const current = pref.channels || [];
    const channels = current.includes(channel)
      ? current.filter((c) => c !== channel)
      : [...current, channel];
    // ⚠️ An empty list means "delivered nowhere", which IS a mute — and a mute has its own control.
    // Refusing the last removal keeps "which channels" and "on or off" from becoming one idea.
    if (!channels.length) return;
    patchEvent(pref.event, { channels });
  };

  const setDetail = async (value) => {
    setSaveError(null);
    try {
      await apiPut('/api/system/settings/registry/notifications.detailLevel', { value });
    } catch (err) {
      // ⚠️ Named with the cause, because "not declared in settings-registry.ts" is the likely one on a
      // stale build and it is indistinguishable from a broken button without being told.
        setSaveError(noticeFromError(err, 'TCS-SYS-007', { operation: 'save the detail level' }));
    }
    qc.invalidateQueries({ queryKey: ['settings-registry'] });
  };

  const setFloor = async (value) => {
    setSaveError(null);
    try {
      await apiPut('/api/notifications/min-priority', { minPriority: value });
    } catch (err) {
        setSaveError(noticeFromError(err, 'TCS-SYS-007', { operation: 'save the delivery floor' }));
    }
    qc.invalidateQueries({ queryKey: ['settings-registry'] });
  };

  return (
    <section className="settings-section">
      <h2>Notification Delivery</h2>

      <SettingRow
        label="Detail level"
        hint="How much a notification says. Simple is what the app sends today; the deeper levels add trading context. Applies to the Windows toast."
      >
        <div className="inline-actions">
          {DETAIL_LEVELS.map((d) => (
            <button
              key={d.id}
              type="button"
              className={detailLevel === d.id ? 'cta' : ''}
              title={d.hint}
              onClick={() => setDetail(d.id)}
            >
              {d.label}
            </button>
          ))}
        </div>
      </SettingRow>

      <SettingRow
        label="Delivery floor"
        hint="Nothing quieter than this is delivered on any channel. 'Critical' is what mutes routine traffic; the required event below is exempt from the floor."
      >
        <select value={floor} onChange={(e) => setFloor(e.target.value)}>
          {PRIORITIES.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
      </SettingRow>

      {isLoading ? (
        <SettingRow label="Delivery rules" hint="Loading…">
          <span />
        </SettingRow>
      ) : events.length === 0 ? (
        <SettingRow
          label="Delivery rules"
          hint="Could not read the delivery rules — the API did not answer. This is NOT 'no events configured'."
        >
          <span />
        </SettingRow>
      ) : (
        events.map((pref) => (
          <SettingRow
            key={pref.event}
            label={pref.event}
            hint={
              pref.mandatory
                ? 'Always delivered — this event cannot be muted. Silencing it is how the overnight outage went unnoticed.'
                : pref.minPriority
                  ? `Suppressed when the floor is above ${pref.minPriority}.`
                  : undefined
            }
          >
            <div className="inline-actions">
              {pref.mandatory ? (
                // Rendered as text, not a disabled button: a greyed control still reads as "click me
                // once you find the trick", whereas a stated fact does not.
                <code>always on</code>
              ) : (
                <button
                  type="button"
                  className={pref.enabled ? 'cta' : ''}
                  onClick={() => patchEvent(pref.event, { enabled: !pref.enabled })}
                >
                  {pref.enabled ? '✓ On' : 'Off'}
                </button>
              )}
              <select
                value={pref.priority}
                onChange={(e) => patchEvent(pref.event, { priority: e.target.value })}
              >
                {PRIORITIES.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
              {ALL_CHANNELS.map((c) => (
                <button
                  key={c}
                  type="button"
                  className={(pref.channels || []).includes(c) ? 'cta' : ''}
                  onClick={() => toggleChannel(pref, c)}
                >
                  {c}
                </button>
              ))}
            </div>
          </SettingRow>
        ))
      )}

      {saveError && (
        <div role="alert">
          <NoticeBlock notice={saveError} compact />
        </div>
      )}
      {saving && <p>Saving…</p>}
    </section>
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
