import { useMemo } from 'react';
import { motion } from 'motion/react';
import { useQuery } from '@tanstack/react-query';
import { apiGet } from '../core/api/client';
import LoadingSkeleton from '../components/LoadingSkeleton';
import ApiOfflineBanner from '../components/ApiOfflineBanner';
import Notice from '../components/Notice';
import './exit-signals.css';

const URGENCY_COLORS = {
  CRITICAL: '#dc2626',
  HIGH: '#ef4444',
  MEDIUM: '#f59e0b',
  LOW: '#22c55e',
  NONE: '#6b7280',
};

const URGENCY_LABELS = {
  CRITICAL: 'Exit Now',
  HIGH: 'Consider Exit',
  MEDIUM: 'Monitor',
  LOW: 'Strong Hold',
  NONE: 'No Signal',
};

const TREND_ICONS = {
  collapsing: '📉📉',
  declining: '📉',
  stable: '➡️',
  rising: '📈',
  no_data: '❓',
};

export default function ExitSignalsPage() {
  const exitQuery = useQuery({
    queryKey: ['portfolio', 'exit-signals'],
    queryFn: () => apiGet('/api/portfolio/exit-signals'),
    refetchInterval: 30000,
  });

  const apiOnline = !exitQuery.isError;
  const signals = exitQuery.data ?? [];
  const isLoading = exitQuery.isLoading;
  const isEmpty = !isLoading && (!Array.isArray(signals) || signals.length === 0);

  const summary = useMemo(() => {
    if (!Array.isArray(signals)) return null;
    const critical = signals.filter((s) => s.urgency === 'CRITICAL').length;
    const high = signals.filter((s) => s.urgency === 'HIGH').length;
    const total = signals.length;
    return { critical, high, total };
  }, [signals]);

  return (
    <div className="es-page">
      <motion.header className="es-header" initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}>
        <div>
          <h1>🚪 Exit Signals</h1>
          <p className="es-subtitle">
            {summary
              ? `${summary.total} positions — ${summary.critical} critical, ${summary.high} high urgency. Multi-factor analysis: score trend + P&L + signal degradation.`
              : 'Portfolio position exit monitoring with trend analysis'}
          </p>
        </div>
        {summary && (summary.critical > 0 || summary.high > 0) && (
          <Notice level="critical">
            <strong>Positions need attention</strong> — {summary.critical + summary.high} position{summary.critical + summary.high > 1 ? 's' : ''} flagged ({summary.critical} critical, {summary.high} high urgency).
          </Notice>
        )}
      </motion.header>

      {!apiOnline && <ApiOfflineBanner />}
      {isLoading && <LoadingSkeleton variant="text" lines={6} />}

      {isEmpty && (
        <div className="es-empty">
          <p>No exit signals available.</p>
          <p className="es-hint">Import your Trading212 portfolio or add positions to see exit signals with trend analysis.</p>
        </div>
      )}

      {!isEmpty && Array.isArray(signals) && (
        (() => {
          // Group by urgency level
          const groups = { CRITICAL: [], HIGH: [], MEDIUM: [], LOW: [], NONE: [] };
          for (const s of signals) {
            const g = s.urgency || 'NONE';
            if (groups[g]) groups[g].push(s); else groups.NONE.push(s);
          }
          const groupOrder = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'NONE'];
          const groupLabels = { CRITICAL: '⚠️ Critical — Exit Now', HIGH: '▲ High — Consider Exit', MEDIUM: '◆ Medium — Monitor', LOW: '✅ Low — Strong Hold', NONE: '— No Signal' };

          return groupOrder.map((level) => {
            const items = groups[level];
            if (!items || items.length === 0) return null;
            return (
              <div key={level} className="es-group">
                <div className={`es-group-header es-group-header-${level.toLowerCase()}`}>
                  {groupLabels[level]}
                  <span style={{ fontSize:'0.78rem', opacity:0.7 }}>({items.length})</span>
                </div>
                <div className="es-grid">
                  {items.map((sig, i) => (
                    <motion.div
                      key={sig.symbol || sig.ticker || i}
                      className="es-card"
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: i * 0.04 }}
                    >
                      <div className="es-card-header">
                        <div className="es-symbol-row">
                          <span className="es-symbol">{sig.symbol || sig.ticker}</span>
                          {sig.pnlPct != null && (
                            <span className={`es-pnl ${sig.pnlPct >= 0 ? 'positive' : 'negative'}`}>
                              {sig.pnlPct >= 0 ? '+' : ''}{sig.pnlPct.toFixed(1)}%
                            </span>
                          )}
                        </div>
                        <span className="es-urgency-badge" style={{ background: (URGENCY_COLORS[sig.urgency] || URGENCY_COLORS.NONE) + '20', color: URGENCY_COLORS[sig.urgency] || URGENCY_COLORS.NONE }}>
                          {URGENCY_LABELS[sig.urgency] || sig.urgency}
                        </span>
                      </div>

                      <div className="es-card-body">
                        <div className="es-metrics-row">
                          <div className="es-metric">
                            <span className="es-metric-label">Score</span>
                            <span className="es-metric-value">{sig.currentScore ?? '—'}</span>
                          </div>
                          <div className="es-metric">
                            <span className="es-metric-label">Trend</span>
                            <span className="es-metric-value">
                              {TREND_ICONS[sig.scoreTrend] || '—'} {sig.scoreTrend}
                              {sig.scoreVelocity != null && sig.scoreVelocity !== 0 && (
                                <span className="es-velocity">
                                  {' '}({sig.scoreVelocity > 0 ? '+' : ''}{sig.scoreVelocity})
                                </span>
                              )}
                            </span>
                          </div>
                          <div className="es-metric">
                            <span className="es-metric-label">Urgency</span>
                            <span className="es-metric-value">{sig.urgencyScore}/100</span>
                          </div>
                        </div>

                        {sig.positionValue != null && sig.positionValue > 0 && (
                          <div className="es-metrics-row">
                            <div className="es-metric">
                              <span className="es-metric-label">Position</span>
                              <span className="es-metric-value">${sig.positionValue.toFixed(0)}</span>
                            </div>
                            <div className="es-metric">
                              <span className="es-metric-label">Signal</span>
                              <span className={`es-metric-value es-signal-${sig.signal}`}>{sig.signal}</span>
                            </div>
                          </div>
                        )}

                        {/* ── Source + Broker info ── */}
                        <div className="es-source-row">
                          <span className={`es-source-badge ${sig.source ? 'es-source-app' : 'es-source-missing'}`}>
                            📦 {sig.source || 'Unknown Source'}
                          </span>
                          <span className={`es-source-badge ${sig.broker ? 'es-source-broker' : 'es-source-missing'}`}>
                            🏦 {sig.broker || 'Unknown Broker'}
                          </span>
                        </div>

                        {sig.reasons && sig.reasons.length > 0 && (
                          <div className="es-reasons">
                            {sig.reasons.map((reason, ri) => (
                              <div key={ri} className="es-reason">
                                {reason.startsWith('⚠️') ? reason : `• ${reason}`}
                              </div>
                            ))}
                          </div>
                        )}

                        <div className="es-actions-row">
                          {sig.urgency === 'CRITICAL' || sig.urgency === 'HIGH' ? (
                            <button type="button" className="es-action">
                              {sig.urgency === 'CRITICAL' ? 'Exit Now' : 'Review Exit'}
                            </button>
                          ) : (
                            <button type="button" className="es-action es-action-hold">Hold</button>
                          )}
                        </div>

                        {sig.lastUpdated && (
                          <div className="es-updated">
                            Updated: {new Date(sig.lastUpdated).toLocaleString()}
                          </div>
                        )}
                      </div>
                    </motion.div>
                  ))}
                </div>
              </div>
            );
          });
        })()
      )}
    </div>
  );
}