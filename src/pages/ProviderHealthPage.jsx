import { useQuery } from '@tanstack/react-query'
import { apiGet } from '../core/api/client'
import LoadingSkeleton from '../components/LoadingSkeleton'
import './trading-platforms.css'

const PROVIDER_LABELS = {
  alpaca: 'Alpaca', alphavantage: 'Alpha Vantage', trading212: 'Trading 212',
}
const STATUS_COLORS = {
  healthy: 'tp-chip--ok', degraded: 'tp-chip--neutral', error: 'tp-chip--warn',
  'missing-credentials': 'tp-chip--warn', unknown: 'tp-chip--neutral',
}

export default function ProviderHealthPage() {
  const healthQuery = useQuery({
    queryKey: ['provider-health'],
    queryFn: () => apiGet('/api/providers/health'),
    refetchInterval: 30_000,
  })

  const items = Array.isArray(healthQuery.data) ? healthQuery.data : []
  const mode = healthQuery.data?.mode ?? '...'

  if (healthQuery.isLoading) return (
    <div className="trading-platforms-page">
      <header className="tp-page-header">
        <h2>Provider Health</h2>
      </header>
      <LoadingSkeleton variant="card" count={3} />
      <LoadingSkeleton variant="table" rows={6} cols={3} className="ls-spacer-top" />
    </div>
  )
  if (healthQuery.isError) return <div className="trading-platforms-page"><p className="error">Failed to load provider health data.</p></div>

  const healthyCount = items.filter((p) => p.status === 'healthy').length
  const degradedCount = items.filter((p) => p.status !== 'healthy' && p.status !== 'unknown').length

  return (
    <div className="trading-platforms-page">
      <header className="tp-page-header">
        <h1>Provider Health</h1>
        <p>
          {items.length} provider{items.length !== 1 ? 's' : ''} · {healthyCount} healthy · {degradedCount} degraded · Mode: {mode}
        </p>
      </header>

      {items.length === 0 ? (
        <section className="tp-card">
          <p>No provider health data yet.</p>
          <p className="hint">Provider health records are created when adapters are first checked. Ensure the backend is running with provider adapters configured.</p>
        </section>
      ) : (
        <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 16 }}>
          {items.map((p) => {
            const statusClass = STATUS_COLORS[p.status] || 'tp-chip--neutral'
            const credClass = p.credentialsOk ? 'tp-chip--ok' : 'tp-chip--warn'
            const label = PROVIDER_LABELS[p.provider] || p.provider
            const checked = p.checkedAt ? new Date(p.checkedAt).toLocaleTimeString() : 'never'

            return (
              <div key={p.id || p.provider} className="tp-card" style={{ padding: 20 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                  <h3 style={{ margin: 0 }}>{label}</h3>
                  <span className={`tp-chip ${statusClass}`}>{p.status || 'unknown'}</span>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 16px', fontSize: '0.9rem' }}>
                  <div><span className="hint">Adapter</span><br /><strong>{p.provider || '—'}</strong></div>
                  <div><span className="hint">Credentials</span><br /><span className={`tp-chip ${credClass}`}>{p.credentialsOk ? 'OK' : 'Missing'}</span></div>
                  <div><span className="hint">Latency</span><br /><strong>{p.latencyMs != null ? `${p.latencyMs}ms` : '—'}</strong></div>
                  <div><span className="hint">Last Check</span><br /><strong>{checked}</strong></div>
                </div>

                {p.message && (
                  <p style={{ marginTop: 12, fontSize: '0.85rem', color: 'var(--ink-soft)', background: 'var(--panel)', padding: '8px 12px', borderRadius: 6 }}>
                    {p.message}
                  </p>
                )}
                {p.endpoint && (
                  <p style={{ marginTop: 4, fontSize: '0.75rem', color: 'var(--ink-soft)' }}>
                    Endpoint: <code>{p.endpoint}</code>
                  </p>
                )}
              </div>
            )
          })}
        </section>
      )}
    </div>
  )
}
