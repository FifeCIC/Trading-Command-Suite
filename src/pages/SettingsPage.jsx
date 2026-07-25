import { useUiStore } from '../stores/useUiStore';
import { usePreferences } from '../core/hooks/usePreferences';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiPost, apiPut, apiDelete } from '../core/api/client';
import './settings.css'

function SettingRow({ label, children, hint }) {
  return (
    <div className="setting-row">
      <div className="setting-info">
        <strong>{label}</strong>
        {hint && <p>{hint}</p>}
      </div>
      <div className="setting-control">{children}</div>
    </div>
  )
}

export default function SettingsPage() {
  const themeMode = useUiStore((state) => state.themeMode);
  const setThemeMode = useUiStore((state) => state.setThemeMode);
  const themePack = useUiStore((state) => state.themePack);
  const showNavIcons = useUiStore((state) => state.showNavIcons);
  const setShowNavIcons = useUiStore((state) => state.setShowNavIcons);
  const qaChecks = useUiStore((state) => state.qaChecks || {});
  const resetQaChecks = useUiStore((state) => state.resetQaChecks);
  const qaCount = Object.keys(qaChecks).length;

  const { prefs, set, setMany, reset: resetPrefs, defaults } = usePreferences();

  const riskLimitsQuery = useQuery({
    queryKey: ['trading-risk-limits'],
    queryFn: () => apiGet('/api/trading/strategies/risk-limits').catch(() => null),
    staleTime: 300_000,
    retry: 1,
  });
  const serverLimits = riskLimitsQuery.data;

  return (
    <div className="settings-page">
      <header className="settings-header">
        <p>Application configuration. More options will appear as features are built.</p>
      </header>

      <section className="settings-section">
        <h2>API Connection</h2>
        <SettingRow label="Backend URL" hint="The NestJS API endpoint the frontend calls.">
          <code>http://localhost:3201</code>
        </SettingRow>
        <SettingRow label="Auto-refresh" hint="How often live data panels refresh (seconds).">
          <code>30</code>
        </SettingRow>
      </section>

      <section className="settings-section">
        <h2>Database</h2>
        <SettingRow label="Engine" hint="Currently using MySQL via Prisma 5.">
          <code>MySQL 9.1 (WAMP)</code>
        </SettingRow>
        <SettingRow label="Database" hint="Database name and host.">
          <code>tradingcs@localhost:3306</code>
        </SettingRow>
      </section>

      <section className="settings-section">
        <h2>Queue</h2>
        <SettingRow label="Queue Mode" hint="Set QUEUE_MODE in nest/.env. Off means no background processing.">
          <code>off</code>
        </SettingRow>
      </section>

      <section className="settings-section">
        <h2>Theme</h2>
        <SettingRow label="Mode" hint="Light, dark, or pure black background.">
          <div className="inline-actions">
            <button
              type="button"
              className={themeMode === 'light' ? 'cta' : ''}
              onClick={() => setThemeMode('light')}
            >
              ☀ Light
            </button>
            <button
              type="button"
              className={themeMode === 'dark' ? 'cta' : ''}
              onClick={() => setThemeMode('dark')}
            >
              🌙 Dark
            </button>
            <button
              type="button"
              className={themeMode === 'black' ? 'cta' : ''}
              onClick={() => setThemeMode('black')}
            >
              ⬛ Black
            </button>
          </div>
        </SettingRow>
        <SettingRow label="Pack" hint="Active theme pack ID.">
          <code>{themePack}</code>
        </SettingRow>
        <SettingRow label="Navigation Icons" hint="Show category icons on the right side of sidebar menu items.">
          <div className="inline-actions">
            <button
              type="button"
              className={showNavIcons ? 'cta' : ''}
              onClick={() => setShowNavIcons(true)}
            >
              ◉ Show
            </button>
            <button
              type="button"
              className={!showNavIcons ? 'cta' : ''}
              onClick={() => setShowNavIcons(false)}
            >
              ✕ Hide
            </button>
          </div>
        </SettingRow>
      </section>

      <section className="settings-section">
        <h2>QA Testing</h2>
        <SettingRow label="QA Checks" hint={`${qaCount} page${qaCount !== 1 ? 's' : ''} marked as QA tested on the Capability Map.`}>
          <button
            type="button"
            className="cta"
            onClick={() => { if (qaCount === 0 || window.confirm(`Reset ${qaCount} QA check${qaCount !== 1 ? 's' : ''}?`)) resetQaChecks(); }}
            disabled={qaCount === 0}
            style={qaCount === 0 ? { opacity: 0.4, cursor: 'not-allowed' } : {}}
          >
            ↺ Reset QA Checks
          </button>
        </SettingRow>
      </section>

      <section className="settings-section">
        <h2>User Preferences</h2>
        <p className="settings-section-desc">Customize defaults for the new Signals, Risk, and Research features.</p>

        <SettingRow label="Default Signal Symbols" hint="Comma-separated tickers pre-filled in Scoring Workbench.">
          <input
            type="text"
            className="settings-input"
            value={prefs.defaultSignalSymbols}
            onChange={e => set('defaultSignalSymbols', e.target.value)}
            placeholder="AAPL, NVDA, MSFT"
          />
        </SettingRow>

        <SettingRow label="Default Protocol" hint="Pre-selected protocol in Scoring Workbench and SEES pages.">
          <input
            type="text"
            className="settings-input"
            value={prefs.defaultProtocol}
            onChange={e => set('defaultProtocol', e.target.value)}
            placeholder="btc-speed-v1"
          />
        </SettingRow>

        <SettingRow label="Signals Auto-Refresh" hint="Auto-refresh the signal ladder at the interval below.">
          <div className="inline-actions">
            <button type="button" className={prefs.signalsAutoRefresh ? 'cta' : ''} onClick={() => set('signalsAutoRefresh', true)}>On</button>
            <button type="button" className={!prefs.signalsAutoRefresh ? 'cta' : ''} onClick={() => set('signalsAutoRefresh', false)}>Off</button>
          </div>
        </SettingRow>

        <SettingRow label="Signals Refresh (s)" hint="Auto-refresh interval for signal ladder.">
          <input
            type="number" min="10" max="300" step="5"
            className="settings-input settings-input-sm"
            value={Math.round(prefs.signalsRefreshInterval / 1000)}
            onChange={e => set('signalsRefreshInterval', Math.max(10000, parseInt(e.target.value, 10) * 1000))}
          />
        </SettingRow>

        <SettingRow label="Research Refresh (s)" hint="Auto-refresh interval for Research Overview dashboard.">
          <input
            type="number" min="10" max="300" step="5"
            className="settings-input settings-input-sm"
            value={Math.round(prefs.researchRefreshInterval / 1000)}
            onChange={e => set('researchRefreshInterval', Math.max(10000, parseInt(e.target.value, 10) * 1000))}
          />
        </SettingRow>

        <h3 className="settings-subheading">Risk Limits</h3>

        <SettingRow label="Max Drawdown (%)" hint="Circuit breaker trips when drawdown exceeds this.">
          <input
            type="number" min="5" max="50" step="1"
            className="settings-input settings-input-sm"
            value={prefs.riskMaxDrawdown}
            onChange={e => set('riskMaxDrawdown', parseInt(e.target.value, 10) || 25)}
          />
        </SettingRow>

        <SettingRow label="Max Positions" hint="Maximum number of concurrent open positions.">
          <input
            type="number" min="1" max="20" step="1"
            className="settings-input settings-input-sm"
            value={prefs.riskMaxPositions}
            onChange={e => set('riskMaxPositions', parseInt(e.target.value, 10) || 5)}
          />
        </SettingRow>

        <SettingRow label="Max Per Symbol (%)" hint="Maximum portfolio allocation to a single symbol.">
          <input
            type="number" min="5" max="100" step="5"
            className="settings-input settings-input-sm"
            value={prefs.riskMaxPerSymbol}
            onChange={e => set('riskMaxPerSymbol', parseInt(e.target.value, 10) || 25)}
          />
        </SettingRow>

        <SettingRow label="Max Per Trade Risk (%)" hint="Maximum portfolio risk per individual trade.">
          <input
            type="number" min="1" max="10" step="0.5"
            className="settings-input settings-input-sm"
            value={prefs.riskMaxPerTrade}
            onChange={e => set('riskMaxPerTrade', parseFloat(e.target.value) || 2)}
          />
        </SettingRow>

        <SettingRow label="CB Drawdown Trigger (%)" hint="Circuit breaker trips at this drawdown level.">
          <input
            type="number" min="5" max="40" step="1"
            className="settings-input settings-input-sm"
            value={prefs.circuitBreakerDrawdownTrigger}
            onChange={e => set('circuitBreakerDrawdownTrigger', parseInt(e.target.value, 10) || 20)}
          />
        </SettingRow>

        <SettingRow label="CB Exposure Trigger (%)" hint="Circuit breaker trips when total exposure exceeds this.">
          <input
            type="number" min="20" max="100" step="5"
            className="settings-input settings-input-sm"
            value={prefs.circuitBreakerExposureTrigger}
            onChange={e => set('circuitBreakerExposureTrigger', parseInt(e.target.value, 10) || 80)}
          />
        </SettingRow>

        {serverLimits && (
          <>
            <h3 className="settings-subheading">Server-Enforced Hard Limits</h3>
            <p className="settings-hint-text">
              These are set in <code>nest/.env</code> and require a server restart to change.
              Strategies and UI settings cannot override them.
            </p>
            <SettingRow label="Max Position Size (lots)" hint="Hard cap on any single position volume.">
              <code className="settings-limit-value">{serverLimits.maxPositionSize}</code>
            </SettingRow>
            <SettingRow label="Max Daily Loss ($)" hint="Trading halts if today's P&L drops below this.">
              <code className="settings-limit-value settings-limit-danger">${serverLimits.maxDailyLoss}</code>
            </SettingRow>
            <SettingRow label="Max Open Positions" hint="Absolute cap on concurrent positions across all strategies.">
              <code className="settings-limit-value">{serverLimits.maxOpenPositions}</code>
            </SettingRow>
            {serverLimits.note && (
              <p className="settings-note">
                ℹ️ {serverLimits.note}
              </p>
            )}
          </>
        )}

        <SettingRow label="Reset Preferences" hint="Restore all preferences to their default values.">
          <button type="button" className="cta" onClick={() => { if (window.confirm('Reset all preferences to defaults?')) resetPrefs(); }}>
            ↺ Reset to Defaults
          </button>
        </SettingRow>
      </section>

      <section className="settings-section">
        <h2>Data Retention</h2>
        <SettingRow label="Analytics Queue Purge" hint="How often local analytics events are purged (hours).">
          <code>24</code>
        </SettingRow>
        <SettingRow label="Cache TTL" hint="Default cache time-to-live for API responses (seconds).">
          <code>30</code>
        </SettingRow>
        <SettingRow label="Log Retention" hint="Number of days to keep activity and audit logs.">
          <code>90</code>
        </SettingRow>
      </section>

      <section className="settings-section">
        <h2>Display</h2>
        <SettingRow label="Default Timeframe" hint="Default chart timeframe for Speed Charts and scanners.">
          <select className="settings-select" value={prefs.defaultTimeframe} onChange={e => set('defaultTimeframe', e.target.value)}>
            {['1m','5m','15m','30m','1h','4h','1d','1w'].map(tf => <option key={tf} value={tf}>{tf}</option>)}
          </select>
        </SettingRow>
        <SettingRow label="Decimal Places" hint="Number of decimal places for price display.">
          <input type="number" min="0" max="6" step="1" className="settings-input settings-input-sm"
            value={prefs.decimalPlaces} onChange={e => set('decimalPlaces', parseInt(e.target.value, 10) || 2)} />
        </SettingRow>
        <SettingRow label="Compact Mode" hint="Reduce padding and font sizes for higher information density.">
          <div className="inline-actions">
            <button type="button" className={prefs.compactMode ? 'cta' : ''} onClick={() => set('compactMode', true)}>On</button>
            <button type="button" className={!prefs.compactMode ? 'cta' : ''} onClick={() => set('compactMode', false)}>Off</button>
          </div>
        </SettingRow>

        <SettingRow label="Experience Level" hint="Controls which views and features are visible. Beginner hides advanced tools. Expert unlocks everything.">
          <select
            className="settings-select"
            value={prefs.experienceLevel || 'beginner'}
            onChange={e => set('experienceLevel', e.target.value)}
          >
            <option value="beginner">Beginner — core pages, simplified trading</option>
            <option value="experienced">Experienced — scoring, strategies, research</option>
            <option value="expert">Expert — full access, automation, builder tools</option>
          </select>
        </SettingRow>
      </section>

      <section className="settings-section">
        <h2>Automation</h2>
        <SettingRow label="Auto-Start on Server Boot" hint="When ON, the automation loop and MT5 trading state are restored automatically when the server starts. When OFF, you must manually start via the Automation Dashboard.">
          <div className="inline-actions">
            <button type="button" className={prefs.autoStartAutomation ? 'cta' : ''} onClick={() => set('autoStartAutomation', true)}>On</button>
            <button type="button" className={!prefs.autoStartAutomation ? 'cta' : ''} onClick={() => set('autoStartAutomation', false)}>Off</button>
          </div>
        </SettingRow>

        <AutomationRulesSection />
      </section>

      <section className="settings-section">
        <h2>Performance</h2>
        <SettingRow label="Polling Interval" hint="Default polling interval for live data panels (seconds).">
          <input type="number" min="5" max="120" step="5" className="settings-input settings-input-sm"
            value={prefs.pollingInterval} onChange={e => set('pollingInterval', Math.max(5, parseInt(e.target.value, 10) || 30))} />
        </SettingRow>
        <SettingRow label="Chart Animation" hint="Enable animations on chart components.">
          <div className="inline-actions">
            <button type="button" className={prefs.chartAnimation ? 'cta' : ''} onClick={() => set('chartAnimation', true)}>On</button>
            <button type="button" className={!prefs.chartAnimation ? 'cta' : ''} onClick={() => set('chartAnimation', false)}>Off</button>
          </div>
        </SettingRow>
      </section>

      <HealthChecksSection />

      <NotificationSettingsSection />

      <section className="settings-section">
        <h2>Security</h2>
        <SettingRow label="CORS Origin" hint="Allowed cross-origin request origin.">
          <code>http://localhost:5173</code>
        </SettingRow>
        <SettingRow label="Localhost Only" hint="Restrict API to localhost connections.">
          <code>off</code>
        </SettingRow>
        <SettingRow label="API Key Rotation" hint="Days until API key expiry warning.">
          <code>90</code>
        </SettingRow>
      </section>

      <footer className="settings-footer">
        <p>Settings are read from environment files and app configuration. Changes to backend settings require a restart.</p>
        <p>Documentation: <code>nest/README.md</code> and <code>nest/.env</code></p>
      </footer>
    </div>
  )
}

