/**
 * Protocol Trail Browser
 * ======================
 * Copy of DecisionTrailPage adapted for the Protocols area (#580).
 * Shows protocol-scored decisions from the scoring pipeline.
 * Where DecisionTrail shows "Strategy", this shows "Protocol".
 *
 * Reads from /api/scoring/runs for protocol-level decision history.
 * Supports ?protocol=btc-speed-v1 for deep-linking.
 */

import { useState, useMemo, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { motion } from 'motion/react';
import { apiGet } from '../core/api/client';
import LoadingSkeleton from '../components/LoadingSkeleton';
import './decision-trail.css';
import PageInfoPopover from '../components/PageInfoPopover';

const TRAIL_STAGES = [
  { id: 'scoring', label: 'Scoring', icon: '🎯', desc: 'Directive scores computed' },
  { id: 'comparison', label: 'Comparison', icon: '⚖️', desc: 'LONG vs SHORT composite' },
  { id: 'decision', label: 'Decision', icon: '🧠', desc: 'Trade signal generated' },
  { id: 'execution', label: 'Execution', icon: '⚡', desc: 'Order placed on broker' },
  { id: 'sl_tracking', label: 'SL Tracking', icon: '🛡️', desc: 'Stop-loss adjustments' },
  { id: 'close', label: 'Close', icon: '🏁', desc: 'Position closed, P&L recorded' },
];

export default function ProtocolTrailPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const initialProtocol = searchParams.get('protocol') || '';
  const [protocolFilter, setProtocolFilter] = useState(initialProtocol);
  const [expandedTrail, setExpandedTrail] = useState(null);

  // Sync protocol filter to URL param
  useEffect(() => {
    if (protocolFilter) {
      setSearchParams({ protocol: protocolFilter }, { replace: true });
    } else {
      setSearchParams({}, { replace: true });
    }
  }, [protocolFilter, setSearchParams]);

  // ── Fetch protocol trails from scoring runs ──
  const trailsQuery = useQuery({
    queryKey: ['protocol-trails', protocolFilter],
    queryFn: async () => {
      // Try scoring runs first (most recent protocol-level decisions)
      const runsData = await apiGet('/api/scoring/runs?limit=50').catch(() => ({}));
      let decisions = (runsData.runs || []).map(r => ({
        id: r.id,
        symbol: r.symbolsScored ? `${r.symbolsScored} symbols` : '—',
        decision: 'SCORED',
        composite: r.avgScore || 0,
        reason: r.strategyName || r.protocolName || r.protocolId || '—',
        protocolId: r.protocolId || r.protocolName || '—',
        timestamp: r.timestamp,
        stages: [],
      }));
      if (protocolFilter) {
        decisions = decisions.filter(d =>
          (d.protocolId || '').toLowerCase().includes(protocolFilter.toLowerCase())
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
    if (trails.length === 0) return { total: 0, complete: 0, missingStages: {}, anyData: false };
    let complete = 0;
    const missing = {};
    let anyData = false;
    TRAIL_STAGES.forEach(s => { missing[s.id] = 0; });
    trails.forEach(t => {
      const present = t.stages || [];
      const allPresent = TRAIL_STAGES.every(s => present.includes(s.id));
      if (allPresent) complete++;
      TRAIL_STAGES.forEach(s => {
        if (!present.includes(s.id)) missing[s.id]++;
        else anyData = true;
      });
    });
    return { total: trails.length, complete, missingStages: missing, anyData };
  }, [trails]);

  const isLoading = trailsQuery.isLoading && !trailsQuery.data;

  return (
    <div className="dt-page">
      <header className="dt-header">
        <div>
          <h1>Protocol Trail
          <PageInfoPopover>
            Trace protocol-level scoring decisions: which protocols ran, what they scored, and what signals were generated. Data from scoring runs — each run represents a protocol scoring pass over its symbols.
          </PageInfoPopover>
          </h1>
        </div>
      </header>

      {/* Completeness overview — only show when stage data exists */}
      {stats.total > 0 && stats.anyData && (
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

      {/* Protocol filter */}
      <div className="dt-filters">
        <div className="dt-filter-group">
          <label>Protocol</label>
          <input
            type="text"
            value={protocolFilter}
            onChange={e => setProtocolFilter(e.target.value.toLowerCase())}
            placeholder="Type a protocol to filter…"
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
            <p>No protocol trails found{initialProtocol ? ` for ${initialProtocol}` : ''}.</p>
            <p className="dt-empty-hint">Trails appear when protocols score symbols — each scoring run is recorded and displayed here as a pipeline trail.</p>
          </div>
        ) : (
          trails.map((trail, i) => {
            const isExpanded = expandedTrail === i;
            const decisionColor = trail.decision === 'EXECUTED' ? '#22c55e' : trail.decision === 'SCORED' ? '#8b5cf6' : trail.decision === 'FAILED' ? '#ef4444' : '#f59e0b';
            return (
              <motion.div
                key={trail.id || `${trail.timestamp}-${i}`}
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
                  </div>

                  <div className="dt-trail-info">
                    <span className="dt-trail-reason">{trail.reason || trail.protocolId || '—'}</span>
                    <span className="dt-trail-time">{trail.timestamp ? new Date(trail.timestamp).toLocaleString() : '—'}</span>
                  </div>

                  <span className="dt-trail-chevron">{isExpanded ? '▾' : '▸'}</span>
                </div>

                {/* Expanded detail */}
                {isExpanded && (
                  <div className="dt-timeline">
                    <div className="dt-trail-data">
                      {trail.protocolId && (
                        <div className="dt-data-row"><span>Protocol</span><strong>{trail.protocolId}</strong></div>
                      )}
                      {trail.reason && (
                        <div className="dt-data-row"><span>Strategy</span><strong className="dt-reason">{trail.reason}</strong></div>
                      )}
                      {trail.price && (
                        <div className="dt-data-row"><span>Price</span><strong>{trail.price}</strong></div>
                      )}
                      {trail.quantity && (
                        <div className="dt-data-row"><span>Qty</span><strong>{trail.quantity}</strong></div>
                      )}
                      {!trail.protocolId && !trail.price && !trail.quantity && (
                        <div className="dt-data-row"><span>Note</span><strong className="dt-reason">No additional data available — pipeline stages not yet populated.</strong></div>
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
