import { useQuery } from '@tanstack/react-query'
import { apiGet } from '../core/api/client'
import './database-tables.css'

// These mirror the Prisma schema models
const ALL_TABLES = [
  { name: 'Symbol', prismaModel: 'Symbol', description: 'Trading symbols and company data' },
  { name: 'Strategy', prismaModel: 'Strategy', description: 'Trading strategies and rules' },
  { name: 'Directive', prismaModel: 'Directive', description: 'Scoring directive definitions' },
  { name: 'Score', prismaModel: 'Score', description: 'Symbol scoring history' },
  { name: 'Signal', prismaModel: 'Signal', description: 'Trading signal records' },
  { name: 'MarketBar', prismaModel: 'MarketBar', description: 'OHLCV price data from imports' },
  { name: 'ImportRun', prismaModel: 'ImportRun', description: 'Data import job tracking' },
  { name: 'ProviderHealth', prismaModel: 'ProviderHealth', description: 'Provider connectivity status' },
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

  function tableStatus(modelName) {
    if (!dbConnected) return 'offline'
    const count = rowCount(modelName)
    if (typeof count === 'number' && count >= 0) return 'installed'
    return 'present'
  }

  function statusChip(status) {
    const labels = { installed: 'ok', present: 'neutral', offline: 'warn' }
    return <span className={`chip chip--${labels[status] || 'neutral'}`}>{status}</span>
  }

  return (
    <div className="database-tables-page">
      <header className="page-header">
        <h1>Database Tables</h1>
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
            <tr key={t.name}>
              <td><code>{t.name}</code></td>
              <td>{t.description}</td>
              <td>{statusChip(tableStatus(t.prismaModel))}</td>
              <td className="num">{rowCount(t.prismaModel)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <footer className="page-footer">
        <p>Engine: MySQL 9.1 (WAMP) · Database: tradingcs · ORM: Prisma 5.22.0</p>
        {!dbConnected && (
          <p className="hint">Database not connected. Check DATABASE_URL in nest/.env and that MySQL is running.</p>
        )}
      </footer>
    </div>
  )
}