function HealthChecksSection() {
  const qc = useQueryClient();
  const { data: hc } = useQuery({
    queryKey: ['settings-health-checks'],
    queryFn: () => apiGet('/api/system/settings/health-checks').catch(() => null),
    staleTime: 30_000,
  });

  const toggle = async (key) => {
    if (!hc) return;
    const updated = { ...hc, [key]: !hc[key] };
    await apiPut('/api/system/settings/health-checks', { [key]: !hc[key] });
    qc.setQueryData(['settings-health-checks'], updated);
  };

  const setRefresh = async (sec) => {
    if (!hc) return;
    const updated = { ...hc, autoRefreshSec: sec };
    await apiPut('/api/system/settings/health-checks', { autoRefreshSec: sec });
    qc.setQueryData(['settings-health-checks'], updated);
  };

  const CHECK_LABELS = {
    systemVitals: 'System Vitals', dbDiagnostics: 'DB Table Diagnostics', slowQueries: 'Slow Query Detection',
    apiTrends: 'API Response Trends', providerGrid: 'Provider Health Grid', traceCorrelations: 'Trace Correlations',
    diskInfo: 'Disk Space Monitor', errorRates: 'Error Rate Tracking', cronHeartbeats: 'Cron Heartbeat Monitor',
    portStatus: 'Port Status Check',
  };

  return (
    <section className="settings-section">
      <h2>🩺 Health & Diagnostics</h2>
      <p className="settings-health-desc">
        Enable or disable individual health checks. Disabled checks skip their queries entirely — useful for reducing load or silencing known issues.
      </p>
      {Object.entries(CHECK_LABELS).map(([key, label]) => (
        <SettingRow key={key} label={label} hint={`Run ${label.toLowerCase()} check on the Health Dashboard.`}>
          <div className="inline-actions">
            <button type="button" className={(hc?.[key] !== false) ? 'cta' : ''} onClick={() => toggle(key)}>
              {(hc?.[key] !== false) ? 'On' : 'Off'}
            </button>
          </div>
        </SettingRow>
      ))}
      <SettingRow label="Auto-Refresh" hint="How often the Health Dashboard refreshes (seconds). Min 5, max 120.">
        <input type="number" min="5" max="120" step="5" className="settings-input settings-input-sm"
          value={hc?.autoRefreshSec ?? 15} onChange={e => setRefresh(Math.max(5, parseInt(e.target.value, 10) || 15))} />
      </SettingRow>
      <p className="settings-footnote">
        See <a href="/status/health-check">Health Dashboard</a> for live diagnostics.
      </p>
    </section>
  );
}

