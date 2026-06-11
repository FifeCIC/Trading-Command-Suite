import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { apiGet } from '../core/api/client'
import LoadingSkeleton from '../components/LoadingSkeleton'
import './data-area-landing.css'

const REFETCH_MS = 60_000

const DATA_CARDS = [
  {
    id: 'symbols',
    label: 'Symbols',
    description: 'Manage trading symbols — add, activate, deactivate',
    link: '/data/active-symbols',
    apiKey: 'symbols',
    apiPath: '/api/symbols',
  },
  {
    id: 'market-data',
    label: 'Market Data',
    description: 'View data freshness, latest bars, and age metrics',
    link: '/data/data-status',
    apiKey: 'freshness',
    apiPath: '/api/market-data/freshness',
  },
  {
    id: 'providers',
    label: 'Data Providers',
    description: 'Monitor provider health, credentials, and latency',
    link: '/data/provider-health',
    apiKey: 'providers',
    apiPath: '/api/providers/health',
  },
  {
    id: 'imports',
    label: 'Import Jobs',
    description: 'Track import runs, trigger new imports, view history',
    link: '/data/import-jobs',
    apiKey: 'imports',
    apiPath: '/api/imports/runs',
  },
  {
    id: 'scoring',
    label: 'Scoring Pipeline',
    description: 'Ranked symbols, directive scores, and strategy thresholds',
    link: '/scoring/scoring-overview',
    apiKey: 'scoring',
    apiPath: '/api/scoring/ranked',
  },
  {
    id: 'database',
    label: 'Database Tables',
    description: 'Browse Prisma schema tables and record counts',
    link: '/data/database-tables',
    apiKey: null,
    apiPath: null,
  },
]

