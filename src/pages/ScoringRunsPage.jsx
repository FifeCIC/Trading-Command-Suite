import React, { useState, useCallback, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiGet, apiPost } from '../core/api/client';

function scoreClass(v) {
  if (v >= 60) return 'pf-green';
  if (v >= 40) return 'pf-amber';
  return 'pf-red';
}

function signalBadge(type, count) {
  if (!count) return null;
  const colors = { buy: '#22c55e', sell: '#ef4444', neutral: '#94a3b8' };
  return (
    <span className="sr-signal-badge" style={{ backgroundColor: colors[type] + '22', color: colors[type], border: `1px solid ${colors[type]}44` }}>
      {count} {type}
    </span>
  );
}

export default function ScoringRunsPage() {
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [page, setPage] = useState(1);
  const [expandedRun, setExpandedRun] = useState(null);
  const [running, setRunning] = useState(false);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [compareMode, setCompareMode] = useState(false);
  const searchTimer = useRef(null);

  // Debounce search
  const handleSearch = useCallback((val) => {
    setSearch(val);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => {
      setDebouncedSearch(val);
      setPage(1);
    }, 350);
  }, []);

  const runsQuery = useQuery({
    queryKey: ['scoring-runs', debouncedSearch, page],
    queryFn: () => {
      const params = new URLSearchParams({ limit: '25', page: String(page) });
      if (debouncedSearch) params.set('search', debouncedSearch);
      return apiGet(`/api/scoring/runs?${params.toString()}`);
    },
    staleTime: 10_000,
    refetchInterval: 30_000,
  });

  const data = runsQuery.data || {};
  const runs = data.runs || [];
  const total = data.total ?? 0;
  const totalPages = data.totalPages ?? 0;
  const queryTimeMs = data.queryTimeMs ?? 0;

  // Expanded run detail query
  const detailQuery = useQuery({
    queryKey: ['scoring-run-detail', expandedRun],
    queryFn: () => apiGet(`/api/scoring/runs/${expandedRun}`),
    enabled: !!expandedRun,
    staleTime: 60_000,
  });

  const toggleExpand = (id) => setExpandedRun((prev) => (prev === id ? null : id));

  function toggleSelect(id) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    if (selectedIds.size === runs.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(runs.map((r) => r.id)));
    }
  }

  const selectedRuns = runs.filter((r) => selectedIds.has(r.id));

  async function triggerRun() {
    setRunning(true);
    try {
      await apiPost('/api/scoring/run', {});
      setTimeout(() => { runsQuery.refetch(); setRunning(false); }, 2000);
    } catch { setRunning(false); }
  }

  // Aggregate stats
  const avgAllScores = runs.length > 0
    ? Math.round(runs.reduce((s, r) => s + (r.avgScore || 0), 0) / runs.length * 10) / 10
    : null;

  return (
    <div className="pf-page">
      {/* ── Header ──────────────────────────────────────────── */}
      <div className="pf-header">
        <div>
          <h1>Scoring Runs</h1>
          {runs.length > 0 && (
            <span className="pf-refreshed">
              {total} run{total !== 1 ? 's' : ''} {queryTimeMs > 0 && `· ${queryTimeMs}ms`}
              {avgAllScores !== null && ` · avg ${avgAllScores}`}
            </span>
          )}
        </div>
        <div className="pf-header-actions">
          <input
            type="text"
            className="settings-input"
            placeholder="Search ticker or strategy…"
            value={search}
            onChange={(e) => handleSearch(e.target.value)}
            style={{ width: 200 }}
          />
          <button className="pf-refresh-btn" onClick={() => runsQuery.refetch()} disabled={runsQuery.isFetching}>
            {runsQuery.isFetching ? '⟳' : '↻'}
          </button>
          <button className="pf-refresh-btn" onClick={triggerRun} disabled={running}>
            {running ? '⟳' : '▶'} Run Now
          </button>
        </div>
      </div>

      {/* ── Loading / Empty ─────────────────────────────────── */}
      {runsQuery.isLoading && <p className="pf-hint">Loading scoring runs…</p>}

      {!runsQuery.isLoading && runs.length === 0 && !debouncedSearch && (
        <div className="pf-unavailable">
          <h2>No Scoring Runs Yet</h2>
          <p>The Score table is empty. Trigger a scoring run or wait for the scheduler.</p>
          <p className="pf-hint">Requires: running backend, configured data providers, active symbols in database.</p>
        </div>
      )}

      {!runsQuery.isLoading && runs.length === 0 && debouncedSearch && (
        <div className="pf-unavailable">
          <h2>No Matching Runs</h2>
          <p>No scoring runs match "{debouncedSearch}". Try a different ticker or strategy name.</p>
        </div>
      )}

      {/* ── Stats Bar ───────────────────────────────────────── */}
      {runs.length > 0 && (
        <div className="sr-stats-bar">
          <span>Page {data.page}/{totalPages || 1}</span>
          <span>{total} total runs</span>
          {selectedIds.size > 0 && (
            <button
              className="pf-refresh-btn"
              onClick={() => setCompareMode(!compareMode)}
              style={{ marginLeft: 'auto', background: compareMode ? 'var(--accent)' : undefined, color: compareMode ? '#fff' : undefined }}
            >
              {compareMode ? '✕ Exit Compare' : `⇆ Compare (${selectedIds.size})`}
            </button>
          )}
        </div>
      )}

      {/* ── Runs Table ──────────────────────────────────────── */}
      {runs.length > 0 && !compareMode && (
        <div className="pf-section">
          <div style={{ overflowX: 'auto' }}>
            <table className="pf-table">
              <thead>
                <tr>
                  <th style={{ width: 32 }}>
                    <input type="checkbox" checked={selectedIds.size === runs.length && runs.length > 0} onChange={toggleSelectAll} />
                  </th>
                  <th>Time</th>
                  <th>Protocol / Strategy</th>
                  <th>Signals</th>
                  <th>Avg</th>
                  <th>Max %</th>
                  <th>Top</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {runs.map((run) => {
                  const expanded = expandedRun === run.id;
                  const sum = run.signalSummary || { buy: 0, sell: 0, neutral: 0 };
                  return (
                    <React.Fragment key={run.id}>
                      <tr
                        className={`directive-row ${expanded ? 'is-selected' : ''} ${selectedIds.has(run.id) ? 'sr-row-checked' : ''}`}
                        style={{ cursor: 'pointer' }}
                      >
                        <td onClick={(e) => e.stopPropagation()}>
                          <input type="checkbox" checked={selectedIds.has(run.id)} onChange={() => toggleSelect(run.id)} />
                        </td>
                        <td style={{ whiteSpace: 'nowrap' }} onClick={() => toggleExpand(run.id)}>
                          {new Date(run.timestamp).toLocaleString(undefined, {
                            month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
                          })}
                        </td>
                        <td onClick={() => toggleExpand(run.id)}>
                          <span className="sruns-strat-name">{run.strategyName || 'Unknown'}</span>
                        </td>
                        <td onClick={() => toggleExpand(run.id)}>
                          <div className="sr-signals">
                            {signalBadge('buy', sum.buy)}
                            {signalBadge('sell', sum.sell)}
                            {signalBadge('neutral', sum.neutral)}
                          </div>
                        </td>
                        <td onClick={() => toggleExpand(run.id)}>
                          <span className={run.avgScore >= 60 ? 'pf-green' : run.avgScore >= 40 ? 'pf-amber' : 'pf-red'}>
                            {run.avgScore?.toFixed(1)}
                          </span>
                        </td>
                        <td onClick={() => toggleExpand(run.id)}>
                          <span style={{ fontWeight: 600, color: 'var(--accent)', fontSize: '0.82rem' }}>
                            {run.maxScore ? `${((run.avgScore / run.maxScore) * 100).toFixed(0)}%` : '—'}
                          </span>
                        </td>
                        <td onClick={() => toggleExpand(run.id)}>
                          {run.topSymbol ? (
                            <span>
                              <strong>{run.topSymbol.ticker}</strong>{' '}
                              <span className={run.topSymbol.value >= 60 ? 'pf-green' : 'pf-red'}>
                                {run.topSymbol.value.toFixed(1)}
                              </span>
                            </span>
                          ) : '—'}
                        </td>
                        <td onClick={() => toggleExpand(run.id)}><span style={{ color: 'var(--accent)' }}>{expanded ? '▾' : '▸'}</span></td>
                      </tr>
                      {/* Inline accordion detail row */}
                      {expanded && (
                        <tr className="sr-expand-row">
                          <td colSpan={8} style={{ padding: '0.5rem 0.7rem', background: 'color-mix(in srgb, var(--panel) 60%, var(--accent))' }}>
                            {detailQuery.isLoading && <p className="pf-hint">Loading scores…</p>}
                            {detailQuery.data?.run?.scores && (
                              <table className="pf-table" style={{ margin: 0, fontSize: '0.8rem' }}>
                                <thead>
                                  <tr>
                                    <th>Ticker</th>
                                    <th>Score</th>
                                    <th>Signal</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {detailQuery.data.run.scores.map((s, i) => (
                                    <tr key={i}>
                                      <td><strong>{s.ticker}</strong></td>
                                      <td className={scoreClass(s.value)}>{s.value.toFixed(1)}</td>
                                      <td>
                                        <span className={scoreClass(s.value)}>
                                          {s.value >= 60 ? '▲ BUY' : s.value >= 40 ? '◆ NEUTRAL' : '▼ SELL'}
                                        </span>
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            )}
                            {!detailQuery.isLoading && !detailQuery.data?.run && (
                              <p className="pf-hint">Scores not available for this run.</p>
                            )}
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="sr-pagination">
              <button disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>← Prev</button>
              <span>Page {page} of {totalPages}</span>
              <button disabled={page >= totalPages} onClick={() => setPage((p) => Math.min(totalPages, p + 1))}>Next →</button>
            </div>
          )}
        </div>
      )}

      {/* ── Compare Mode ─────────────────────────────────── */}
      {compareMode && selectedRuns.length >= 2 && (
        <div className="pf-section sr-compare-panel">
          <h3 style={{ margin: '0 0 0.75rem', fontSize: '1rem' }}>Comparing {selectedRuns.length} Runs</h3>
          <div style={{ display: 'grid', gridTemplateColumns: `repeat(${selectedRuns.length}, 1fr)`, gap: '0.75rem', overflowX: 'auto' }}>
            {selectedRuns.map((run) => (
              <div key={run.id} className="sr-compare-col" style={{ background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: 8, padding: '0.75rem', minWidth: 200 }}>
                <div style={{ fontWeight: 700, fontSize: '0.85rem', marginBottom: '0.4rem' }}>{run.strategyName || 'Unknown'}</div>
                <div style={{ fontSize: '0.72rem', color: 'var(--ink-soft)', marginBottom: '0.5rem' }}>
                  {new Date(run.timestamp).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                </div>
                <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', fontSize: '0.75rem' }}>
                  <span className={run.avgScore >= 60 ? 'pf-green' : run.avgScore >= 40 ? 'pf-amber' : 'pf-red'}>
                    Avg: {run.avgScore?.toFixed(1)}
                  </span>
                  <span style={{ color: 'var(--accent)' }}>
                    {run.maxScore ? `${((run.avgScore / run.maxScore) * 100).toFixed(0)}%` : '—'}
                  </span>
                  {run.topSymbol && <span>Top: <strong>{run.topSymbol.ticker}</strong> {run.topSymbol.value.toFixed(1)}</span>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
