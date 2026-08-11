import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiGet, apiPost } from '../core/api/client'
import LoadingSkeleton from '../components/LoadingSkeleton'
import { formatDateTime } from '../core/format-utils'
import './import-jobs-page.css'

const POLL_INTERVAL_MS = 15_000

/**
 * Format a duration string from two Date values (local wrapper — shared formatDuration takes ms).
 */
function formatDuration(start, end) {
  if (!start) return '—'
  const startMs = new Date(start).getTime()
  const endMs = end ? new Date(end).getTime() : Date.now()
  const diffSec = Math.round((endMs - startMs) / 1000)
  if (diffSec < 60) return `${diffSec}s`
  const min = Math.floor(diffSec / 60)
  const sec = diffSec % 60
  return sec > 0 ? `${min}m ${sec}s` : `${min}m`
}

/**
 * Status badge class and label
 */
function statusMeta(status) {
  switch (status) {
    case 'completed':
      return { cls: 'badge-completed', label: 'Completed' }
    case 'running':
      return { cls: 'badge-running', label: 'Running' }
    case 'failed':
      return { cls: 'badge-failed', label: 'Failed' }
    case 'queued':
      return { cls: 'badge-queued', label: 'Queued' }
    default:
      return { cls: 'badge-unknown', label: status }
  }
}

