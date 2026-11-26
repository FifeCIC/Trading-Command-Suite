import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { apiGet } from '../core/api/client'
import { feedUnavailable, feedState } from '../core/api/feed-state.js'
import LoadingSkeleton from '../components/LoadingSkeleton.jsx'
import LoadingOrbit from '../components/LoadingOrbit.jsx'
import './database-tables.css'

/**
 * DatabaseTablesPage — the TABLE REGISTRY (Development → Database Tables).
 *
 * ⚠️ EVERYTHING ON THIS PAGE COMES FROM `/api/database/table-stats`. The page holds NO table list.
 * It used to: a hand-written array of 20 tables (out of ~135) with hand-written descriptions, which
 * is why seven `…Meta` tables could sit here as `status: 'active'` with phpMyAdmin links that 404'd
 * (#1288, #1292). A registry that restates the schema is a second copy of the schema, and only one
 * of the copies gets corrected. `?tables=declared` asks the server for the declared set instead.
 *
 * ── The three questions this page answers, and where each answer is OWNED ──────────────────────
 *   1. What is this table for?              → `table-usage.data.ts`  (declared, joined server-side)
 *   2. How big is it, how fast does it grow? → `SHOW TABLE STATUS` + a measured growth span
 *   3. How long is it kept?                 → `retention.config.ts`  (the ONE owner of windows)
 * This page is the join. It must never become a fourth declaration of any of the three.
 *
 * ── THE STYLING IS QUOTED, NOT DRAWN (2026-11-25, owner correction) ────────────────────────────
 * *"you've not used an authorised table styling … it's almost like every table gets its own
 * approach. The Theme page has some of the accepted designs."* Correct. This page now uses the
 * gallery's named specimens verbatim:
 *
 *   Summary Strip → `.thm-tint` / `.thm-stat-grid` / `.thm-stat`   (`core/specimens.css`)
 *   Chip Bar      → `.thm-chipbar` / `.thm-chipset` / `.thm-chip`  (`core/specimens.css`)
 *   Spacious Table→ `.thm-scroll` / `.thm-table .thm-table--spacious` (`core/specimens.css` + `core/tables.css`)
 *   Tones         → `.thm-sym` / `.thm-num` / `.thm-soft` / `.thm-muted` / `.thm-accent` / `.thm-warn`
 *
 * `database-tables.css` is now width, one column minimum and the WCAG tap target — and says so at
 * each rule. ⚠️ The next page that wants a summary strip must import the specimen, not redraw it.
 *
 * ── Loading is STATED, never absent ───────────────────────────────────────────────────────────
 * The first paint used to show a dash in every cell and a bare line reading "Reading table
 * statistics…", which the owner read as a broken page for the 3–5 s the two COUNT passes take. A
 * wait whose shape is known gets a SKELETON, and the label survives a screen reader, a screenshot
 * and `prefers-reduced-motion` — none of which an animation survives.
 */

const CLASS_LABELS = {
  present: 'present',
  input: 'input',
  history: 'history',
  trace: 'trace',
  reference: 'reference',
  undeclared: 'undeclared',
}

const FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'hot', label: 'Hot path' },
  { id: 'unbounded', label: 'No bound' },
  { id: 'trace', label: 'Trace' },
  { id: 'undeclared', label: 'Undeclared' },
]

function mb(kb) {
  if (typeof kb !== 'number' || Number.isNaN(kb)) return '—'
  if (kb < 1024) return `${kb} KB`
  return `${(kb / 1024).toFixed(kb < 1024 * 100 ? 1 : 0)} MB`
}

function rowCount(stat) {
  if (!stat || typeof stat.rowCount !== 'number') return '—'
  // An estimate is marked as one. A number that looks exact and is 35% out is the defect this page
  // was fixed for (#1292); the source travels with the value.
  return stat.rowCountSource === 'exact'
    ? stat.rowCount.toLocaleString()
    : `≈${stat.rowCount.toLocaleString()}`
}

