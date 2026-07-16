/**
 * SymbolFocusPage — single-ticker pipeline view.
 * Route: /symbol/:ticker
 *
 * Shows the full pipeline for one symbol:
 * Protocols → Scoring Strategies → Trading Strategies → Live Activity → Trade Outcomes
 * Only displays information if the symbol is included in an active protocol.
 * Live-updates via polling every 10 seconds.
 */

import { useParams, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { motion } from 'motion/react';
import { apiGet } from '../core/api/client';
import LoadingSkeleton from '../components/LoadingSkeleton';
import './symbol-focus.css';

const DECISION_COLORS = {
  SCORED: '#60a5fa',
  EXECUTED: '#22c55e',
  FAILED: '#ef4444',
  BLOCKED: '#f59e0b',
  SKIP: '#64748b',
  HOLD: '#94a3b8',
  QUEUED: '#a855f7',
};

const SIGNAL_COLORS = { BUY: '#22c55e', SELL: '#ef4444', HOLD: '#94a3b8' };

const MODE_BADGES = {
  auto: { label: 'AUTO', cls: 'sf-badge-auto' },
  'semi-auto': { label: 'SEMI', cls: 'sf-badge-semi' },
  manual: { label: 'MANUAL', cls: 'sf-badge-manual' },
};

export default function SymbolFocusPage() {
  const { ticker } = useParams();
  const symbol = (ticker || '').toUpperCase();

  const focusQuery = useQuery({
    queryKey: ['symbol-focus', symbol],
    queryFn: () => apiGet(`/api/symbols/${symbol}/focus`),
    enabled: !!symbol,
    refetchInterval: 10_000,
    staleTime: 5_000,
    retry: 1,
  });

  const data = focusQuery.data;
  const loading = focusQuery.isLoading;
  const error = focusQuery.error;

  if (loading) return <div className="sf-page"><LoadingSkeleton lines={8} /></div>;
  if (error || !data) {
    return (
      <div className="sf-page">
        <div className="sf-error">
          <h2>⚠️ Unable to load symbol data</h2>
          <p>{error?.message || 'Symbol not found or API unreachable'}</p>
          <Link to="/dashboard" className="sf-back-link">← Back to Dashboard</Link>
        </div>
      </div>
    );
  }

  const { protocols, scoringStrategies, tradingStrategies, recentDecisions, recentEvaluations } = data;

  // ── Helpers ──
  const fmtCurrency = (v) => {
    if (v == null) return '—';
    return (v >= 0 ? '+' : '') + Number(v).toFixed(2);
  };

  const timeAgo = (ts) => {
    if (!ts) return '';
    const diff = Date.now() - new Date(ts).getTime();
    const sec = Math.floor(diff / 1000);
    if (sec < 60) return `${sec}s ago`;
    const min = Math.floor(sec / 60);
    if (min < 60) return `${min}m ago`;
    const hr = Math.floor(min / 60);
    return `${hr}h ago`;
  };

  const protocolList = Object.values(protocols || {});
  const hasScoring = scoringStrategies?.length > 0;
  const hasTrading = tradingStrategies?.length > 0;
  const hasDecisions = recentDecisions?.length > 0;
  const hasEvaluations = recentEvaluations?.length > 0;

  return (
    <div className="sf-page">
      {/* ── Header ── */}
      <div className="sf-header">
        <div className="sf-header-top">
          <Link to="/dashboard" className="sf-back-link">← Dashboard</Link>
          {focusQuery.isFetching && <span className="sf-live-dot" title="Live updates">⟳</span>}
        </div>
        <div className="sf-header-main">
          <h1 className="sf-ticker">{data.ticker}</h1>
          <span className="sf-name">{data.name}</span>
          <span className="sf-exchange">{data.exchange}</span>
          <span className={`sf-type-badge sf-type-${data.type?.toLowerCase() || 'other'}`}>
            {data.type || 'Unknown'}
          </span>
          {!data.active && <span className="sf-inactive">Inactive</span>}
        </div>
        {!data.scored && (
          <div className="sf-empty-banner">
            ℹ️ This symbol is not currently included in any active protocol or strategy.
          </div>
        )}
      </div>

      {/* ── Main Grid ── */}
      <div className="sf-grid">
        {/* Left column */}
        <div className="sf-col">
          {/* Protocols */}
          <motion.section className="sf-card" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
            <h2>🧬 Protocols ({protocolList.length})</h2>
            {protocolList.length === 0 ? (
              <p className="sf-muted">No protocols reference this symbol.</p>
            ) : (
              <div className="sf-protocol-list">
                {protocolList.map((p) => (
                  <div key={p.id} className="sf-protocol-item">
                    <div className="sf-protocol-head">
                      <span className="sf-protocol-name">{p.name}</span>
                      <span className="sf-protocol-id">{p.id}</span>
                    </div>
                    <p className="sf-protocol-desc">{p.description}</p>
                    <div className="sf-protocol-meta">
                      <span className={`sf-dir-badge sf-dir-${p.directionMode?.toLowerCase() || 'long'}`}>
                        {p.directionMode || 'LONG_ONLY'}
                      </span>
                      <span>{p.tradingStyle || '—'}</span>
                      <span>{p.groupCount} directive groups</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </motion.section>

          {/* Scoring Strategies */}
          <motion.section className="sf-card" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }}>
            <h2>🎯 Scoring Strategies ({scoringStrategies?.length || 0})</h2>
            {!hasScoring ? (
              <p className="sf-muted">No scoring strategies include this symbol's watchlist.</p>
            ) : (
              <div className="sf-strat-list">
                {scoringStrategies.map((s) => (
                  <div key={s.id} className={`sf-strat-item ${s.tradingEnabled ? 'sf-strat-trading' : ''}`}>
                    <div className="sf-strat-head">
                      <span className="sf-strat-name">{s.name}</span>
                      <span className={`sf-mode-badge ${MODE_BADGES[s.mode]?.cls || ''}`}>
                        {MODE_BADGES[s.mode]?.label || s.mode}
                      </span>
                      {s.tradingEnabled && <span className="sf-trading-badge">TRADING</span>}
                    </div>
                    <div className="sf-strat-details">
                      <div className="sf-strat-detail">
                        <span className="sf-detail-label">Protocol</span>
                        <span className="sf-detail-val">{s.protocolId}</span>
                      </div>
                      {s.shortProtocolId && (
                        <div className="sf-strat-detail">
                          <span className="sf-detail-label">Short</span>
                          <span className="sf-detail-val">{s.shortProtocolId}</span>
                        </div>
                      )}
                      <div className="sf-strat-detail">
                        <span className="sf-detail-label">Watchlist</span>
                        <span className="sf-detail-val">{s.watchlistName}</span>
                      </div>
                      <div className="sf-strat-detail">
                        <span className="sf-detail-label">Broker</span>
                        <span className="sf-detail-val">{s.brokerId}</span>
                      </div>
                      <div className="sf-strat-detail">
                        <span className="sf-detail-label">Threshold</span>
                        <span className="sf-detail-val">{s.tradeThreshold}%</span>
                      </div>
                      <div className="sf-strat-detail">
                        <span className="sf-detail-label">Status</span>
                        <span className={`sf-detail-val ${s.enabled ? 'sf-ok' : 'sf-err'}`}>
                          {s.enabled ? 'Enabled' : 'Disabled'}
                        </span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </motion.section>

          {/* Trading Strategies */}
          <motion.section className="sf-card" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
            <h2>📈 Trading Strategies ({tradingStrategies?.length || 0})</h2>
            {!hasTrading ? (
              <p className="sf-muted">No trading strategies target this symbol.</p>
            ) : (
              <div className="sf-strat-list">
                {tradingStrategies.map((s) => (
                  <div key={s.id} className={`sf-strat-item ${s.active ? 'sf-strat-active' : ''}`}>
                    <div className="sf-strat-head">
                      <span className="sf-strat-name">{s.name}</span>
                      <span className={`sf-mode-badge ${MODE_BADGES[s.mode]?.cls || ''}`}>
                        {MODE_BADGES[s.mode]?.label || s.mode}
                      </span>
                      {s.active && <span className="sf-trading-badge sf-trading-live">ACTIVE</span>}
                    </div>
                    <div className="sf-strat-details">
                      <div className="sf-strat-detail">
                        <span className="sf-detail-label">Protocol</span>
                        <span className="sf-detail-val">{s.protocolId}</span>
                      </div>
                      {s.shortProtocolId && (
                        <div className="sf-strat-detail">
                          <span className="sf-detail-label">Short</span>
                          <span className="sf-detail-val">{s.shortProtocolId}</span>
                        </div>
                      )}
                      <div className="sf-strat-detail">
                        <span className="sf-detail-label">Broker</span>
                        <span className="sf-detail-val">{s.brokerId}</span>
                      </div>
                      <div className="sf-strat-detail">
                        <span className="sf-detail-label">Timeframe</span>
                        <span className="sf-detail-val">{s.timeframe}</span>
                      </div>
                      <div className="sf-strat-detail">
                        <span className="sf-detail-label">Min Score</span>
                        <span className="sf-detail-val">{s.minComposite}%</span>
                      </div>
                      <div className="sf-strat-detail">
                        <span className="sf-detail-label">SL/TP</span>
                        <span className="sf-detail-val">{s.slPct}% / {s.tpPct}%</span>
                      </div>
                      <div className="sf-strat-detail">
                        <span className="sf-detail-label">Size</span>
                        <span className="sf-detail-val">{s.baseSize}</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </motion.section>
        </div>

        {/* Right column */}
        <div className="sf-col">
          {/* Live Activity — Decision Log */}
          <motion.section className="sf-card" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }}>
            <h2>
              🔴 Live Activity
              {focusQuery.isFetching && <span className="sf-pulse">⬤</span>}
            </h2>
            {!hasDecisions ? (
              <p className="sf-muted">No recent decisions. The automation loop hasn't evaluated this symbol yet.</p>
            ) : (
              <div className="sf-decision-list">
                {recentDecisions.map((d, i) => (
                  <div key={i} className="sf-decision-item">
                    <div className="sf-decision-head">
                      <span className="sf-decision-badge" style={{ background: DECISION_COLORS[d.decision] || '#64748b' }}>
                        {d.decision}
                      </span>
                      <span className="sf-decision-time">{timeAgo(d.timestamp)}</span>
                    </div>
                    <div className="sf-decision-body">
                      {d.reason && <p className="sf-decision-reason">{d.reason}</p>}
                      <div className="sf-decision-meta">
                        {d.composite > 0 && <span>Score: {d.composite}%</span>}
                        {d.signal && (
                          <span style={{ color: SIGNAL_COLORS[d.signal] || '#94a3b8' }}>{d.signal}</span>
                        )}
                        {d.ticket && <span>Ticket: {d.ticket}</span>}
                        {d.price && <span>@{d.price.toFixed(5)}</span>}
                        {d.quantity && <span>×{d.quantity}</span>}
                        <span className="sf-decision-tick">Tick #{d.tickNumber}</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </motion.section>

          {/* Trade Outcomes — Strategy Evaluations */}
          <motion.section className="sf-card" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}>
            <h2>📊 Trade Outcomes</h2>
            {!hasEvaluations ? (
              <p className="sf-muted">No trade outcomes recorded yet.</p>
            ) : (
              <div className="sf-eval-list">
                {recentEvaluations.map((e) => (
                  <div key={e.id} className={`sf-eval-item ${e.traded ? 'sf-eval-traded' : ''}`}>
                    <div className="sf-eval-head">
                      <span className="sf-eval-signal" style={{ color: SIGNAL_COLORS[e.signal] || '#94a3b8' }}>
                        {e.signal || 'HOLD'}
                      </span>
                      <span className="sf-eval-composite">{e.composite?.toFixed(1)}%</span>
                      <span className="sf-eval-time">{timeAgo(e.evaluatedAt)}</span>
                    </div>
                    <div className="sf-eval-details">
                      {e.rarityBand && <span className="sf-rarity-band">{e.rarityBand} ({e.rarityPct?.toFixed(1)}%)</span>}
                      {e.traded ? (
                        <span className="sf-traded-yes">✅ Traded — Ticket {e.tradeTicket}</span>
                      ) : (
                        <span className="sf-traded-no">○ Not traded</span>
                      )}
                      {e.tradeResult && <span className="sf-trade-result">{e.tradeResult}</span>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </motion.section>
        </div>
      </div>
    </div>
  );
}
