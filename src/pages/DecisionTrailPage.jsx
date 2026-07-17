/**
 * Decision Trail Browser
 * ======================
 * Visualize the full chain: Scoring → Comparison → Decision → Execution → Monitoring.
 * Filters by symbol, strategy, date range. Expandable timeline view with completeness checks.
 *
 * Endpoints (pending #350 Decision-Trail storage):
 *   GET /api/trails?symbol=&strategy=&from=&to=&limit=
 *   GET /api/trails/:tradeTicket
 *   GET /api/trails/incomplete
 */
import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { motion } from 'motion/react';
import { apiGet } from '../core/api/client';
import LoadingSkeleton from '../components/LoadingSkeleton';
import Notice from '../components/Notice';
import './decision-trail.css';

const TRAIL_STAGES = [
  { id: 'scoring', label: 'Scoring', icon: '🎯', desc: 'Directive scores computed' },
  { id: 'comparison', label: 'Comparison', icon: '⚖️', desc: 'LONG vs SHORT composite' },
  { id: 'decision', label: 'Decision', icon: '🧠', desc: 'Trade signal generated' },
  { id: 'execution', label: 'Execution', icon: '⚡', desc: 'Order placed on broker' },
  { id: 'sl_tracking', label: 'SL Tracking', icon: '🛡️', desc: 'Stop-loss adjustments' },
  { id: 'close', label: 'Close', icon: '🏁', desc: 'Position closed, P&L recorded' },
];