export default function ImportJobsPage() {
  const queryClient = useQueryClient()
  const [triggerSymbol, setTriggerSymbol] = useState('')
  const [triggerStatus, setTriggerStatus] = useState(null)

  // Fetch import runs
  const { data, isLoading, isError } = useQuery({
    queryKey: ['import-runs'],
    queryFn: () => apiGet('/api/imports/runs?limit=50'),
    refetchInterval: (query) => {
      // Auto-refresh every 15s when any job is running
      const runs = query.state.data?.runs ?? []
      return runs.some((r) => r.status === 'running') ? POLL_INTERVAL_MS : false
    },
  })

  const runs = data?.runs ?? []
  const services = data?.services ?? {}

  // Summary calculations
  const todayStr = new Date().toDateString()
  const todayRuns = runs.filter((r) => {
    const d = new Date(r.requestedAt)
    return d.toDateString() === todayStr
  })
  const completedOk = runs.filter((r) => r.status === 'completed').length
  const failedCount = runs.filter((r) => r.status === 'failed').length
  const totalRuns = runs.length
  const successRate = totalRuns > 0 ? Math.round((completedOk / totalRuns) * 100) : 0
  const lastRun = runs.length > 0 ? runs[0].requestedAt : null

  // Manual trigger mutation
  const triggerMutation = useMutation({
    mutationFn: (symbolId) => {
      const params = new URLSearchParams({ provider: 'alpaca', timeframe: '1h', source: 'manual-trigger' })
      return apiPost(`/api/imports/trigger/${symbolId}?${params}`)
    },
    onSuccess: () => {
      setTriggerStatus({ type: 'success', message: 'Import queued successfully' })
      setTriggerSymbol('')
      // Refresh the list after a short delay
      setTimeout(() => queryClient.invalidateQueries({ queryKey: ['import-runs'] }), 1000)
    },
    onError: (err) => {
      setTriggerStatus({ type: 'error', message: err.message })
    },
  })

  const handleTrigger = (e) => {
    e.preventDefault()
    setTriggerStatus(null)
    if (!triggerSymbol.trim()) {
      setTriggerStatus({ type: 'error', message: 'Enter a symbol ticker' })
      return
    }
    // Use symbol ID — for MVP we pass the ticker and accept the error gracefully
    triggerMutation.mutate(triggerSymbol.trim().toUpperCase())
  }

  const hasRunning = runs.some((r) => r.status === 'running')

  return (
    <main className="import-jobs-page">
      <header className="import-jobs-header">
        <p className="eyebrow">Data Import Pipeline</p>
        <h1>Import Jobs</h1>
        <p className="import-jobs-subtitle">
          Monitor market data import runs, view status and durations, and trigger
          new imports.
          {hasRunning && (
            <span className="auto-refresh-note"> Auto-refreshing every 15s…</span>
          )}
        </p>
      </header>

      {/* Summary cards */}
      <section className="import-summary">
        <div className="summary-card">
          <span className="summary-value">{todayRuns.length}</span>
          <span className="summary-label">Today&apos;s Imports</span>
        </div>
        <div className="summary-card">
          <span className="summary-value success">{successRate}%</span>
          <span className="summary-label">Success Rate</span>
        </div>
        <div className="summary-card">
          <span className="summary-value">{completedOk}</span>
          <span className="summary-label">Completed</span>
        </div>
        <div className="summary-card">
          <span className="summary-value failed">{failedCount}</span>
          <span className="summary-label">Failed</span>
        </div>
        <div className="summary-card summary-card--wide">
          <span className="summary-label">Last Run</span>
          <span className="summary-value-sm">{lastRun ? formatDateTime(lastRun) : 'None'}</span>
        </div>
      </section>

      {/* Manual trigger */}
      <section className="import-trigger-section">
        <form className="import-trigger-form" onSubmit={handleTrigger}>
          <label htmlFor="trigger-symbol">Trigger Import</label>
          <div className="trigger-input-row">
            <input
              id="trigger-symbol"
              type="text"
              placeholder="Symbol ticker (e.g. AAPL)"
              value={triggerSymbol}
              onChange={(e) => setTriggerSymbol(e.target.value)}
              disabled={triggerMutation.isPending}
              className="trigger-input"
            />
            <button
              type="submit"
              disabled={triggerMutation.isPending}
              className="trigger-btn"
            >
              {triggerMutation.isPending ? 'Triggering…' : 'Trigger Import'}
            </button>
          </div>
          {triggerStatus && (
            <p className={`trigger-status trigger-status--${triggerStatus.type}`}>
              {triggerStatus.message}
            </p>
          )}
        </form>
      </section>

      {/* Runs table */}
      <section className="import-runs-section">
        <h2>Recent Import Runs</h2>

        {isLoading && (
          <div className="ij-loading-group">
            <LoadingSkeleton variant="card" count={4} />
            <LoadingSkeleton variant="table" rows={6} cols={6} className="ls-spacer-top" />
          </div>
        )}

        {isError && (
          <div className="import-empty import-error">
            Failed to load import runs. The API may be offline.
          </div>
        )}

        {!isLoading && !isError && runs.length === 0 && (
          <div className="import-empty">
            No import runs yet. Trigger an import above to get started.
          </div>
        )}

        {!isLoading && !isError && runs.length > 0 && (
          <div className="import-table-wrap">
            <table className="import-table">
              <thead>
                <tr>
                  <th>Timestamp</th>
                  <th>Symbol</th>
                  <th>Provider</th>
                  <th>Timeframe</th>
                  <th>Status</th>
                  <th>Duration</th>
                  <th>Error</th>
                </tr>
              </thead>
              <tbody>
                {runs.map((run) => {
                  const meta = statusMeta(run.status)
                  const duration = formatDuration(
                    run.startedAt || run.requestedAt,
                    run.completedAt,
                  )

                  return (
                    <tr key={run.id} className={`run-row run-row--${run.status}`}>
                      <td className="cell-timestamp">{formatDateTime(run.requestedAt)}</td>
                      <td className="cell-symbol">
                        <span className="ticker">{run.symbol?.ticker ?? run.symbolId}</span>
                        {run.symbol?.name && (
                          <span className="symbol-name">{run.symbol.name}</span>
                        )}
                      </td>
                      <td>{run.provider}</td>
                      <td>{run.timeframe}</td>
                      <td>
                        <span className={`status-badge ${meta.cls}`}>{meta.label}</span>
                      </td>
                      <td className="cell-duration">{duration}</td>
                      <td className="cell-error">
                        {run.error ? (
                          <span className="error-text" title={run.error}>
                            {run.error.length > 60
                              ? `${run.error.slice(0, 60)}…`
                              : run.error}
                          </span>
                        ) : (
                          '—'
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}

        {runs.length > 0 && (
          <p className="import-count">
            Showing {runs.length} run{runs.length !== 1 ? 's' : ''}
            {services.database === false ? ' (offline mode)' : ''}
          </p>
        )}
      </section>
    </main>
  )
}
