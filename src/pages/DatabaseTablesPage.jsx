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
  { name: 'SymbolTechnical', prismaModel: 'SymbolTechnical', description: 'Technical indicators by timeframe', status: 'active' },
  
  // API Management Tables
  { name: 'ApiCalls', prismaModel: 'ApiCalls', description: 'API call tracking for rate limiting', status: 'active' },
  { name: 'DataSourcesMeta', prismaModel: 'DataSourcesMeta', description: 'Data source configurations', status: 'active' },
  { name: 'ApiCredentials', prismaModel: 'ApiCredentials', description: 'Encrypted API credentials storage', status: 'active' },
  
  // Cache Management
  { name: 'CacheMeta', prismaModel: 'CacheMeta', description: 'Cache metadata for invalidation', status: 'active' },
  
  // Strategy Meta Tables
  { name: 'StrategyMeta', prismaModel: 'StrategyMeta', description: 'Strategy parameters and configs', status: 'active' },
  { name: 'StrategyPerformance', prismaModel: 'StrategyPerformance', description: 'Strategy performance tracking', status: 'active' },
  
  // User Activity Tables
  { name: 'UserPreferences', prismaModel: 'UserPreferences', description: 'User trading preferences', status: 'active' },
  { name: 'Watchlist', prismaModel: 'Watchlist', description: 'User watchlists', status: 'active' },
  { name: 'WatchlistMeta', prismaModel: 'WatchlistMeta', description: 'Watchlist metadata', status: 'active' },
  
  // Automation Tables
  { name: 'CronMeta', prismaModel: 'CronMeta', description: 'CRON job metadata and status', status: 'active' },
  { name: 'ProcessMeta', prismaModel: 'ProcessMeta', description: 'Background process metadata', status: 'active' },
  
  // Market Context Tables
  { name: 'MarketSessions', prismaModel: 'MarketSessions', description: 'Market session information (London/NY/Asia)', status: 'active' },
  { name: 'NewsMeta', prismaModel: 'NewsMeta', description: 'News sentiment metadata', status: 'active' },
  
  // Order Management
  { name: 'Order', prismaModel: 'Order', description: 'Trading orders', status: 'active' },
  { name: 'OrderExecution', prismaModel: 'OrderExecution', description: 'Order execution history', status: 'active' },
  { name: 'Position', prismaModel: 'Position', description: 'Open trading positions', status: 'active' },
  { name: 'Trade', prismaModel: 'Trade', description: 'Completed trade records', status: 'active' },
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

  // Table stats (last insert timestamps)
  const tableStats = useQuery({
    queryKey: ['db-table-stats'],
    queryFn: () => apiGet('/api/database/table-stats').catch(() => ({})),
    retry: 1,
    staleTime: 30_000,
  })

  const v = version.data ?? {}
  const svc = v.services ?? {}
  const dbConnected = svc.databaseConnected === true
  const prismaVersion = v.prismaVersion ?? '5.22.0'
  const s = symbols.data ?? {}
  const syms = Array.isArray(s.symbols) ? s.symbols : []
  const p = providers.data ?? {}
  const provs = Array.isArray(p.providers) ? p.providers : []
  const i = imports.data ?? {}
  const runs = Array.isArray(i.runs) ? i.runs : []
  const tStats = tableStats.data?.tables ?? {}

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

  function lastInsert(prismaModel) {
    const stat = tStats[prismaModel]
    if (!stat?.lastInsert) return '—'
    return new Date(stat.lastInsert).toLocaleString()
  }

  function phpMyAdminLink(tableName) {
    return `http://localhost/phpmyadmin/index.php?route=/table/sql&db=tradingcs&table=${tableName}`
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
            <th>Version</th>
            <th>Last Insert</th>
            <th className="dt-col-view">View</th>
          </tr>
        </thead>
        <tbody>
          {ALL_TABLES.map((t) => (
            <tr key={t.name} className={t.status === 'planned' ? 'row-planned' : ''}>
              <td><code>{t.name}</code></td>
              <td>{t.description}</td>
              <td>{statusChip(tableStatus(t.prismaModel, t))}</td>
              <td className="num">{t.status === 'planned' ? '—' : rowCount(t.prismaModel)}</td>
              <td className="num dt-num-sm">{t.status === 'active' ? `Prisma ${prismaVersion}` : '—'}</td>
              <td className="num dt-num-sm">{t.status === 'active' && t.prismaModel ? lastInsert(t.prismaModel) : '—'}</td>
              <td>
                {t.status === 'active' && (
                  <a href={phpMyAdminLink(t.name)} target="_blank" rel="noreferrer" className="tp-chip tp-chip--info dt-phpmyadmin-link" title="Open in phpMyAdmin">
                    🔗
                  </a>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <footer className="page-footer">
        <p>Engine: MySQL 9.1 (WAMP) · Database: tradingcs · ORM: Prisma {prismaVersion}</p>
        <p>Tables are managed via Prisma schema (<code>nest/prisma/schema.prisma</code>). Migrations are applied with <code>npx prisma db push</code>.</p>
        {!dbConnected && (
          <p className="db-hint">Database not connected. Check DATABASE_URL in nest/.env and that MySQL is running.</p>
        )}
      </footer>
    </div>
  )
}
