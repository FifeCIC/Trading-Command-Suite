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
      </section>

      <footer className="settings-footer">
        <p>Settings are read from environment files and app configuration. Changes to backend settings require a restart.</p>
        <p>Documentation: <code>nest/README.md</code> and <code>nest/.env</code></p>
      </footer>
    </div>
  )
}