export default function DataAreaLandingPage() {
  const navigate = useNavigate()

  const symbols = useQuery({
    queryKey: ['dal-symbols'],
    queryFn: () => apiGet('/api/symbols'),
    refetchInterval: REFETCH_MS,
    retry: 1,
  })
  const freshness = useQuery({
    queryKey: ['dal-freshness'],
    queryFn: () => apiGet('/api/market-data/freshness'),
    refetchInterval: REFETCH_MS,
    retry: 1,
  })
  const providers = useQuery({
    queryKey: ['dal-providers'],
    queryFn: () => apiGet('/api/providers/health'),
    refetchInterval: REFETCH_MS,
    retry: 1,
  })
  const imports = useQuery({
    queryKey: ['dal-imports'],
    queryFn: () => apiGet('/api/imports/runs?limit=5'),
    refetchInterval: REFETCH_MS,
    retry: 1,
  })
  const scoring = useQuery({
    queryKey: ['dal-scoring'],
    queryFn: () => apiGet('/api/scoring/ranked?limit=5'),
    refetchInterval: REFETCH_MS,
    retry: 1,
  })

  const syms = Array.isArray(symbols.data?.symbols) ? symbols.data.symbols : []
  const activeSyms = syms.filter((s) => s.active !== false).length

  const fData = freshness.data ?? {}
  const freshes = Array.isArray(fData.results) ? fData.results : []
  const freshCount = freshes.filter((r) => r.status === 'fresh').length
  const staleCount = freshes.filter((r) => r.status === 'stale').length
  const missingCount = freshes.filter((r) => r.status === 'missing').length

  const provItems = Array.isArray(providers.data) ? providers.data : []
  const healthyProvs = provItems.filter((p) => p.status === 'healthy' || p.credentialsOk).length
  const degradedProvs = provItems.filter((p) => p.status === 'error' || p.status === 'degraded').length

  const impRuns = Array.isArray(imports.data?.runs) ? imports.data.runs : []
  const lastImport = impRuns.length > 0 ? impRuns[0].requestedAt : null
  const successImports = impRuns.filter((r) => r.status === 'completed').length
  const failedImports = impRuns.filter((r) => r.status === 'failed').length
  const impTotal = impRuns.length
  const impSuccessRate = impTotal > 0 ? Math.round((successImports / impTotal) * 100) : 0

  const scoredRanks = Array.isArray(scoring.data?.ranked) ? scoring.data.ranked : []
  const scoringTime = scoring.data?.timestamp ?? null

  const loading =
    symbols.isLoading || freshness.isLoading || providers.isLoading

  return (
    <main className="dal-page">
      <header className="dal-header">
        <p className="eyebrow">Data Area</p>
        <h1>Data Overview</h1>
        <p className="dal-subtitle">
          Central hub for all data subsystems. View summaries, monitor health,
          and navigate to full management pages.
        </p>
      </header>

      {loading && (
        <div style={{ margin: '1rem 0' }}>
          <LoadingSkeleton variant="card" count={6} />
        </div>
      )}

      <section className="dal-grid">
        {/* Symbols */}
        <article className="dal-card" onClick={() => navigate('/data/active-symbols')}>
          <div className="dal-card-header">
            <h2>Symbols</h2>
            <span className="dal-link-hint">→</span>
          </div>
          <p className="dal-desc">Manage trading symbols — add, activate, deactivate</p>
          <div className="dal-stats">
            <div className="dal-stat">
              <span className="dal-stat-value">{syms.length}</span>
              <span className="dal-stat-label">Total</span>
            </div>
            <div className="dal-stat">
              <span className="dal-stat-value accent">{activeSyms}</span>
              <span className="dal-stat-label">Active</span>
            </div>
          </div>
          <div className="dal-card-footer">
            {symbols.isError && <span className="dal-error">API offline</span>}
            {!symbols.isError && <span className="dal-ok">{syms.length > 0 ? 'Data loaded' : 'No symbols'}</span>}
          </div>
        </article>

        {/* Market Data */}
        <article className="dal-card" onClick={() => navigate('/data/data-status')}>
          <div className="dal-card-header">
            <h2>Market Data</h2>
            <span className="dal-link-hint">→</span>
          </div>
          <p className="dal-desc">View data freshness, latest bars, and age metrics</p>
          <div className="dal-stats">
            <div className="dal-stat">
              <span className="dal-stat-value success">{freshCount}</span>
              <span className="dal-stat-label">Fresh</span>
            </div>
            <div className="dal-stat">
              <span className="dal-stat-value warn">{staleCount}</span>
              <span className="dal-stat-label">Stale</span>
            </div>
            <div className="dal-stat">
              <span className="dal-stat-value danger">{missingCount}</span>
              <span className="dal-stat-label">Missing</span>
            </div>
          </div>
          <div className="dal-card-footer">
            {freshness.isError && <span className="dal-error">API offline</span>}
            {!freshness.isError && freshes.length === 0 && <span className="dal-neutral">No data loaded</span>}
            {!freshness.isError && freshes.length > 0 && <span className="dal-ok">{freshes.length} bars tracked</span>}
          </div>
        </article>

        {/* Data Providers */}
        <article className="dal-card" onClick={() => navigate('/data/provider-health')}>
          <div className="dal-card-header">
            <h2>Data Providers</h2>
            <span className="dal-link-hint">→</span>
          </div>
          <p className="dal-desc">Monitor provider health, credentials, and latency</p>
          <div className="dal-stats">
            <div className="dal-stat">
              <span className="dal-stat-value success">{healthyProvs}</span>
              <span className="dal-stat-label">Healthy</span>
            </div>
            <div className="dal-stat">
              <span className="dal-stat-value danger">{degradedProvs}</span>
              <span className="dal-stat-label">Degraded</span>
            </div>
            <div className="dal-stat">
              <span className="dal-stat-value">{provItems.length}</span>
              <span className="dal-stat-label">Total</span>
            </div>
          </div>
          <div className="dal-card-footer">
            {providers.isError && <span className="dal-error">API offline</span>}
            {!providers.isError && provItems.length === 0 && <span className="dal-neutral">No providers</span>}
            {!providers.isError && provItems.length > 0 && (
              <span className="dal-ok">{healthyProvs}/{provItems.length} healthy</span>
            )}
          </div>
        </article>

        {/* Import Jobs */}
        <article className="dal-card" onClick={() => navigate('/data/import-jobs')}>
          <div className="dal-card-header">
            <h2>Import Jobs</h2>
            <span className="dal-link-hint">→</span>
          </div>
          <p className="dal-desc">Track import runs, trigger new imports, view history</p>
          <div className="dal-stats">
            <div className="dal-stat">
              <span className="dal-stat-value success">{successImports}</span>
              <span className="dal-stat-label">Completed</span>
            </div>
            <div className="dal-stat">
              <span className="dal-stat-value danger">{failedImports}</span>
              <span className="dal-stat-label">Failed</span>
            </div>
            <div className="dal-stat">
              <span className="dal-stat-value">{impSuccessRate}%</span>
              <span className="dal-stat-label">Rate</span>
            </div>
          </div>
          <div className="dal-card-footer">
            {lastImport ? (
              <span className="dal-neutral">Last: {new Date(lastImport).toLocaleTimeString()}</span>
            ) : (
              <span className="dal-neutral">No imports yet</span>
            )}
          </div>
        </article>

        {/* Scoring Pipeline */}
        <article className="dal-card" onClick={() => navigate('/scoring/scoring-overview')}>
          <div className="dal-card-header">
            <h2>Scoring Pipeline</h2>
            <span className="dal-link-hint">→</span>
          </div>
          <p className="dal-desc">Ranked symbols, directive scores, and strategy thresholds</p>
          <div className="dal-stats">
            <div className="dal-stat">
              <span className="dal-stat-value">{scoredRanks.length}</span>
              <span className="dal-stat-label">Scored</span>
            </div>
            <div className="dal-stat">
              <span className="dal-stat-value accent">
                {scoredRanks.length > 0
                  ? scoredRanks.filter((r) => r.signal === 'entry').length
                  : 0}
              </span>
              <span className="dal-stat-label">Entries</span>
            </div>
          </div>
          <div className="dal-card-footer">
            {scoring.isError && <span className="dal-error">API offline</span>}
            {!scoring.isError && scoringTime && (
              <span className="dal-neutral">Last run: {new Date(scoringTime).toLocaleTimeString()}</span>
            )}
            {!scoring.isError && !scoringTime && (
              <span className="dal-neutral">No scoring data</span>
            )}
          </div>
        </article>

        {/* Database Tables */}
        <article className="dal-card" onClick={() => navigate('/data/database-tables')}>
          <div className="dal-card-header">
            <h2>Database Tables</h2>
            <span className="dal-link-hint">→</span>
          </div>
          <p className="dal-desc">Browse Prisma schema tables and record counts</p>
          <div className="dal-stats">
            <div className="dal-stat">
              <span className="dal-stat-value">—</span>
              <span className="dal-stat-label">Tables</span>
            </div>
          </div>
          <div className="dal-card-footer">
            <span className="dal-neutral">Static page — no API call</span>
          </div>
        </article>
      </section>
    </main>
  )
}
