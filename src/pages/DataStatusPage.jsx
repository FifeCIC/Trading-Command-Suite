import { useQuery } from '@tanstack/react-query'
import { apiGet } from '../core/api/client'
import LoadingSkeleton from '../components/LoadingSkeleton'
import './trading-platforms.css'

const STATUS_COLORS = {
  healthy: 'tp-chip--ok', fresh: 'tp-chip--ok',
  degraded: 'tp-chip--neutral', stale: 'tp-chip--neutral',
  error: 'tp-chip--warn', missing: 'tp-chip--warn',
}

export default function DataStatusPage() {
  const providers = useQuery({ queryKey: ['ds-providers'], queryFn: () => apiGet('/api/providers/health'), refetchInterval: 30_000 })
  const symbols = useQuery({ queryKey: ['ds-symbols'], queryFn: () => apiGet('/api/symbols'), refetchInterval: 30_000 })
  const freshness = useQuery({ queryKey: ['ds-freshness'], queryFn: () => apiGet('/api/market-data/freshness'), refetchInterval: 30_000 })
  const imports = useQuery({ queryKey: ['ds-imports'], queryFn: () => apiGet('/api/imports/runs'), refetchInterval: 30_000 })

  const refreshAll = () => { providers.refetch(); symbols.refetch(); freshness.refetch(); imports.refetch() }
  const loading = providers.isLoading || symbols.isLoading || freshness.isLoading || imports.isLoading
  const anyError = providers.isError || symbols.isError || freshness.isError || imports.isError

  const provItems = Array.isArray(providers.data) ? providers.data : []
  const symData = symbols.data ?? {}
  const syms = Array.isArray(symData.symbols) ? symData.symbols : []
  const activeSyms = syms.filter((s) => s.active !== false).length
  const fData = freshness.data ?? {}
  const freshes = Array.isArray(fData.results) ? fData.results : []
  const freshCount = freshes.filter((r) => r.status === 'fresh').length
  const staleCount = freshes.filter((r) => r.status === 'stale').length
  const missingCount = freshes.filter((r) => r.status === 'missing').length
  const impData = imports.data ?? {}
  const impRuns = Array.isArray(impData.runs) ? impData.runs : []
  const lastImport = impRuns.length > 0 ? impRuns[0].requestedAt : null

  if (loading) return (
    <div className="trading-platforms-page">
      <header className="tp-page-header">
        <h2>Data Status</h2>
      </header>
      <LoadingSkeleton variant="card" count={4} />
      <LoadingSkeleton variant="table" rows={6} cols={4} className="ls-spacer-top" />
    </div>
  )

  return (
    <div className="trading-platforms-page">
      <header className="tp-page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start' }}>
        <div>
          <h1>Data Status</h1>
          <p>All data systems at a glance · Mode: {symData.mode || '...'}</p>
        </div>
        <button type="button" className="btn" onClick={refreshAll}>Refresh All</button>
      </header>

      {anyError && <p className="error" style={{ marginBottom: 16 }}>Some endpoints returned errors. Check backend.</p>}

      <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 16, marginBottom: 20 }}>
        <div className="tp-card" style={{ textAlign: 'center', padding: 20 }}>
          <div style={{ fontSize: '2rem', fontWeight: 700 }}>{syms.length}</div>
          <div className="hint">Total Symbols</div>
          <div style={{ fontSize: '0.85rem', marginTop: 4 }}>{activeSyms} active</div>
        </div>
        <div className="tp-card" style={{ textAlign: 'center', padding: 20 }}>
          <div style={{ fontSize: '2rem', fontWeight: 700, color: '#4caf50' }}>{freshCount}</div>
          <div className="hint">Fresh</div>
        </div>
        <div className="tp-card" style={{ textAlign: 'center', padding: 20 }}>
          <div style={{ fontSize: '2rem', fontWeight: 700, color: '#ff9800' }}>{staleCount}</div>
          <div className="hint">Stale</div>
        </div>
        <div className="tp-card" style={{ textAlign: 'center', padding: 20 }}>
          <div style={{ fontSize: '2rem', fontWeight: 700, color: '#f44336' }}>{missingCount}</div>
          <div className="hint">Missing</div>
        </div>
        <div className="tp-card" style={{ textAlign: 'center', padding: 20 }}>
          <div style={{ fontSize: '2rem', fontWeight: 700 }}>{provItems.length}</div>
          <div className="hint">Providers</div>
        </div>
        <div className="tp-card" style={{ textAlign: 'center', padding: 20 }}>
          <div style={{ fontSize: '1.2rem', fontWeight: 700 }}>{lastImport ? new Date(lastImport).toLocaleTimeString() : '—'}</div>
          <div className="hint">Last Import</div>
        </div>
      </section>

      <section className="tp-card tp-comparison-card">
        <h3>Provider Health</h3>
        <div className="tp-comparison-wrap">
          <table className="tp-comparison-table">
            <thead><tr><th>Provider</th><th>Status</th><th>Credentials</th><th>Latency</th><th>Last Check</th></tr></thead>
            <tbody>
              {provItems.map((p) => (
                <tr key={p.id || p.provider}>
                  <td><strong>{p.provider || p.id}</strong></td>
                  <td><span className={`tp-chip ${STATUS_COLORS[p.status] || 'tp-chip--neutral'}`}>{p.status || 'unknown'}</span></td>
                  <td><span className={`tp-chip ${p.credentialsOk ? 'tp-chip--ok' : 'tp-chip--warn'}`}>{p.credentialsOk ? 'OK' : 'Missing'}</span></td>
                  <td>{p.latencyMs != null ? `${p.latencyMs}ms` : '—'}</td>
                  <td>{p.checkedAt ? new Date(p.checkedAt).toLocaleTimeString() : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="tp-card tp-comparison-card">
        <h3>Symbol Freshness</h3>
        <div className="tp-comparison-wrap">
          <table className="tp-comparison-table">
            <thead><tr><th>Symbol</th><th>Status</th><th>Age</th><th>Latest Bar</th></tr></thead>
            <tbody>
              {freshes.slice(0, 20).map((r) => (
                <tr key={r.symbolId}>
                  <td><strong>{r.symbolId}</strong></td>
                  <td><span className={`tp-chip ${STATUS_COLORS[r.status] || 'tp-chip--neutral'}`}>{r.status}</span></td>
                  <td>{r.ageMinutes != null ? `${r.ageMinutes.toFixed(1)}m` : '—'}</td>
                  <td>{r.latestTimestamp ? new Date(r.latestTimestamp).toLocaleString() : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {impRuns.length > 0 && (
        <section className="tp-card tp-comparison-card">
          <h3>Recent Import Runs</h3>
          <div className="tp-comparison-wrap">
            <table className="tp-comparison-table">
              <thead><tr><th>Symbol</th><th>Status</th><th>Requested</th></tr></thead>
              <tbody>
                {impRuns.slice(0, 10).map((r, i) => (
                  <tr key={i}>
                    <td><strong>{r.symbolId || '—'}</strong></td>
                    <td><span className={`tp-chip ${STATUS_COLORS[r.status] || 'tp-chip--neutral'}`}>{r.status || '—'}</span></td>
                    <td>{r.requestedAt ? new Date(r.requestedAt).toLocaleTimeString() : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  )
}
