/**
 * Decision Trail Browser
 * ======================
 * Visualize the full chain: Scoring → Comparison → Decision → Execution → Monitoring.
 * Reads from the automation loop's decision_log — the same data that powers
 * /api/automation/status recentDecisions. No separate storage system.
 *
 * Supports ?symbol=AAPL for deep-linking from other views.
 *
 * WHAT THIS PAGE IS FOR, in one word: RATIONALE.
 * Every automated decision needs an answer to "why did it do that", and a record of the rules that
 * fired is the DETERMINISTIC half of that answer — which gate blocked the trade, which blocker carried
 * a hint, which stages ran in what order. A model-driven stage would need to write its RATIONALE into
 * this same trail rather than into a log of its own, because a second place where reasoning is recorded
 * is a second place to look and the one nobody checks is the one that matters. If an AI stage is added
 * later (see the AI-Assisted Systems terms in the glossary), this trail is where its explanation
 * belongs — and until then, this page is the precedent that makes that decision easy.
 */

import { useState, useMemo, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { motion } from 'motion/react';
import { apiGet } from '../core/api/client';
import { decisionScore } from '../core/decision-score';
// #971 — one shared decision vocabulary (marker + palette + label). The page used to colour with
// an inline ternary, which could not express "this row has no consumer" and rendered a ladder
// observation exactly like a signal that could trade.
import {
  decisionColor as decisionColorOf,
  decisionLabel,
  isObservation,
} from '../core/decision-display.js';
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
          <h1>Decision Trail Browser
          <PageInfoPopover>
            Trace the full pipeline: Scoring → Comparison → Decision → Execution → Monitoring. Data from automation loop decision_log — the same decisions shown in /api/automation/status.
          </PageInfoPopover>
        </h1>
        </div>
      </header>

      {/* Completeness overview — hidden when no stage tracking data exists */}
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
            const decisionColor = decisionColorOf(trail.decision);
            // #909 — the 1500/500 colour scale is a RAW-score scale. A percentage row can never
            // clear it, and colouring one by it was reading the wrong units; pct rows and
            // historical (unit-unrecorded) rows get the neutral colour instead.
            const score = decisionScore(trail);
            const scoreColor = score.kind !== 'raw'
              ? 'var(--ink-soft)'
              : score.value >= 1500 ? '#22c55e' : score.value >= 500 ? '#f59e0b' : 'var(--ink-soft)';
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
                      {decisionLabel(trail.decision)}
                    </span>
                    {isObservation(trail) && (
                      <span
                        className="dt-trail-observation"
                        title="No bot is subscribed to this row — it is an observation, and nothing will act on it."
                      >
                        no consumer
                      </span>
                    )}
                    <span className="dt-trail-composite" title={score.title || undefined} style={{ color: scoreColor }}>
                      {score.text}
                    </span>
                    {trail.ticket && <span className="dt-trail-ticket">#{trail.ticket}</span>}
                  </div>

                  <div className="dt-trail-info">
                    <span className="dt-trail-reason">{trail.reason || trail.signal || '—'}</span>
                    <span className="dt-trail-time">{trail.timestamp ? new Date(trail.timestamp).toLocaleString() : '—'}</span>
                  </div>

                  <span className="dt-trail-chevron">{isExpanded ? '▾' : '▸'}</span>
                </div>

                {/* Expanded detail — additional fields not in summary */}
                {isExpanded && (
                  <div className="dt-timeline">
                    <div className="dt-trail-data">
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
                      {trail.watchlistName && (
                        <div className="dt-data-row"><span>Watchlist</span><strong>{trail.watchlistName}</strong></div>
                      )}
                      {trail.protocolId && (
                        <div className="dt-data-row"><span>Protocol</span><strong>{trail.protocolId}</strong></div>
                      )}
                      {!trail.price && !trail.quantity && !trail.strategyId && !trail.brokerId && !trail.watchlistName && !trail.protocolId && (
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
