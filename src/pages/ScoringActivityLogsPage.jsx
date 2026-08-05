import { useState, useMemo, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { useQuery } from '@tanstack/react-query';
import { apiGet } from '../core/api/client';
import LoadingSkeleton from '../components/LoadingSkeleton';
import ApiOfflineBanner from '../components/ApiOfflineBanner';
import './scoring-activity-logs.css';

function DirectiveTrace({ symbol, onClose }) {
  const envQuery = useQuery({
    queryKey: ['directive-trace', symbol],
    queryFn: () => apiGet(`/api/signals/envelope/${symbol}`),
    staleTime: 30000,
  });
  const env = envQuery.data;

  if (envQuery.isLoading) return <p className="sal-trace-loading">Loading directive trace for {symbol}...</p>;
  if (!env || env.groups?.length === 0) return <p className="sal-trace-empty">No directive data for {symbol}.</p>;

  return (
    <div className="sal-trace">
      <div className="sal-trace-head">
        <span>{symbol}</span>
        <span style={{ color: env.signal === 'BUY' ? '#22c55e' : env.signal === 'SELL' ? '#ef4444' : '#94a3b8', fontWeight: 800 }}>
          {env.composite.toFixed(0)} — {env.signal}
        </span>
        <button className="sal-trace-close" onClick={onClose}>✕</button>
      </div>
      <div className="sal-trace-groups">
        {env.groups.map(g => (
          <div key={g.groupId} className={`sal-trace-group ${g.isRisk ? 'sal-trace-risk' : ''}`}>
            <div className="sal-trace-group-head">
              <span>{g.groupName}</span>
              <span style={{ color: g.score > 65 ? '#22c55e' : g.score < 35 ? '#ef4444' : '#94a3b8' }}>{g.score}</span>
            </div>
            {g.topDirectives.map(d => (
              <div key={d.id} className={`sal-trace-dir sal-trace-${d.signalClass}`}>
                <span className="sal-trace-dir-name">{d.name}</span>
                <span className="sal-trace-dir-score">{d.normalized}</span>
                <span className="sal-trace-dir-reason">{d.reason}</span>
              </div>
            ))}
          </div>
        ))}
      </div>
      {env.conflicts?.length > 0 && (
        <div className="sal-trace-conflicts">
          {env.conflicts.map((c, i) => <span key={i} className="sal-conflict-chip">{c.description}</span>)}
        </div>
      )}
    </div>
  );
}

function getPctColor(v, max) {
  if (!max || max === 0) return 'sal-pct-mid';
  const pct = v / max;
  if (pct >= 0.7) return 'sal-pct-high';
  if (pct >= 0.35) return 'sal-pct-mid';
  return 'sal-pct-low';
}

function getPctLabel(v, max) {
  if (!max || max === 0) return '?%';
  return Math.round((v / max) * 100) + '%';
}

export default function ScoringActivityLogsPage() {
  const [filter, setFilter] = useState('all');
  const [expandedRun, setExpandedRun] = useState(null);
  const [sortBy, setSortBy] = useState('time');
  const [traceSymbol, setTraceSymbol] = useState(null);

  const runsQuery = useQuery({
    queryKey: ['scoring', 'runs'],
    queryFn: () => apiGet('/api/scoring/runs'),
    refetchInterval: 30000,
    retry: 1,
  });

  // Use actual health check for online/offline — NOT a guess from a single endpoint failure
  const healthQuery = useQuery({
    queryKey: ['health'],
    queryFn: () => apiGet('/api/version'),
    staleTime: 15_000,
    retry: 1,
  });
  const apiOnline = !!healthQuery.data?.version;

  const runs = runsQuery.data?.runs ?? [];
  const runsFailed = runsQuery.isError;

  // Sort runs
  const sortedRuns = useMemo(() => {
    const sorted = [...runs];
    if (sortBy === 'time') sorted.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    else if (sortBy === 'symbols') sorted.sort((a, b) => b.symbolsScored - a.symbolsScored);
    return sorted;
  }, [runs, sortBy]);

  // Filter
  const filtered = useMemo(() => {
    if (filter === 'all') return sortedRuns;
    if (filter === 'recent') return sortedRuns.slice(0, 10);
    return sortedRuns;
  }, [sortedRuns, filter]);

  const isLoading = runsQuery.isLoading;
  const isEmpty = !isLoading && filtered.length === 0;

  return (
    <div className="sal-page">
      <motion.header className="sal-header" initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}>
        <div>
          <h1>📊 Scoring Activity Logs</h1>
          <p className="sal-subtitle">
            {runs.length > 0
              ? `${runs.length} scoring runs recorded — click a row to expand detail`
              : 'No scoring runs yet. Trigger a scoring run to see logs here.'}
          </p>
          <p className="sal-subtitle" style={{ fontSize: '0.68rem', marginTop: '0.15rem', opacity: 0.7 }}>
            Per-symbol directive trace view — for aggregate summaries see <a href="/scoring/scoring-runs" style={{ color: 'var(--accent)' }}>Scoring Runs</a>
          </p>
        </div>
        <div className="sal-controls">
          <div className="sal-filters">
            <button className={filter === 'all' ? 'active' : ''} onClick={() => setFilter('all')}>All</button>
            <button className={filter === 'recent' ? 'active' : ''} onClick={() => setFilter('recent')}>Recent 10</button>
          </div>
          <select className="sal-sort" value={sortBy} onChange={(e) => setSortBy(e.target.value)}>
            <option value="time">Sort: Time</option>
            <option value="symbols">Sort: Symbols</option>
          </select>
        </div>
      </motion.header>

      {!apiOnline && <ApiOfflineBanner />}
      {apiOnline && runsFailed && (
        <div className="api-offline-banner" style={{ borderColor: '#f59e0b' }}>
          <div className="api-offline-banner-icon">⏳</div>
          <div className="api-offline-banner-body">
            <strong className="api-offline-banner-title">Scoring data is taking too long</strong>
            <p className="api-offline-banner-text">
              The /api/scoring/runs endpoint did not respond in time. The API is online but this query timed out.
              It will retry automatically.
            </p>
          </div>
        </div>
      )}
      {isLoading && <LoadingSkeleton variant="text" lines={6} />}

      {isEmpty && (
        <div className="sal-table-wrap">
          <p className="sal-subtitle" style={{ textAlign: 'center', padding: '2rem' }}>
            No scoring runs recorded yet. The scoring engine will populate this automatically.
          </p>
        </div>
      )}

      {!isEmpty && (
        <div className="sal-table-wrap">
          <table className="sal-table">
            <thead>
              <tr>
                <th>Time</th>
                <th>Protocol</th>
                <th>Strategy</th>
                <th>Symbols</th>
                <th>Top Scores</th>
              </tr>
            </thead>
            <AnimatePresence>
              {filtered.map((run) => {
                  const isExpanded = expandedRun === run.id;
                  const topScores = (run.scores || [])
                    .filter((s) => s.value > 0)
                    .sort((a, b) => b.value - a.value)
                    .slice(0, 5);
                  const maxScore = topScores.length > 0 ? topScores[0]?.value ?? 1 : 1;

                  return (
                    <motion.tbody key={run.id}>
                      <motion.tr
                        className={`sal-row ${isExpanded ? 'expanded' : ''}`}
                        onClick={() => setExpandedRun(isExpanded ? null : run.id)}
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        transition={{ duration: 0.15 }}
                      >
                        <td className="sal-time">{new Date(run.timestamp).toLocaleString()}</td>
                        <td>
                          <span className="sal-symbol">{run.protocolName || run.protocolId || '—'}</span>
                        </td>
                        <td>
                          <span className="sal-symbol">{run.strategyName || 'Unknown'}</span>
                        </td>
                        <td>{run.symbolsScored}</td>
                        <td>
                          <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap', alignItems: 'center' }}>
                            {topScores.map((s) => (
                              <span key={s.ticker} className="sal-pct-chip" style={{ fontSize: '0.65rem' }}>
                                {s.ticker} <strong>{s.value}</strong>
                              </span>
                            ))}
                            {topScores.length === 0 && <span className="sal-chevron">—</span>}
                          </div>
                        </td>
                      </motion.tr>

                      {isExpanded && (
                        <motion.tr
                          initial={{ opacity: 0, height: 0 }}
                          animate={{ opacity: 1, height: 'auto' }}
                          exit={{ opacity: 0, height: 0 }}
                        >
                          <td colSpan={5} style={{ padding: '0.5rem 1rem' }}>
                            <div className="sal-expand-grid">
                              {(run.scores || [])
                                .sort((a, b) => b.value - a.value)
                                .map((s) => (
                                  <div key={s.ticker}
                                    className={`sal-score-chip ${traceSymbol === s.ticker ? 'sal-score-active' : ''}`}
                                    onClick={() => setTraceSymbol(traceSymbol === s.ticker ? null : s.ticker)}
                                    title="Click for directive trace"
                                  >
                                    <span className="sal-symbol" style={{ fontSize: '0.72rem' }}>{s.ticker}</span>
                                    <span className={`sal-pct-chip ${getPctColor(s.value, maxScore)}`}>
                                      {s.value}
                                    </span>
                                  </div>
                                ))}
                            </div>
                            {traceSymbol && (
                              <div style={{ marginTop: '0.5rem' }}>
                                <DirectiveTrace symbol={traceSymbol} onClose={() => setTraceSymbol(null)} />
                              </div>
                            )}
                          </td>
                        </motion.tr>
                      )}
                    </motion.tbody>
                  );
                })}
            </AnimatePresence>
          </table>
        </div>
      )}
    </div>
  );
}
