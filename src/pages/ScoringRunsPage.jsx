import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiGet, apiPost } from '../core/api/client';

// ── Date filter options ────────────────────────────────────
const DATE_FILTERS = [
  { id: 'all', label: 'All Time' },
  { id: '1h', label: 'Last Hour' },
  { id: '24h', label: 'Last 24h' },
  { id: '7d', label: 'Last 7 Days' },
];

export default function ScoringRunsPage() {
  const [expandedRun, setExpandedRun] = useState(null);
  const [dateFilter, setDateFilter] = useState('all');
  const [running, setRunning] = useState(false);

  const runsQuery = useQuery({
    queryKey: ['scoring-runs'],
    queryFn: () => apiGet('/api/scoring/runs?limit=50'),
    staleTime: 10_000,
    refetchInterval: 30_000,
  });

  const runs = runsQuery.data?.runs || [];
  const now = Date.now();
  const filters = {
    '1h': (r) => new Date(r.timestamp).getTime() > now - 3600000,
    '24h': (r) => new Date(r.timestamp).getTime() > now - 86400000,
    '7d': (r) => new Date(r.timestamp).getTime() > now - 604800000,
  };

  const filteredRuns = dateFilter === 'all' ? runs : runs.filter(filters[dateFilter] || (() => true));

  const toggleExpand = (id) => setExpandedRun((prev) => (prev === id ? null : id));

  async function triggerRun() {
    setRunning(true);
    try {
      await apiPost('/api/scoring/run', {});
      setTimeout(() => runsQuery.refetch(), 2000);
    } catch { /* run may fail if pipeline not configured */ }
    setRunning(false);
  }

  return (
    <div className="pf-page">
      {/* ── Header ──────────────────────────────────────────── */}
      <div className="pf-header">
        <div>
          <h1>Scoring Runs</h1>
          {runs.length > 0 && (
            <span className="pf-refreshed">{runs.length} run{runs.length !== 1 ? 's' : ''} logged</span>
          )}
        </div>
        <div className="pf-header-actions">
          <select className="pf-source-select" value={dateFilter} onChange={(e) => setDateFilter(e.target.value)}>
            {DATE_FILTERS.map((f) => (
              <option key={f.id} value={f.id}>{f.label}</option>
            ))}
          </select>
          <button className="pf-refresh-btn" onClick={() => runsQuery.refetch()} disabled={runsQuery.isFetching}>
            {runsQuery.isFetching ? '⟳' : '↻'} Refresh
          </button>
          <button className="pf-refresh-btn" onClick={triggerRun} disabled={running}>
            {running ? '⟳' : '▶'} Run Now
          </button>
        </div>
      </div>

      {/* ── Loading / Empty ─────────────────────────────────── */}
      {runsQuery.isLoading && <p className="pf-hint">Loading scoring runs…</p>}

      {!runsQuery.isLoading && runs.length === 0 && (
        <div className="pf-unavailable">
          <h2>No Scoring Runs Yet</h2>
          <p>The Score table is empty. Trigger a scoring run or wait for the scheduler.</p>
          <p className="pf-hint">Requires: running backend, configured data providers, active symbols in database.</p>
        </div>
      )}

      {/* ── Runs Table ──────────────────────────────────────── */}
      {filteredRuns.length > 0 && (
        <div className="pf-section">
          <div style={{ overflowX: 'auto' }}>
            <table className="pf-table">
              <thead>
                <tr>
                  <th>Timestamp</th>
                  <th>Strategy</th>
                  <th>Symbols Scored</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {filteredRuns.map((run) => {
                  const expanded = expandedRun === run.id;
                  return (
                    <>
                      <tr
                        key={run.id}
                        className={`directive-row ${expanded ? 'is-selected' : ''}`}
                        onClick={() => toggleExpand(run.id)}
                        style={{ cursor: 'pointer' }}
                      >
                        <td>
                          {new Date(run.timestamp).toLocaleString(undefined, {
                            month: 'short',
                            day: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </td>
                        <td>
                          <span className="sruns-strat-name">{run.strategyName || 'Unknown'}</span>
                          <span className="sruns-strat-id">{run.strategyId?.slice(0, 8)}</span>
                        </td>
                        <td>{run.symbolsScored}</td>
                        <td>
                          <span style={{ color: 'var(--accent)' }}>{expanded ? '▾' : '▸'}</span>
                        </td>
                      </tr>
                      {expanded && (
                        <tr>
                          <td colSpan={4} className="directive-expand" style={{ padding: 0 }}>
                            <div style={{ padding: '0.8rem 1rem' }}>
                              <table className="pf-table" style={{ margin: 0 }}>
                                <thead>
                                  <tr>
                                    <th>Ticker</th>
                                    <th>Score</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {run.scores.map((s, i) => (
                                    <tr key={i}>
                                      <td><strong>{s.ticker}</strong></td>
                                      <td className={s.value >= 60 ? 'pf-green' : s.value >= 40 ? '' : 'pf-red'}>
                                        {s.value?.toFixed(1)}
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          </td>
                        </tr>
                      )}
                    </>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
