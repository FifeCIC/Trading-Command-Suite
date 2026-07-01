import { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { useQuery } from '@tanstack/react-query';
import { apiGet } from '../core/api/client';
import LoadingSkeleton from '../components/LoadingSkeleton';
import ApiOfflineBanner from '../components/ApiOfflineBanner';
import './scoring-activity-logs.css';

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

  const runsQuery = useQuery({
    queryKey: ['scoring', 'runs'],
    queryFn: () => apiGet('/api/scoring/runs'),
    refetchInterval: 30000,
  });

  const apiOnline = !runsQuery.isError;
  const runs = runsQuery.data?.runs ?? [];

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
                <th>Strategy</th>
                <th>Symbols</th>
                <th>Top Scores</th>
              </tr>
            </thead>
            <tbody>
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
                          <td colSpan={4} style={{ padding: '0.5rem 1rem' }}>
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '0.3rem' }}>
                              {(run.scores || [])
                                .sort((a, b) => b.value - a.value)
                                .map((s) => (
                                  <div key={s.ticker} style={{
                                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                                    padding: '0.25rem 0.5rem', borderRadius: 4,
                                    background: s.value > 0 ? 'rgba(14,165,166,0.04)' : 'transparent',
                                    fontSize: '0.72rem',
                                  }}>
                                    <span className="sal-symbol" style={{ fontSize: '0.72rem' }}>{s.ticker}</span>
                                    <span className={`sal-pct-chip ${getPctColor(s.value, maxScore)}`}>
                                      {s.value}
                                    </span>
                                  </div>
                                ))}
                            </div>
                          </td>
                        </motion.tr>
                      )}
                    </motion.tbody>
                  );
                })}
              </AnimatePresence>
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
