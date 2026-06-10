/**
 * SEES Scoring Panel
 * ==================
 * React component that displays ranked symbols with scores and breakdowns.
 *
 * Contract:
 * - Fetches /api/scoring/ranked every 30s via TanStack Query.
 * - Displays symbols in ranked order with score and confidence.
 * - Click expands directive breakdown.
 * - Shows mode badge (fallback/full).
 * - Handles loading, empty, and error states.
 * - Responsive: single column on mobile, table on desktop.
 *
 * Usage: render inside SeesLiveStackMockPage or /sees route.
 */

import { useQuery } from '@tanstack/react-query'
import { fetchRankedSymbols } from '../core/api/scoring'

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

  if (rankQuery.isLoading) {
    return <div className="sees-panel"><p>Loading rankings...</p></div>
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

  return (
    <div className="sees-panel">
      <div className="sees-header">
        <h2>SEES Rankings</h2>
        <span className={`mode-badge mode-${mode}`}>{mode}</span>
        {services.database === false && <span className="chip chip--warn">DB offline</span>}
      </div>

      <table className="sees-table">
        <thead>
          <tr>
            <th>#</th>
            <th>Ticker</th>
            <th>Score</th>
            <th>Confidence</th>
            <th>Freshness</th>
          </tr>
        </thead>
        <tbody>
          {ranked.map((item, i) => (
            <tr key={item.symbolId}>
              <td>{i + 1}</td>
              <td><strong>{item.ticker}</strong></td>
              <td>{(item.score ?? 0).toFixed(1)}</td>
              <td>{((item.confidence ?? 0) * 100).toFixed(0)}%</td>
              <td><span className={`chip chip--${item.freshness === 'fresh' ? 'ok' : item.freshness === 'stale' ? 'warn' : item.freshness === 'missing' ? 'warn' : item.freshness === 'deterministic' ? 'info' : 'neutral'}`}>{item.freshness ?? 'unknown'}</span></td>
            </tr>
          ))}
        </tbody>
      </table>

      <p className="sees-footer">Auto-refresh every 30s · Last: {new Date().toLocaleTimeString()}</p>
    </div>
  )
}