function AutomationRulesSection() {
  const { data } = useQuery({
    queryKey: ['automation-rules-settings'],
    queryFn: () => apiGet('/api/automation/rules').catch(() => []),
    staleTime: 60_000,
  });
  const rules = Array.isArray(data) ? data : [];

  return (
    <>
      <h3 style={{ marginTop: '0.75rem', fontSize: '0.8rem', color: 'var(--ink-soft)' }}>Automation Rules</h3>
      {rules.length === 0 ? (
        <p style={{ fontSize: '0.75rem', color: 'var(--ink-soft)', margin: '0.25rem 0' }}>
          No automation rules configured. Rules are seeded from the database.
        </p>
      ) : (
        rules.map((rule) => (
          <SettingRow key={rule.id} label={rule.name} hint={rule.description}>
            <div className="inline-actions">
              <button type="button" className={rule.enabled ? 'cta' : ''} onClick={() => {
                apiGet(`/api/automation/rules/${rule.id}`, { method: 'PUT', body: JSON.stringify({ enabled: !rule.enabled }) });
              }}>
                {rule.enabled ? 'On' : 'Off'}
              </button>
            </div>
          </SettingRow>
        ))
      )}
    </>
  );
}

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
          onChange={e => updateSetting('maxAlerts', parseInt(e.target.value, 10))}
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
          onChange={e => updateSetting('autoDismissDays', parseInt(e.target.value, 10))}
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
        Notifications aggregate from provider health, automation errors, MT5 bridge state, and API key warnings. Configure retention in the server's .env for persistent storage limits.
      </p>
    </section>
  );
}
