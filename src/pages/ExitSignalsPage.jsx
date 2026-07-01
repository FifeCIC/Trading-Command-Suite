import { useMemo } from 'react';
import { motion } from 'motion/react';
import { useQuery } from '@tanstack/react-query';
import { apiGet } from '../core/api/client';
import LoadingSkeleton from '../components/LoadingSkeleton';
import ApiOfflineBanner from '../components/ApiOfflineBanner';
import './exit-signals.css';

function getExitUrgency(score, history) {
  if (!score || score === 0) return { level: 'NONE', label: 'No Data', color: '#6b7280' };
  if (score >= 800) return { level: 'LOW', label: 'Strong Hold', color: '#22c55e' };
  if (score >= 500) return { level: 'MEDIUM', label: 'Monitor', color: '#f59e0b' };
  if (score >= 200) return { level: 'HIGH', label: 'Consider Exit', color: '#ef4444' };
  return { level: 'CRITICAL', label: 'Exit Now', color: '#dc2626' };
}

export default function ExitSignalsPage() {
  const scoresQuery = useQuery({
    queryKey: ['portfolio', 'scores'],
    queryFn: () => apiGet('/api/portfolio/scores'),
    refetchInterval: 30000,
  });

  const statusQuery = useQuery({
    queryKey: ['automation', 'status'],
    queryFn: () => apiGet('/api/automation/status'),
    refetchInterval: 15000,
  });

  const apiOnline = !scoresQuery.isError;
  const scores = scoresQuery.data?.scores ?? [];
  const decisions = statusQuery.data?.recentDecisions ?? [];

  // Merge decisions into scores for urgency calculation
  const positions = useMemo(() => {
    const scoreMap = new Map();
    for (const d of decisions) {
      if (!scoreMap.has(d.symbol)) scoreMap.set(d.symbol, []);
      scoreMap.get(d.symbol).push(d.composite);
    }
    return scores.map((s) => {
      const history = scoreMap.get(s.symbol || s.ticker) || [];
      const urgency = getExitUrgency(s.score, history);
      return { ...s, urgency, history };
    });
  }, [scores, decisions]);

  const sorted = useMemo(() => {
    const order = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3, NONE: 4 };
    return [...positions].sort((a, b) => (order[a.urgency.level] || 5) - (order[b.urgency.level] || 5));
  }, [positions]);

  const isLoading = scoresQuery.isLoading;
  const isEmpty = !isLoading && sorted.length === 0;

  return (
    <div className="es-page">
      <motion.header className="es-header" initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}>
        <div>
          <h1>🚪 Exit Signals</h1>
          <p className="es-subtitle">
            {sorted.length > 0
              ? `${sorted.length} positions — exit urgency based on composite score thresholds`
              : 'Portfolio position exit monitoring — requires scored portfolio data'}
          </p>
        </div>
      </motion.header>

      {!apiOnline && <ApiOfflineBanner />}
      {isLoading && <LoadingSkeleton variant="text" lines={6} />}

      {isEmpty && (
        <div className="es-empty">
          <p>No portfolio scores available.</p>
          <p className="es-hint">Import your Trading212 portfolio or add positions to see exit signals.</p>
        </div>
      )}

      {!isEmpty && (
        <div className="es-grid">
          {sorted.map((pos, i) => (
            <motion.div
              key={pos.symbol || pos.ticker || i}
              className="es-card"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.04 }}
              style={{ borderLeft: `4px solid ${pos.urgency.color}` }}
            >
              <div className="es-card-header">
                <span className="es-symbol">{pos.symbol || pos.ticker}</span>
                <span className="es-urgency-badge" style={{ background: pos.urgency.color + '20', color: pos.urgency.color }}>
                  {pos.urgency.label}
                </span>
              </div>
              <div className="es-card-body">
                <div className="es-metric">
                  <span className="es-metric-label">Entry Score</span>
                  <span className="es-metric-value">{pos.score ?? '—'}</span>
                </div>
                <div className="es-metric">
                  <span className="es-metric-label">Signal</span>
                  <span className="es-metric-value">{pos.signal || 'neutral'}</span>
                </div>
                <div className="es-metric">
                  <span className="es-metric-label">Strength</span>
                  <span className="es-metric-value">{pos.strength || '—'}</span>
                </div>
              </div>
              {pos.urgency.level === 'HIGH' || pos.urgency.level === 'CRITICAL' ? (
                <div className="es-action">
                  ⚠ Review position — score below exit threshold
                </div>
              ) : pos.urgency.level === 'LOW' ? (
                <div className="es-action es-action-hold">
                  ✅ Position healthy — score indicates strong hold
                </div>
              ) : null}
            </motion.div>
          ))}
        </div>
      )}

      <motion.div className="es-legend" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.3 }}>
        <span><span className="es-dot" style={{ background: '#22c55e' }} /> LOW (≥800) — Strong Hold</span>
        <span><span className="es-dot" style={{ background: '#f59e0b' }} /> MED (500-799) — Monitor</span>
        <span><span className="es-dot" style={{ background: '#ef4444' }} /> HIGH (200-499) — Consider Exit</span>
        <span><span className="es-dot" style={{ background: '#dc2626' }} /> CRITICAL (&lt;200) — Exit Now</span>
      </motion.div>
    </div>
  );
}