import { useQuery } from '@tanstack/react-query'
import { apiGet } from '../core/api/client'
import { feedUnavailable } from '../core/api/feed-state.js'
import './database-tables.css'

// These mirror the Prisma schema models and planned tables.
//
// ⚠️ THE TABLE NAME IS THE LOOKUP KEY, AND IT IS THE SQL NAME (lowercase). Everything else on the
// row — row count, last write, whether it exists at all — comes from `/api/database/table-stats`.
// A row listed here that the database does not have renders as **not in db** rather than as an
// active table, so the next table to be dropped shows up as a visible gap instead of a confident
// lie.
//
// ⚠️ SEVEN `…Meta` ROWS WERE REMOVED 2026-11-18 (#1288, #1292): `DataSourcesMeta`, `CacheMeta`,
// `StrategyMeta`, `WatchlistMeta`, `CronMeta`, `ProcessMeta`, `NewsMeta`. None of those tables ever
// existed in the database — measured against the live schema — and they were listed here as
// `status: 'active'` with a phpMyAdmin link that 404s. Six of the seven were the unused `…Meta`
// tables dropped in #1288; the page had simply never been told.
const ALL_TABLES = [
  // Core Trading Tables
  { name: 'Symbol', description: 'Trading symbols and company data', status: 'active' },
  { name: 'Strategy', description: 'Trading strategies and rules', status: 'active' },
  { name: 'Directive', description: 'Scoring directive definitions', status: 'active' },
  { name: 'Score', description: 'Symbol scoring history', status: 'active' },
  { name: 'Signal', description: 'Trading signal records (no writer — see #1288)', status: 'active' },
  { name: 'MarketBar', description: 'OHLCV price data from imports', status: 'active' },
  { name: 'ImportRun', description: 'Data import job tracking', status: 'active' },
  { name: 'ProviderHealth', description: 'Provider connectivity status', status: 'active' },

  // Symbol Meta Tables (Planned — genuinely not built)
  { name: 'SymbolMeta', description: 'Extended symbol metadata storage', status: 'planned' },
  { name: 'SymbolFundamentals', description: 'Fundamental data (PE, EPS, etc.)', status: 'planned' },
  { name: 'SymbolTechnical', description: 'Technical indicators by timeframe', status: 'active' },

  // API Management Tables
  { name: 'ApiCalls', description: 'API call tracking for rate limiting', status: 'active' },
  { name: 'ApiCredentials', description: 'Encrypted API credentials storage', status: 'active' },

  // Strategy Tables
  { name: 'StrategyPerformance', description: 'Strategy performance tracking', status: 'active' },

  // User Activity Tables
  { name: 'UserPreferences', description: 'User trading preferences', status: 'active' },
  { name: 'Watchlist', description: 'User watchlists', status: 'active' },

  // Market Context Tables
  { name: 'MarketSessions', description: 'Market session information (London/NY/Asia)', status: 'active' },

  // Order Management
  { name: 'Order', description: 'Trading orders', status: 'active' },
  { name: 'OrderExecution', description: 'Order execution history', status: 'active' },
  { name: 'Position', description: 'Open trading positions', status: 'active' },
  { name: 'Trade', description: 'Completed trade records', status: 'active' },
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

  // Table stats — row counts, sizes, last write.
  // ⚠️ NO `.catch(() => ({}))` (#782 / INV-NO-EMPTY-SWALLOW). `tStats` drives the Rows and
  // Last Insert columns; an empty object renders every table as having NO DATA, which is the claim
  // this page exists to make truthfully.
  //
  // ⚠️ `?tables=` IS NOT OPTIONAL HERE. Without it the endpoint returns InnoDB's row ESTIMATE, which
  // is not close on a table with churn — measured 2026-11-18: `newsarticle` 34,821 against a real
  // 52,048 (−33%), `score` 12,482 against 19,103 (−35%), `position` 25 against 11 (+127%). Naming
  // the tables switches those rows to `COUNT(*)` and costs ~0.5 s for all 19 of them.
  const tableStats = useQuery({
    queryKey: ['db-table-stats'],
    queryFn: () =>
      apiGet(
        `/api/database/table-stats?tables=${ALL_TABLES.filter((t) => t.status === 'active')
          .map((t) => t.name)
          .join(',')}`,
      ),
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

  // ⚠️ THE API RETURNS AN ARRAY OF ROWS KEYED BY SQL TABLE NAME, NOT A RECORD KEYED BY PRISMA MODEL.
  // This was read as `data.tables['Symbol']`, which on an array is `undefined` — so every cell in the
  // Last Insert column rendered `—` for every table, on a page whose whole purpose is to report it.
  // Measured 2026-11-18 before the fix: `GET /api/database/table-stats` returned 130 rows carrying
  // `lastInsert`, e.g. `alert` = 2026-11-17T19:40:07Z, and the page discarded all of them.
  const statRows = Array.isArray(tableStats.data?.tables) ? tableStats.data.tables : []
  const statByTable = new Map(statRows.map((row) => [String(row.tableName).toLowerCase(), row]))
  const databaseName = tableStats.data?.database ?? null
  const statsReadable = statRows.length > 0

  /** The live row for this table, or `undefined` when the database does not have it. */
  function statOf(tableName) {
    return statByTable.get(tableName.toLowerCase())
  }

  function rowCount(tableName) {
    const stat = statOf(tableName)
    if (!stat) return '—'
    if (typeof stat.rowCount !== 'number') return '—'
    // An estimate is marked as one. A number that looks exact and is 35% out is the defect this
    // page was just fixed for; the source travels with the value.
    return stat.rowCountSource === 'exact'
      ? stat.rowCount.toLocaleString()
      : `≈${stat.rowCount.toLocaleString()}`
  }

  function tableStatus(table) {
    if (table.status === 'planned') return 'planned'
    if (!dbConnected) return 'offline'
    // A table the stats feed knows nothing about is either absent or unreadable; both are stated,
    // neither is presented as a working table.
    if (!statsReadable) return 'unknown'
    return statOf(table.name) ? 'installed' : 'missing'
  }

  function statusChip(status) {
    const labels = {
      installed: 'ok',
      present: 'neutral',
      offline: 'warn',
      planned: 'info',
      missing: 'error',
      unknown: 'warn',
    }
    const chipLabels = {
      installed: 'installed',
      present: 'present',
      offline: 'offline',
      planned: 'planned',
      missing: 'not in db',
      unknown: 'unreadable',
    }
    return <span className={`db-chip db-chip--${labels[status] || 'neutral'}`}>{chipLabels[status] || status}</span>
  }

  function lastInsert(tableName) {
    const stat = statOf(tableName)
    if (!stat?.lastInsert) return '—'
    return new Date(stat.lastInsert).toLocaleString()
  }

  function phpMyAdminLink(tableName) {
    // `db` comes from the API (`SELECT DATABASE()`), so a second deployment does not link to this
    // machine's schema name. Omitted when unknown, so phpMyAdmin falls back to its default.
    const db = databaseName ? `&db=${encodeURIComponent(databaseName)}` : ''
    return `http://localhost/phpmyadmin/index.php?route=/table/sql${db}&table=${tableName}`
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

      {feedUnavailable(tableStats) && (
        <p className="db-unread" role="alert">
          ⚠️ Table statistics could not be read — the <strong>Rows</strong> and{' '}
          <strong>Last Write</strong> columns below are unknown for every table, not "no data".{' '}
          <button type="button" className="db-unread-retry" onClick={() => tableStats.refetch()}>retry</button>
        </p>
      )}

      <table className="tables-table">
        <thead>
          <tr>
            <th>Table</th>
            <th>Description</th>
            <th>Status</th>
            <th title="COUNT(*) for the tables named in the request. A leading ≈ means the server could only supply InnoDB's row estimate.">Rows</th>
            <th>Version</th>
            <th title="SHOW TABLE STATUS.Update_time — the last WRITE to the table, not the last row inserted. InnoDB often reports NULL, which is unknown rather than zero.">Last Write</th>
            <th className="dt-col-view">View</th>
          </tr>
        </thead>
        <tbody>
          {ALL_TABLES.map((t) => {
            const status = tableStatus(t)
            const present = status === 'installed'
            return (
              <tr key={t.name} className={t.status === 'planned' ? 'row-planned' : ''}>
                <td><code>{t.name}</code></td>
                <td>{t.description}</td>
                <td>{statusChip(status)}</td>
                <td className="num">{t.status === 'planned' ? '—' : rowCount(t.name)}</td>
                <td className="num dt-num-sm">{present ? `Prisma ${prismaVersion}` : '—'}</td>
                <td className="num dt-num-sm">{present ? lastInsert(t.name) : '—'}</td>
                <td>
                  {present && (
                    <a href={phpMyAdminLink(t.name)} target="_blank" rel="noreferrer" className="tp-chip tp-chip--info dt-phpmyadmin-link" title="Open in phpMyAdmin">
                      🔗
                    </a>
                  )}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>

      <footer className="page-footer">
        <p>Engine: MySQL 9.1 (WAMP) · Database: {databaseName ?? 'unknown'} · ORM: Prisma {prismaVersion}</p>
        {/*
          ⚠️ THIS FOOTER USED TO READ "Migrations are applied with `npx prisma db push`" — an
          instruction to run the one command this repo BANS. `db push` treats `schema.prisma` as the
          complete truth and drops every table that has no model, which is 13 tables here including
          the trade execution queue (`strategy_signal_queue`). It does not error; it warns and waits
          for a `y`. Replaced 2026-11-18 (#1292).
        */}
        <p>
          Tables are declared in <code>nest/prisma/schema.prisma</code>, which is documentation — not the
          schema. Several tables are managed outside Prisma, so changes are applied with explicit{' '}
          <code>ALTER TABLE</code> / <code>CREATE TABLE</code> and then{' '}
          <code>npx prisma generate</code>. <strong>Never</strong> <code>npx prisma db push</code> — it
          drops every table that has no model. Run <code>npm --prefix nest run db:check</code> first.
        </p>
        {!dbConnected && (
          <p className="db-hint">Database not connected. Check DATABASE_URL in nest/.env and that MySQL is running.</p>
        )}
      </footer>
    </div>
  )
}
