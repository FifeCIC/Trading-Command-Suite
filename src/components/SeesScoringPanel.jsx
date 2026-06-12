/**
 * SEES Scoring Panel
 * ==================
 * Displays ranked symbols with data status, normalized scores, and directive counts.
 *
 * Enhancements (Q114):
 * - dataStatus column: 'live', 'stale', 'no_data', 'error'
 * - normalizedScore shown alongside raw score: "47.1 (47%)"
 * - Active directive count per symbol: "3/5 directives"
 * - Summary bar: "{n} scored | {m} no data | Max possible: {max}"
 * - Special empty state when ALL symbols have no data
 *
 * Usage: render inside SeesLiveStackMockPage or /sees route.
 */

import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { fetchRankedSymbols } from '../core/api/scoring'
import LoadingSkeleton from './LoadingSkeleton'

/**
 * Determine data status for a ranked symbol.
 */
function deriveDataStatus(item) {
  const score = item.score ?? 0
  const fresh = item.freshness ?? ''
  const breakdown = Array.isArray(item.breakdown) ? item.breakdown : []

  // If all directives contributed 0, it's effectively no_data
  const anyContribution = breakdown.some((b) => (b.contribution ?? 0) > 0)

  if (score === 0 && !anyContribution) return 'no_data'
  if (fresh === 'stale') return 'stale'
  if (fresh === 'error') return 'error'
  return 'live'
}

/**
 * Count how many directives actively contributed to a score.
 */
function countActiveDirectives(item) {
  const breakdown = Array.isArray(item.breakdown) ? item.breakdown : []
  return breakdown.filter((b) => (b.contribution ?? 0) > 0).length
}

/**
 * Compute normalized score as percentage of max possible (caps at 100).
 */
function computeNormalized(score) {
  const raw = score ?? 0
  const maxPossible = 100
  return Math.min(100, Math.round((raw / maxPossible) * 100))
}

export default function SeesScoringPanel({ strategyId, limit = 20 }) {
  const rankQuery = useQuery({
    queryKey: ['sees-ranked', strategyId, limit],
    queryFn: () => fetchRankedSymbols(strategyId, limit),
    refetchInterval: 30_000,
  })

  const data = rankQuery.data ?? {}
  const ranked = Array.isArray(data.ranked) ? data.ranked : []
  const mode = data.mode ?? '...'
  const services = data.services ?? {}

  // Derive display states
  const rankedWithMeta = useMemo(
    () =>
      ranked.map((item) => ({
        ...item,
        _dataStatus: deriveDataStatus(item),
        _normalizedPct: computeNormalized(item.score),
        _activeDirectives: countActiveDirectives(item),
        _totalDirectives: Array.isArray(item.breakdown) ? item.breakdown.length : 0,
      })),
    [ranked],
  )

  const noDataCount = rankedWithMeta.filter((r) => r._dataStatus === 'no_data').length
  const scoredCount = rankedWithMeta.filter((r) => r._dataStatus !== 'no_data').length
  const allNoData = noDataCount === rankedWithMeta.length && rankedWithMeta.length > 0

  const maxScore = rankedWithMeta.length > 0
    ? Math.max(...rankedWithMeta.map((r) => r.score ?? 0))
    : 0

  if (rankQuery.isLoading) {
    return (
      <div className="sees-panel">
        <LoadingSkeleton variant="table" rows={5} cols={5} />
      </div>
    )
  }

  if (rankQuery.isError) {
    return (
      <div className="sees-panel">
        <p className="error">Could not load rankings. Check backend availability.</p>
        <button type="button" className="tp-banner-retry" onClick={() => rankQuery.refetch()}>Retry</button>
      </div>
    )
  }

  if (ranked.length === 0) {
    return (
      <div className="sees-panel">
        <p>No ranked symbols yet.</p>
        <p className="hint">
          Mode: <strong>{mode}</strong>. Symbols need price data before scoring can produce rankings.
        </p>
      </div>
    )
  }

  // All-no-data empty state
  if (allNoData) {
    return (
      <div className="sees-panel">
        <div className="sees-header">
          <h2>SEES Rankings</h2>
          <span className={`mode-badge mode-${mode}`}>{mode}</span>
        </div>
        <div className="sees-empty-no-data">
          <p className="sees-empty-icon">📊</p>
          <p><strong>No market data available.</strong></p>
          <p>Check provider credentials in <code>.env</code> or seed market data to see scores.</p>
          <div className="sees-empty-actions" style={{ marginTop: '1rem', display: 'flex', gap: '0.5rem', justifyContent: 'center' }}>
            <button type="button" className="btn" onClick={() => rankQuery.refetch()}>
              Refresh
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="sees-panel">
      {/* Header */}
      <div className="sees-header">
        <h2>SEES Rankings</h2>
        <span className={`mode-badge mode-${mode}`}>{mode}</span>
        {services.database === false && <span className="chip chip--warn">DB offline</span>}
      </div>

      {/* Summary bar */}
      <div className="sees-summary-bar">
        <span className="sees-summary-stat">
          <strong>{scoredCount}</strong> scored
        </span>
        {noDataCount > 0 && (
          <span className="sees-summary-stat sees-summary-stat--muted">
            <strong>{noDataCount}</strong> without data
          </span>
        )}
        <span className="sees-summary-stat sees-summary-stat--muted">
          Max possible: <strong>{maxScore.toFixed(1)}</strong>
        </span>
      </div>

      {/* Scoring table */}
      <table className="sees-table">
        <thead>
          <tr>
            <th>#</th>
            <th>Ticker</th>
            <th>Score</th>
            <th>Directives</th>
            <th>Data</th>
            <th>Freshness</th>
          </tr>
        </thead>
        <tbody>
          {rankedWithMeta.map((item, i) => (
            <tr key={item.symbolId} className={`sees-row--${item._dataStatus}`}>
              <td>{i + 1}</td>
              <td>
                <strong className={item._dataStatus === 'no_data' ? 'sees-ticker--muted' : ''}>
                  {item.ticker}
                </strong>
              </td>
              <td>
                {item._dataStatus === 'no_data' ? (
                  <span className="chip chip--warn">No data</span>
                ) : (
                  <>
                    <span className="sees-raw-score">{(item.score ?? 0).toFixed(1)}</span>
                    <span className="sees-normalized"> ({item._normalizedPct}%)</span>
                  </>
                )}
              </td>
              <td className="sees-directive-count">
                {item._activeDirectives}/{item._totalDirectives}
              </td>
              <td>
                <span className={`chip chip--${item._dataStatus === 'live' ? 'ok' : item._dataStatus === 'stale' ? 'warn' : item._dataStatus === 'error' ? 'warn' : 'neutral'}`}>
                  {item._dataStatus === 'live' ? 'Live' : item._dataStatus === 'stale' ? 'Stale' : item._dataStatus === 'error' ? 'Error' : 'No Data'}
                </span>
              </td>
              <td>
                {item.freshness ? (
                  <span className={`chip chip--${item.freshness === 'fresh' ? 'ok' : item.freshness === 'stale' ? 'warn' : item.freshness === 'deterministic' ? 'info' : 'neutral'}`}>
                    {item.freshness === 'fresh' ? '✓ Fresh' : item.freshness === 'stale' ? '⏱ Stale' : item.freshness === 'deterministic' ? '∼ Determ.' : item.freshness}
                  </span>
                ) : (
                  <span className="chip chip--neutral">—</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <p className="sees-footer">Auto-refresh every 30s · Last: {new Date().toLocaleTimeString()}</p>
    </div>
  )
}
