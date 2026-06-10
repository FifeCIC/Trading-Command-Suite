import { useQuery } from '@tanstack/react-query'
import { apiGet } from '../core/api/client'
import './system-status.css'

const REFRESH_MS = 15_000

function StatusDot({ ok, label }) {
  return (
    <span className={`status-dot ${ok ? 'ok' : 'warn'}`} title={label}>
      <span className="dot" />
      {ok ? 'Online' : 'Offline'}
    </span>
  )
}

function StatusCard({ title, children, variant = 'neutral' }) {
  return (
    <article className={`status-card status-card--${variant}`}>
      <h3>{title}</h3>
      <div className="status-card-body">{children}</div>
    </article>
  )
}

function MetricRow({ label, value, ok }) {
  return (
    <div className="metric-row">
      <span className="metric-label">{label}</span>
      <span className="metric-value">
        {ok !== undefined && <StatusDot ok={ok} label={label} />}
        {value}
      </span>
    </div>
  )
}

export default function SystemStatusPage() {
  const version = useQuery({
    queryKey: ['status-version'],
    queryFn: () => apiGet('/api/version'),
    refetchInterval: REFRESH_MS,
  })

  const symbols = useQuery({
    queryKey: ['status-symbols'],
    queryFn: () => apiGet('/api/symbols'),
    refetchInterval: REFRESH_MS,
  })

  const providers = useQuery({
    queryKey: ['status-providers'],
    queryFn: () => apiGet('/api/providers/health'),
    refetchInterval: REFRESH_MS,
  })

  const v = version.data ?? {}
  const svc = v.services ?? {}
  const s = symbols.data ?? {}
  const syms = Array.isArray(s.symbols) ? s.symbols : []
  const p = providers.data ?? {}
  const provs = Array.isArray(p.providers) ? p.providers : []

  const apiOk = Boolean(v.version)
  const dbOk = svc.databaseConnected === true
  const dbConfigured = svc.database === true
  const queueOk = svc.queue === true
  const redisOk = svc.redis === true
  const mode = v.mode ?? 'unknown'

  const overallOk = apiOk && (dbOk || !dbConfigured)

  return (
    <div className="system-status-page">
      <header className="status-page-header">
        <div className="overall-status">
          <StatusDot ok={overallOk} label="Overall" />
          <span className="mode-badge">{mode}</span>
        </div>
      </header>

      <div className="status-grid">
        <StatusCard
          title="API"
          variant={apiOk ? 'ok' : 'warn'}
        >
          <MetricRow label="Version" value={v.version || '—'} ok={apiOk} />
          <MetricRow label="Timestamp" value={v.timestamp ? new Date(v.timestamp).toLocaleTimeString() : '—'} />
        </StatusCard>

        <StatusCard
          title="Database"
          variant={dbOk ? 'ok' : dbConfigured ? 'warn' : 'neutral'}
        >
          <MetricRow label="Configured" value={dbConfigured ? 'Yes' : 'No'} ok={dbConfigured} />
          <MetricRow label="Connected" value={dbOk ? 'Yes' : 'No'} ok={dbOk} />
          <MetricRow label="Symbols" value={syms.length} />
          {!dbOk && dbConfigured && (
            <p className="status-hint">
              Database is configured but not reachable. Check your .env DATABASE_URL and that the database server is running.
            </p>
          )}
          {!dbConfigured && (
            <p className="status-hint">
              DATABASE_URL is not set. Create a .env file in the nest/ folder.
            </p>
          )}
        </StatusCard>

        <StatusCard
          title="Queue"
          variant={queueOk ? 'ok' : 'neutral'}
        >
          <MetricRow label="Enabled" value={queueOk ? 'Yes' : 'No'} ok={queueOk} />
          <MetricRow label="Redis" value={redisOk ? 'Connected' : 'Not configured'} ok={redisOk} />
          {!queueOk && (
            <p className="status-hint">
              Queue is disabled. Set QUEUE_MODE=local and configure REDIS_HOST in .env to enable background processing.
            </p>
          )}
        </StatusCard>

        <StatusCard
          title="Providers"
          variant={provs.length > 0 ? 'ok' : 'warn'}
        >
          {provs.length === 0 ? (
            <p className="status-hint">No provider data available.</p>
          ) : (
            <ul className="provider-list">
              {provs.map((pr) => (
                <li key={pr.provider}>
                  <span>{pr.displayName}</span>
                  <span className={`ss-chip ss-chip--${pr.credentialsConfigured ? 'ok' : 'warn'}`}>
                    {pr.credentialsConfigured ? 'Creds OK' : 'No Credentials'}
                  </span>
                  <span className={`ss-chip ss-chip--${pr.status === 'healthy' ? 'ok' : pr.status === 'missing-credentials' ? 'warn' : 'neutral'}`}>
                    {pr.status}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </StatusCard>

        <StatusCard
          title="Symbols"
          variant={syms.length > 0 ? 'ok' : 'warn'}
        >
          {syms.length === 0 ? (
            <p className="status-hint">
              No symbols in database. Run <code>npx prisma db seed</code> in the nest/ folder.
            </p>
          ) : (
            <table className="symbol-table">
              <thead>
                <tr>
                  <th>Ticker</th>
                  <th>Name</th>
                  <th>Exchange</th>
                </tr>
              </thead>
              <tbody>
                {syms.map((sym) => (
                  <tr key={sym.id}>
                    <td><strong>{sym.ticker}</strong></td>
                    <td>{sym.name}</td>
                    <td>{sym.exchange}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </StatusCard>
      </div>

      <footer className="status-footer">
        <span>Auto-refresh every {REFRESH_MS / 1000}s</span>
        <span>Last check: {new Date().toLocaleTimeString()}</span>
      </footer>
    </div>
  )
}
