import { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import './scoring-activity-logs.css';

const MOCK_RUNS = Array.from({ length: 12 }, (_, i) => {
  const directiveScores = [
    { name: 'Trend Alignment', score: Math.round((50 + Math.random() * 50) * 10) / 10, weight: 0.25 },
    { name: 'Momentum', score: Math.round((40 + Math.random() * 60) * 10) / 10, weight: 0.2 },
    { name: 'Volatility Check', score: Math.round((30 + Math.random() * 70) * 10) / 10, weight: 0.15 },
    { name: 'Volume Confirmation', score: Math.round((45 + Math.random() * 55) * 10) / 10, weight: 0.15 },
    { name: 'Support/Resistance', score: Math.round((35 + Math.random() * 65) * 10) / 10, weight: 0.15 },
    { name: 'Sentiment Overlay', score: Math.round((20 + Math.random() * 80) * 10) / 10, weight: 0.1 },
  ];
  const maxPossible = directiveScores.reduce((sum, d) => sum + d.weight * 100, 0);
  const totalScore = directiveScores.reduce((sum, d) => sum + d.weight * d.score, 0);
  const pctOfMax = Math.round((totalScore / maxPossible) * 100);

  return {
    id: `run-${i + 1}`,
    symbol: ['NVDA', 'TSLA', 'AAPL', 'META', 'AMD', 'MSFT'][i % 6],
    timestamp: new Date(Date.now() - i * 3600000 * 3).toISOString(),
    totalScore: Math.round(totalScore * 10) / 10,
    pctOfMax,
    maxPossible: Math.round(maxPossible * 10) / 10,
    directives: directiveScores,
    direction: Math.random() > 0.5 ? 'LONG' : 'SHORT',
  };
});

function generateSparkline() {
  return Array.from({ length: 20 }, () => Math.round((30 + Math.random() * 70) * 10) / 10);
}

export default function ScoringActivityLogsPage() {
  const [expanded, setExpanded] = useState(null);
  const [filter, setFilter] = useState('all');
  const [sort, setSort] = useState('time');

  const filtered = useMemo(() => {
    let runs = [...MOCK_RUNS];
    if (filter !== 'all') {
      runs = runs.filter(r => r.direction === filter);
    }
    if (sort === 'score') runs.sort((a, b) => b.totalScore - a.totalScore);
    else runs.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    return runs;
  }, [filter, sort]);

  return (
    <div className="sal-page">
      <div className="sal-header">
        <div>
          <h1>Scoring Activity Logs</h1>
          <p className="sal-subtitle">Directive-level trace for all scoring runs</p>
        </div>
        <div className="sal-controls">
          <div className="sal-filters">
            <button className={filter === 'all' ? 'active' : ''} onClick={() => setFilter('all')}>All</button>
            <button className={filter === 'LONG' ? 'active' : ''} onClick={() => setFilter('LONG')}>Long</button>
            <button className={filter === 'SHORT' ? 'active' : ''} onClick={() => setFilter('SHORT')}>Short</button>
          </div>
          <select className="sal-sort" value={sort} onChange={e => setSort(e.target.value)}>
            <option value="time">Most Recent</option>
            <option value="score">Highest Score</option>
          </select>
        </div>
      </div>

      <div className="sal-demo-banner">
        ⚠ Demo data — not connected to live scoring pipeline yet
      </div>

      <div className="sal-table-wrap">
        <table className="sal-table">
          <thead>
            <tr>
              <th>Symbol</th>
              <th>Time</th>
              <th>Dir</th>
              <th>Score</th>
              <th>% of Max</th>
              <th>Score Trend</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            <AnimatePresence>
              {filtered.map(run => (
                <motion.tr
                  key={run.id}
                  className={`sal-row ${expanded === run.id ? 'expanded' : ''}`}
                  onClick={() => setExpanded(expanded === run.id ? null : run.id)}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  transition={{ duration: 0.2 }}
                >
                  <td className="sal-symbol">{run.symbol}</td>
                  <td className="sal-time">{new Date(run.timestamp).toLocaleString()}</td>
                  <td>
                    <span className={`sal-dir ${run.direction === 'LONG' ? 'long' : 'short'}`}>
                      {run.direction}
                    </span>
                  </td>
                  <td className="sal-total">{run.totalScore}<small className="sal-max-hint">/{run.maxPossible}</small></td>
                  <td>
                    <span className={`sal-pct-chip ${run.pctOfMax >= 70 ? 'sal-pct-high' : run.pctOfMax >= 50 ? 'sal-pct-mid' : 'sal-pct-low'}`}>
                      {run.pctOfMax}%
                    </span>
                  </td>
                  <td className="sal-spark-cell">
                    <Sparkline points={generateSparkline()} />
                  </td>
                  <td className="sal-chevron">{expanded === run.id ? '▴' : '▾'}</td>
                </motion.tr>
              ))}
            </AnimatePresence>
          </tbody>
        </table>
      </div>

      <AnimatePresence>
        {expanded && (() => {
          const run = MOCK_RUNS.find(r => r.id === expanded);
          if (!run) return null;
          return (
            <motion.div
              key="detail"
              className="sal-detail"
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
            >
              <div className="sal-detail-header">
                <h2>{run.symbol} — Score Breakdown</h2>
                <span className="sal-detail-score">Total: {run.totalScore}</span>
              </div>
              <div className="sal-detail-grid">
                {run.directives.map((d, i) => (
                  <div key={d.name} className="sal-dir-card">
                    <div className="sal-dir-header">
                      <span className="sal-dir-name">{d.name}</span>
                      <span className="sal-dir-weight">{Math.round(d.weight * 100)}%</span>
                    </div>
                    <div className="sal-dir-bar-wrap">
                      <div
                        className={`sal-dir-bar ${d.score >= 70 ? 'high' : d.score >= 40 ? 'mid' : 'low'}`}
                        style={{ width: `${d.score}%` }}
                      />
                    </div>
                    <div className="sal-dir-footer">
                      <span className="sal-dir-score">{d.score}</span>
                      <span className="sal-dir-contrib">× {d.weight} = {(d.score * d.weight).toFixed(1)}</span>
                    </div>
                  </div>
                ))}
              </div>
              <div className="sal-detail-formula">
                <span className="sal-formula-label">Formula: </span>
                {run.directives.map((d, i) => (
                  <span key={d.name}>
                    <span className="sal-formula-term">{d.name}: {d.score}×{d.weight}</span>
                    {i < run.directives.length - 1 && ' + '}
                  </span>
                ))}
                <span className="sal-formula-eq"> = {run.totalScore}</span>
              </div>
            </motion.div>
          );
        })()}
      </AnimatePresence>
    </div>
  );
}

function Sparkline({ points }) {
  const w = 80, h = 18, pad = 1;
  const max = Math.max(...points), min = Math.min(...points);
  const range = max - min || 1;
  const d = points.map((p, i) => {
    const x = pad + (i / (points.length - 1)) * (w - pad * 2);
    const y = h - pad - ((p - min) / range) * (h - pad * 2);
    return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="sal-spark">
      <path d={d} fill="none" stroke="var(--accent, #0ea5a6)" strokeWidth="1.2" />
    </svg>
  );
}
