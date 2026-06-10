import { useQuery } from '@tanstack/react-query'
import { apiGet } from '../core/api/client'
import './database-tables.css'

// These mirror the Prisma schema models and planned tables
const ALL_TABLES = [
  // Core Trading Tables (Currently Implemented)
  { name: 'Symbol', prismaModel: 'Symbol', description: 'Trading symbols and company data', status: 'active' },
  { name: 'Strategy', prismaModel: 'Strategy', description: 'Trading strategies and rules', status: 'active' },
  { name: 'Directive', prismaModel: 'Directive', description: 'Scoring directive definitions', status: 'active' },
  { name: 'Score', prismaModel: 'Score', description: 'Symbol scoring history', status: 'active' },
  { name: 'Signal', prismaModel: 'Signal', description: 'Trading signal records', status: 'active' },
  { name: 'MarketBar', prismaModel: 'MarketBar', description: 'OHLCV price data from imports', status: 'active' },
  { name: 'ImportRun', prismaModel: 'ImportRun', description: 'Data import job tracking', status: 'active' },
  { name: 'ProviderHealth', prismaModel: 'ProviderHealth', description: 'Provider connectivity status', status: 'active' },
  
  // Symbol Meta Tables (Planned)
  { name: 'SymbolMeta', prismaModel: null, description: 'Extended symbol metadata storage', status: 'planned' },
  { name: 'SymbolFundamentals', prismaModel: null, description: 'Fundamental data (PE, EPS, etc.)', status: 'planned' },
  { name: 'SymbolTechnical', prismaModel: null, description: 'Technical indicators by timeframe', status: 'planned' },
  
  // API Management Tables (Planned)
  { name: 'ApiCalls', prismaModel: null, description: 'API call tracking for rate limiting', status: 'planned' },
  { name: 'DataSourcesMeta', prismaModel: null, description: 'Data source configurations', status: 'planned' },
  { name: 'ApiCredentials', prismaModel: null, description: 'Encrypted API credentials storage', status: 'planned' },
  
  // Cache Management (Planned)
  { name: 'CacheMeta', prismaModel: null, description: 'Cache metadata for invalidation', status: 'planned' },
  
  // Strategy Meta Tables (Planned)
  { name: 'StrategyMeta', prismaModel: null, description: 'Strategy parameters and configs', status: 'planned' },
  { name: 'StrategyPerformance', prismaModel: null, description: 'Strategy performance tracking', status: 'planned' },
  
  // User Activity Tables (Planned)
  { name: 'UserPreferences', prismaModel: null, description: 'User trading preferences', status: 'planned' },
  { name: 'Watchlist', prismaModel: null, description: 'User watchlists', status: 'planned' },
  { name: 'WatchlistMeta', prismaModel: null, description: 'Watchlist metadata', status: 'planned' },
  
  // Automation Tables (Planned)
  { name: 'CronMeta', prismaModel: null, description: 'CRON job metadata and status', status: 'planned' },
  { name: 'ProcessMeta', prismaModel: null, description: 'Background process metadata', status: 'planned' },
  
  // Market Context Tables (Planned)
  { name: 'MarketSessions', prismaModel: null, description: 'Market session information', status: 'planned' },
  { name: 'NewsMeta', prismaModel: null, description: 'News sentiment metadata', status: 'planned' },
  
  // Order Management (Planned)
  { name: 'Order', prismaModel: null, description: 'Trading orders', status: 'planned' },
  { name: 'OrderExecution', prismaModel: null, description: 'Order execution history', status: 'planned' },
  { name: 'Position', prismaModel: null, description: 'Open trading positions', status: 'planned' },
  { name: 'Trade', prismaModel: null, description: 'Completed trade records', status: 'planned' },
]

export default function DatabaseTablesPage() {
  const version = useQuery({
    queryKey: ['db-version'],
    queryFn: () => apiGet('/api/version'),
  })

  const symbols = useQuery({
    queryKey: ['db-symbols'],
    queryFn: () => apiGet('/api/symbols'),
  })

  const providers = useQuery({
    queryKey: ['db-providers'],
    queryFn: () => apiGet('/api/providers/health'),
  })

  const imports = useQuery({
    queryKey: ['db-imports'],
    queryFn: () => apiGet('/api/imports/runs?limit=100'),
  })

  const v = version.data ?? {}
  const svc = v.services ?? {}
  const dbConnected = svc.databaseConnected === true
  const s = symbols.data ?? {}
  const syms = Array.isArray(s.symbols) ? s.symbols : []
  const p = providers.data ?? {}
  const provs = Array.isArray(p.providers) ? p.providers : []
  const i = imports.data ?? {}
  const runs = Array.isArray(i.runs) ? i.runs : []

  function rowCount(modelName) {
    switch (modelName) {
      case 'Symbol': return syms.length
      case 'ProviderHealth': return provs.length
      case 'ImportRun': return runs.length
      default: return '—'
    }
  }

  function tableStatus(modelName, table) {
    if (!dbConnected) return 'offline'
    if (table.status === 'planned') return 'planned'
    const count = rowCount(modelName)
    if (typeof count === 'number' && count >= 0) return 'installed'
    return 'present'
  }

  function statusChip(status) {
    const labels = { installed: 'ok', present: 'neutral', offline: 'warn', planned: 'info' }
    const chipLabels = { installed: 'installed', present: 'present', offline: 'offline', planned: 'planned' }
    return <span className={`db-chip db-chip--${labels[status] || 'neutral'}`}>{chipLabels[status] || status}</span>
  }

  return (
    <div className="database-tables-page">
      <header className="db-page-header">
        <p>
          Status: {dbConnected ? 'MySQL connected' : 'Database offline'} ·
          {syms.length} symbols ·
          {provs.length} providers ·
          {runs.length} import runs
        </p>
      </header>

      <table className="tables-table">
        <thead>
          <tr>
            <th>Table</th>
            <th>Description</th>
            <th>Status</th>
            <th>Rows</th>
          </tr>
        </thead>
        <tbody>
          {ALL_TABLES.map((t) => (
            <tr key={t.name} className={t.status === 'planned' ? 'row-planned' : ''}>
              <td><code>{t.name}</code></td>
              <td>{t.description}</td>
              <td>{statusChip(tableStatus(t.prismaModel, t))}</td>
              <td className="num">{t.status === 'planned' ? '—' : rowCount(t.prismaModel)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <footer className="page-footer">
        <p>Engine: MySQL 9.1 (WAMP) · Database: tradingcs · ORM: Prisma 5.22.0</p>
        {!dbConnected && (
          <p className="db-hint">Database not connected. Check DATABASE_URL in nest/.env and that MySQL is running.</p>
        )}
      </footer>
    </div>
  )
}