export default function DecisionTrailPage() {
  const [symbolFilter, setSymbolFilter] = useState('');
  const [expandedTrail, setExpandedTrail] = useState(null);

  // ── Fetch trails ──
  const trailsQuery = useQuery({
    queryKey: ['trails', symbolFilter],
    queryFn: () => {
      let url = '/api/trails?limit=20';
      if (symbolFilter) url += `&symbol=${symbolFilter}`;
      return apiGet(url).catch(() => ({ trails: [] }));
    },
    refetchInterval: 30_000,
  });
  const trails = trailsQuery.data?.trails || [];

  // ── Incomplete trails ──
  const incompleteQuery = useQuery({
    queryKey: ['trails-incomplete'],
    queryFn: () => apiGet('/api/trails/incomplete').catch(() => ({ trails: [] })),
    refetchInterval: 60_000,
  });
  const incomplete = incompleteQuery.data?.trails || [];

  // ── Compute completeness stats ──
  const stats = useMemo(() => {
    if (trails.length === 0) return { total: 0, complete: 0, missingStages: {} };
    let complete = 0;
    const missing = {};
    TRAIL_STAGES.forEach(s => { missing[s.id] = 0; });
    trails.forEach(t => {
      const present = t.stages || [];
      const allPresent = TRAIL_STAGES.every(s => present.includes(s.id));
      if (allPresent) complete++;
      TRAIL_STAGES.forEach(s => {
        if (!present.includes(s.id)) missing[s.id]++;
      });
    });
    return { total: trails.length, complete, missingStages: missing };
  }, [trails]);

  const isLoading = trailsQuery.isLoading;

  if (isLoading) {
    return (
      <div className="dt-page">
        <header className="dt-header"><h1>Decision Trail Browser</h1></header>
        <LoadingSkeleton variant="card" count={3} />
      </div>
    );
  }

  return (
    <div className="dt-page">
      <header className="dt-header">
        <div>
          <h1>🔗 Decision Trail Browser</h1>
          <p className="dt-subtitle">Trace the full pipeline: Scoring → Comparison → Decision → Execution → Monitoring</p>
        </div>
      </header>

      {!trailsQuery.data && (
        <Notice level="info">Decision Trail storage not yet deployed — showing empty state. Trails will appear when #350 (Decision-Trail DB) is live.</Notice>
      )}

      {/* Completeness overview */}
      {stats.total > 0 && (
        <div className="dt-completeness-bar">
          <span className="dt-completeness-label">Pipeline Completeness</span>
          <div className="dt-completeness-track">
            {TRAIL_STAGES.map(s => {
              const missing = stats.missingStages[s.id] || 0;
              const pct = stats.total > 0 ? ((stats.total - missing) / stats.total) * 100 : 100;
              return (
                <div
                  key={s.id}
                  className="dt-completeness-node"
                  style={{ background: pct >= 90 ? '#22c55e' : pct >= 50 ? '#f59e0b' : '#ef4444' }}
                  title={`${s.label}: ${stats.total - missing}/${stats.total} (${pct.toFixed(0)}%)`}
                >
                  <span className="dt-completeness-icon">{s.icon}</span>
                  <span className="dt-completeness-pct">{pct.toFixed(0)}%</span>
                </div>
              );
            })}
          </div>
          <span className="dt-completeness-summary">
            {stats.complete}/{stats.total} trails complete
          </span>
        </div>
      )}

      {/* Symbol filter */}
      <div className="dt-filters">
        <div className="dt-filter-group">
          <label>Symbol</label>
          <input
            type="text"
            value={symbolFilter}
            onChange={e => setSymbolFilter(e.target.value)}
            placeholder="Filter by symbol…"
            className="dt-input"
          />
        </div>
        <button className="dt-refresh-btn" onClick={() => trailsQuery.refetch()}>⟳ Refresh</button>
      </div>

      {/* Incomplete trails warning */}
      {incomplete.length > 0 && (
        <Notice level="warning">{incomplete.length} trail{incomplete.length !== 1 ? 's' : ''} with missing pipeline links — review gaps below.</Notice>
      )}

      {/* Trail list */}
      <div className="dt-list">
        {trails.length === 0 ? (
          <div className="dt-empty">
            <p>No decision trails found.</p>
            <p className="dt-empty-hint">Trails will appear when the Decision-Trail storage system records scoring→execution chains.</p>
          </div>
        ) : (
          trails.map((trail, i) => {
            const stages = trail.stages || [];
            const isExpanded = expandedTrail === (trail.tradeTicket || i);
            const isComplete = TRAIL_STAGES.every(s => stages.includes(s.id));
            return (
              <motion.div
                key={trail.tradeTicket || i}
                className={`dt-trail-card ${isExpanded ? 'expanded' : ''} ${isComplete ? 'complete' : 'incomplete'}`}
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.02 }}
              >
                <div className="dt-trail-summary" onClick={() => setExpandedTrail(isExpanded ? null : (trail.tradeTicket || i))}>
                  <div className="dt-trail-meta">
                    <span className="dt-trail-symbol">{trail.symbol || '—'}</span>
                    <span className={`dt-trail-direction ${trail.direction === 'BUY' ? 'buy' : trail.direction === 'SELL' ? 'sell' : ''}`}>
                      {trail.direction || '—'}
                    </span>
                    <span className="dt-trail-pnl" style={{ color: (trail.pnl || 0) >= 0 ? '#22c55e' : '#ef4444' }}>
                      {trail.pnl != null ? `${trail.pnl >= 0 ? '+' : ''}${trail.pnl.toFixed(2)}` : '—'}
                    </span>
                  </div>

                  {/* Mini stage indicators */}
                  <div className="dt-mini-stages">
                    {TRAIL_STAGES.map(s => (
                      <div
                        key={s.id}
                        className={`dt-mini-stage ${stages.includes(s.id) ? 'present' : 'missing'}`}
                        title={`${s.label}: ${stages.includes(s.id) ? 'Present' : 'Missing'}`}
                      >
                        {stages.includes(s.id) ? s.icon : '·'}
                      </div>
                    ))}
                  </div>

                  <div className="dt-trail-info">
                    <span>{trail.strategy || '—'}</span>
                    <span className="dt-trail-time">{trail.timestamp ? new Date(trail.timestamp).toLocaleString() : '—'}</span>
                  </div>

                  <span className="dt-trail-chevron">{isExpanded ? '▾' : '▸'}</span>
                </div>

                {/* Expanded timeline */}
                {isExpanded && (
                  <div className="dt-timeline">
                    <div className="dt-timeline-track">
                      {TRAIL_STAGES.map((s, idx) => {
                        const present = stages.includes(s.id);
                        return (
                          <div key={s.id} className="dt-timeline-step">
                            <div className={`dt-timeline-dot ${present ? 'present' : 'missing'}`}>
                              {present ? '✓' : '·'}
                            </div>
                            {idx < TRAIL_STAGES.length - 1 && (
                              <div className={`dt-timeline-line ${present ? 'present' : 'missing'}`} />
                            )}
                            <div className="dt-timeline-label">{s.icon}</div>
                            <div className="dt-timeline-text">{s.label}</div>
                            <div className="dt-timeline-desc">{s.desc}</div>
                          </div>
                        );
                      })}
                    </div>

                    {/* Trail data */}
                    {trail.scoreLong != null && (
                      <div className="dt-trail-data">
                        <div className="dt-data-row">
                          <span>LONG Score</span>
                          <strong>{trail.scoreLong}</strong>
                        </div>
                        <div className="dt-data-row">
                          <span>SHORT Score</span>
                          <strong>{trail.scoreShort}</strong>
                        </div>
                        {trail.reason && (
                          <div className="dt-data-row">
                            <span>Reason</span>
                            <strong className="dt-reason">{trail.reason}</strong>
                          </div>
                        )}
                      </div>
                    )}

                    {!isComplete && (
                      <div className="dt-incomplete-banner">
                        ⚠️ Incomplete trail — {
                          TRAIL_STAGES.filter(s => !stages.includes(s.id)).map(s => s.label).join(', ')
                        } missing
                      </div>
                    )}
                  </div>
                )}
              </motion.div>
            );
          })
        )}
      </div>

      <p className="dt-footer">
        Auto-refresh every 30s · {trails.length} trail{trails.length !== 1 ? 's' : ''} shown
        {' · '}
        <button type="button" className="dt-refresh-link" onClick={() => trailsQuery.refetch()}>
          Refresh now
        </button>
      </p>
    </div>
  );
}
