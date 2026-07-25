/**
 * Decision Trail Browser
 * ======================
 * Visualize the full chain: Scoring → Comparison → Decision → Execution → Monitoring.
 * Reads from the automation loop's decision_log — the same data that powers
 * /api/automation/status recentDecisions. No separate storage system.
 *
 * Supports ?symbol=AAPL for deep-linking from other views.
 */

import { useState, useMemo, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
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
  const [searchParams, setSearchParams] = useSearchParams();
  const initialSymbol = searchParams.get('symbol') || '';
  const [symbolFilter, setSymbolFilter] = useState(initialSymbol);
  const [expandedTrail, setExpandedTrail] = useState(null);

  // Sync symbol filter to URL param
  useEffect(() => {
    if (symbolFilter) {
      setSearchParams({ symbol: symbolFilter }, { replace: true });
    } else {
      setSearchParams({}, { replace: true });
    }
  }, [symbolFilter, setSearchParams]);

  // ── Fetch trails from automation loop recent decisions ──
  const trailsQuery = useQuery({
    queryKey: ['trails', symbolFilter],
    queryFn: async () => {
      const data = await apiGet('/api/automation/status').catch(() => ({}));
      let decisions = data.recentDecisions || [];
      if (symbolFilter) {
        decisions = decisions.filter(d =>
          d.symbol?.toUpperCase().includes(symbolFilter.toUpperCase())
        );
      }
      return { trails: decisions.slice(0, 20) };
    },
    refetchInterval: 30_000,
    keepPreviousData: true,
  });
  const trails = trailsQuery.data?.trails || [];

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

  const isLoading = trailsQuery.isLoading && !trailsQuery.data;

  return (
    <div className="dt-page">
      <header className="dt-header">
        <div>
          <h1>🔗 Decision Trail Browser</h1>
          <p className="dt-subtitle">Trace the full pipeline: Scoring → Comparison → Decision → Execution → Monitoring. Data from automation loop decision_log — the same decisions shown in /api/automation/status.</p>
        </div>
      </header>

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

      {/* Symbol filter — stays mounted during loading */}
      <div className="dt-filters">
        <div className="dt-filter-group">
          <label>Symbol</label>
          <input
            type="text"
            value={symbolFilter}
            onChange={e => setSymbolFilter(e.target.value.toUpperCase())}
            placeholder="Type a symbol to filter…"
            className="dt-input"
            autoFocus
          />
        </div>
        <button className="dt-refresh-btn" onClick={() => trailsQuery.refetch()}>⟳ Refresh</button>
      </div>

      {/* Trail list */}
      <div className="dt-list">
        {isLoading ? (
          <LoadingSkeleton variant="card" count={3} />
        ) : trails.length === 0 ? (
          <div className="dt-empty">
            <p>No decision trails found{initialSymbol ? ` for ${initialSymbol}` : ''}.</p>
            <p className="dt-empty-hint">Trails appear when the automation loop scores symbols — each tick decision is recorded to decision_log and displayed here as a pipeline trail.</p>
          </div>
        ) : (
          trails.map((trail, i) => {
            const isExpanded = expandedTrail === i;
            const decisionColor = trail.decision === 'EXECUTED' ? '#22c55e' : trail.decision === 'SCORED' ? '#3b82f6' : trail.decision === 'FAILED' ? '#ef4444' : '#f59e0b';
            return (
              <motion.div
                key={trail.id || `${trail.ticket || trail.timestamp}-${i}`}
                className={`dt-trail-card ${isExpanded ? 'expanded' : ''}`}
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.02 }}
                style={{ borderLeftColor: decisionColor }}
              >
                <div className="dt-trail-summary" onClick={() => setExpandedTrail(isExpanded ? null : i)}>
                  <div className="dt-trail-meta">
                    <span className="dt-trail-symbol">{trail.symbol || '—'}</span>
                    <span className="dt-trail-decision" style={{ background: decisionColor + '22', color: decisionColor }}>
                      {trail.decision || '—'}
                    </span>
                    <span className="dt-trail-composite" style={{ color: (trail.composite || 0) >= 1500 ? '#22c55e' : (trail.composite || 0) >= 500 ? '#f59e0b' : 'var(--ink-soft)' }}>
                      {(trail.composite || 0).toFixed(0)}
                    </span>
                    {trail.ticket && <span className="dt-trail-ticket">#{trail.ticket}</span>}
                  </div>

                  <div className="dt-trail-info">
                    <span className="dt-trail-reason">{trail.reason || trail.signal || '—'}</span>
                    <span className="dt-trail-time">{trail.timestamp ? new Date(trail.timestamp).toLocaleString() : '—'}</span>
                  </div>

                  <span className="dt-trail-chevron">{isExpanded ? '▾' : '▸'}</span>
                </div>

                {/* Expanded detail */}
                {isExpanded && (
                  <div className="dt-timeline">
                    <div className="dt-trail-data">
                      <div className="dt-data-row">
                        <span>Decision</span><strong>{trail.decision}</strong>
                      </div>
                      <div className="dt-data-row">
                        <span>Composite</span><strong>{(trail.composite || 0).toFixed(0)}</strong>
                      </div>
                      {trail.signal && (
                        <div className="dt-data-row"><span>Signal</span><strong>{trail.signal}</strong></div>
                      )}
                      {trail.reason && (
                        <div className="dt-data-row"><span>Reason</span><strong className="dt-reason">{trail.reason}</strong></div>
                      )}
                      {trail.ticket && (
                        <div className="dt-data-row"><span>Ticket</span><strong>#{trail.ticket}</strong></div>
                      )}
                      {trail.price && (
                        <div className="dt-data-row"><span>Price</span><strong>{trail.price}</strong></div>
                      )}
                      {trail.quantity && (
                        <div className="dt-data-row"><span>Qty</span><strong>{trail.quantity}</strong></div>
                      )}
                      {trail.strategyId && (
                        <div className="dt-data-row"><span>Strategy</span><strong>{trail.strategyId.slice(0, 12)}…</strong></div>
                      )}
                      {trail.brokerId && (
                        <div className="dt-data-row"><span>Broker</span><strong>{trail.brokerId}</strong></div>
                      )}
                    </div>
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