export default function DatabaseTablesPage() {
  const [filter, setFilter] = useState('all')

  const tableStats = useQuery({
    queryKey: ['db-table-stats-registry'],
    queryFn: () => apiGet('/api/database/table-stats?tables=declared'),
    retry: 1,
    staleTime: 30_000,
  })

  const rows = Array.isArray(tableStats.data?.tables) ? tableStats.data.tables : []
  const summary = tableStats.data?.summary ?? {}
  const database = tableStats.data?.database ?? null
  const unreadable = feedUnavailable(tableStats)
  const loading = feedState(tableStats) === 'loading'

  const sorted = useMemo(
    () => [...rows].sort((a, b) => (b.totalSizeKb ?? 0) - (a.totalSizeKb ?? 0)),
    [rows],
  )

  const visible = useMemo(() => {
    switch (filter) {
      case 'hot': return sorted.filter((r) => r.readBy === 'hot-path')
      case 'unbounded': return sorted.filter((r) => r.retentionDays === null)
      case 'trace': return sorted.filter((r) => r.class === 'trace')
      case 'undeclared': return sorted.filter((r) => r.class === 'undeclared')
      default: return sorted
    }
  }, [sorted, filter])

  const totalKb = typeof summary.totalDataKb === 'number'
    ? summary.totalDataKb + (summary.totalIndexKb ?? 0)
    : null

  return (
    <div className="database-tables-page">
      {/* ⚠️ NO PAGE HEADER. A page supplies CONTENT; the shell supplies CHROME (2026-11-18 rule, and
          the owner restated it here on 2026-11-26: "Text introduction on pages is against design
          rules for this app"). The explanation lives in `VIEW_EXPLANATIONS['database-tables']` and is
          rendered as the one ℹ in `.main-top-row`. A paragraph here would be a second copy of it. */}
      {unreadable && (
        <p className="db-unread" role="alert">
          ⚠️ The table registry could not be read — every column below is <strong>unknown</strong>,
          not empty.{' '}
          <button type="button" className="db-unread-retry" onClick={() => tableStats.refetch()}>
            retry
          </button>
        </p>
      )}

      {/* SUMMARY STRIP (specimen). Not rendered while loading: five dashes read as a report of zero,
          and "nothing stored" is the one thing this page must never imply while it is still asking. */}
      {!loading && !unreadable && (
        <div className="thm-tint">
          <div className="thm-stat-grid">
            <div className="thm-stat">
              <span className="thm-stat-label">Tables</span>
              <span className="thm-stat-value">{summary.totalTables ?? '—'}</span>
            </div>
            <div className="thm-stat">
              <span className="thm-stat-label">Total on disk</span>
              <span className="thm-stat-value">{totalKb == null ? '—' : mb(totalKb)}</span>
            </div>
            <div className="thm-stat">
              <span className="thm-stat-label">Read by the loop &gt;5 MB</span>
              <span className="thm-stat-value">{summary.hotPathLarge ?? '—'}</span>
            </div>
            <div className={`thm-stat${summary.unboundedLarge ? ' thm-stat--accent' : ''}`}>
              <span className="thm-stat-label">No bound &gt;5 MB</span>
              <span className={`thm-stat-value${summary.unboundedLarge ? ' thm-warn' : ''}`}>
                {summary.unboundedLarge ?? '—'}
              </span>
            </div>
            <div className="thm-stat">
              <span className="thm-stat-label">Undeclared</span>
              <span className="thm-stat-value">{summary.undeclared ?? '—'}</span>
            </div>
          </div>
        </div>
      )}

      {/* CHIP BAR (specimen). `.db-filter` adds only the WCAG tap target — see the page stylesheet.
          Withheld while the feed is unreadable: a filter row over nothing suggests there is a
          result set to narrow, which is the same misreading as an empty table. */}
      {!loading && !unreadable && (
        <div className="thm-chipbar db-filterbar">
          <div className="thm-chipset">
            <span className="thm-chipset-label">Filter</span>
            {FILTERS.map((f) => (
              <button
                key={f.id}
                type="button"
                className={`thm-chip db-filter${filter === f.id ? ' is-on' : ''}`}
                aria-pressed={filter === f.id}
                onClick={() => setFilter(f.id)}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {summary.declaredMissing?.length > 0 && (
        <p className="db-note">
          <span className="thm-warn">Declared but not in the database:</span>{' '}
          {summary.declaredMissing.map((t) => <code key={t}>{t}</code>)}{' '}
          — either the table was renamed or dropped, or the declaration is stale.
        </p>
      )}

      {summary.growthMeasured === false && !unreadable && (
        <p className="db-note">
          <span className="thm-warn">Growth could not be measured</span> — the <strong>/day</strong>{' '}
          column is unknown, not zero.
        </p>
      )}

      {loading ? (
        <div className="thm-scroll db-loading">
          <LoadingOrbit size="sm" label="Reading table statistics…" />
          <LoadingSkeleton variant="table" rows={8} cols={6} />
        </div>
      ) : unreadable ? null : (
        <div className="thm-scroll">
          <table className="thm-table thm-table--spacious">
            <caption className="db-caption">
              {visible.length} of {rows.length} tables, largest first. Retention windows live in{' '}
              <code>retention.config.ts</code>; table roles live in <code>table-usage.data.ts</code>.
            </caption>
            <thead>
              <tr>
                <th scope="col">Table</th>
                <th scope="col">Class</th>
                <th scope="col">Purpose</th>
                <th scope="col">Written</th>
                <th scope="col" title="hot path = read repeatedly by the scoring/trading loop while it runs">Read by</th>
                <th scope="col" className="db-num">Rows</th>
                <th scope="col" className="db-num">Size</th>
                <th
                  scope="col"
                  className="db-num"
                  title="Rows per day across the span actually retained — a lifetime average of what survives, not today's rate."
                >
                  /day
                </th>
                <th scope="col">Retention</th>
                <th scope="col">Open</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((t) => {
                const hot = t.readBy === 'hot-path'
                const unbounded = t.retentionDays === null
                return (
                  <tr key={t.tableName}>
                    <td className="thm-sym">{t.tableName}</td>
                    <td className={t.class === 'undeclared' ? 'thm-warn' : 'thm-soft'}>
                      {CLASS_LABELS[t.class] ?? t.class}
                    </td>
                    <td className="db-purpose">
                      {t.purpose ?? <em className="thm-muted">no declared purpose</em>}
                    </td>
                    <td className="thm-muted">{t.writtenPer ?? '—'}</td>
                    <td className={hot ? 'thm-accent' : 'thm-muted'}>
                      {t.readBy == null ? '—' : hot ? 'hot path' : t.readBy}
                    </td>
                    <td className="db-num thm-num">{rowCount(t)}</td>
                    <td className="db-num thm-num">{mb(t.totalSizeKb)}</td>
                    <td className="db-num thm-num thm-muted">
                      {t.growthPerDay == null ? '—' : t.growthPerDay.toLocaleString()}
                    </td>
                    <td className={unbounded ? 'thm-warn' : 'thm-soft'}>
                      {unbounded ? 'no bound' : `${t.retentionDays}d`}
                    </td>
                    <td>
                      <a
                        href={`http://localhost/phpmyadmin/index.php?route=/table/sql${database ? `&db=${encodeURIComponent(database)}` : ''}&table=${encodeURIComponent(t.tableName)}`}
                        target="_blank"
                        rel="noreferrer"
                        className="db-open-link"
                        aria-label={`Open ${t.tableName} in phpMyAdmin`}
                        title="Open in phpMyAdmin"
                      >
                        🔗
                      </a>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {!loading && !unreadable && visible.length === 0 && (
        <p className="db-note">No table matches this filter.</p>
      )}

      <footer className="page-footer">
        <p>
          Database: {database ?? 'unknown'} · ORM: Prisma · Engine: MySQL.
        </p>
      </footer>
    </div>
  )
}
