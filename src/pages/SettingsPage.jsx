import { useUiStore } from '../stores/useUiStore';
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
        <SettingRow label="Mode" hint="Toggle between light and dark appearance.">
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
        <SettingRow label="Default Timeframe" hint="Default chart timeframe (1h, 4h, 1d, 1w).">
          <code>1h</code>
        </SettingRow>
        <SettingRow label="Decimal Places" hint="Number of decimal places for price display.">
          <code>2</code>
        </SettingRow>
        <SettingRow label="Compact Mode" hint="Reduce padding and font sizes for higher information density.">
          <code>off</code>
        </SettingRow>
      </section>

      <section className="settings-section">
        <h2>Performance</h2>
        <SettingRow label="Polling Interval" hint="Default polling interval for live data panels (seconds).">
          <code>30</code>
        </SettingRow>
        <SettingRow label="Chart Animation" hint="Enable animations on chart components.">
          <code>on</code>
        </SettingRow>
      </section>

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
