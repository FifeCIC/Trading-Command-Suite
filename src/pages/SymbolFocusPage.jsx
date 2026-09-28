/**
 * SymbolFocusPage — single-ticker pipeline view.
 * Route: /symbol/:ticker
 *
 * Shows the full pipeline for one symbol:
 * Protocols → Trading Strategies → Live Activity → Trade Outcomes
 * Only displays information if the symbol is included in an active protocol.
 * Live-updates via polling every 10 seconds.
 */

import { useParams, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { motion } from 'motion/react';
import { apiGet } from '../core/api/client';
import LoadingSkeleton from '../components/LoadingSkeleton';
import { timeAgo } from '../core/format-utils';
import { decisionScore } from '../core/decision-score';
// #971 — the decision palette is SHARED (src/core/decision-display.js). This page used to hold
// its own copy keyed by the same values, which is how a new marker (OBSERVED) renders as an
// unstyled row in one page and is noticed in another.
import { decisionColor } from '../core/decision-display.js';
import NoticeBlock from '../components/NoticeBlock';
import { noticeFromError } from '../core/notices/from-error.js';
import './symbol-focus.css';

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

  // ── #926 follow-on — the COMPARISON view ──────────────────────────────────────────────────
  // A SEPARATE question from `/focus`. `/focus` answers "what is this symbol doing right now";
  // this answers "which of the protocols scoring it is earning its keep". The owner's ask
  // (2026-09-27): *"show a list of the protocols that score it, compared… statistics for averages
  // and highest scorer… and lowest scorer… something to help investigate the strongest and
  // weakest protocols."*
  //
  // It is worth its own query because the numbers are the point: measured for XAUUSD, 23 protocols
  // write ~85,400 rows and SIX of them write ~97% of it — a list of names cannot show that.
  const protocolsQuery = useQuery({
    queryKey: ['symbol-protocols-compare', symbol],
    queryFn: () => apiGet(`/api/symbols/${symbol}/protocols`),
    enabled: !!symbol,
    refetchInterval: 30_000,
    staleTime: 15_000,
    retry: 1,
  });

  const data = focusQuery.data;
  const loading = focusQuery.isLoading;
  const error = focusQuery.error;

  // ── #926 follow-on — the comparison rows, STRONGEST FIRST ──
  // ⚠️ A protocol with no readings in the window sorts LAST, and that is not the same as "worst":
  // it is unknown. Sorting it as zero would put an unmeasured protocol next to a measured-bad one,
  // which is exactly how a reader draws the wrong conclusion from a table.
  const comparison = (protocolsQuery.data?.protocols || [])
    .slice()
    .sort((a, b) => {
      const av = a.stats?.avg ?? null;
      const bv = b.stats?.avg ?? null;
      if (av === null && bv === null) return String(a.id).localeCompare(String(b.id));
      if (av === null) return 1;
      if (bv === null) return -1;
      return bv - av;
    });
  const measured = comparison.filter((p) => p.stats);
  const strongest = measured[0] || null;
  const weakest = measured.length > 1 ? measured[measured.length - 1] : null;
  const statsWindow = protocolsQuery.data?.statsWindowDays ?? null;
  const statsFailed = Boolean(protocolsQuery.data?.statsError);

  const fmt = (v, d = 1) => (v === null || v === undefined ? '—' : Number(v).toFixed(d));
  // ⚠️ NO local money formatter. `fmtCurrency` above already does exactly this, and a second copy
  // is the duplication the repo's own `validate-duplication` exists to catch — the shorter-lived
  // of two copies is the one that gets fixed. It was also an UNUSED local until this table needed
  // it, which is why it read as dead code (pre-existing lint finding, 2026-09-28).

  if (loading) return <div className="sf-page"><LoadingSkeleton lines={8} /></div>;
  if (error || !data) {
    return (
      <div className="sf-page">
        <div className="sf-error">
          <h2>⚠️ Unable to load symbol data</h2>
          {error ? <NoticeBlock notice={noticeFromError(error)} /> : <p>Symbol not found or API unreachable</p>}
          <Link to="/dashboard" className="sf-back-link">← Back to Dashboard</Link>
        </div>
      </div>
    );
  }

  const { protocols, tradingStrategies, recentDecisions, recentEvaluations } = data;

  // ── Helpers ──
  const fmtCurrency = (v) => {
    if (v == null) return '—';
    return (v >= 0 ? '+' : '') + Number(v).toFixed(2);
  };

  const protocolList = Object.values(protocols || {});
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

          {/* ── #926 follow-on — Protocol COMPARISON ──
              Sorted strongest → weakest so the two ends are ADJACENT, which is the whole point:
              finding the protocols that are earning their keep and the ones that only generate
              rows. Every average carries its `n`, because an average over 7 readings and one over
              14,663 are not the same claim. */}
          <motion.section className="sf-card" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.08 }}>
            <h2>⚖️ Protocol Comparison ({comparison.length})</h2>

            {protocolsQuery.isLoading ? (
              <p className="sf-muted">Loading comparison…</p>
            ) : protocolsQuery.isError ? (
              /* ⚠️ A failed request must not render as "no protocols" — an empty list is
                 information, an error is the absence of it. */
              <p className="sf-muted">⚠️ Comparison unavailable — the request failed.</p>
            ) : statsFailed ? (
              <p className="sf-muted">⚠️ Statistics unavailable — {protocolsQuery.data.statsError}</p>
            ) : comparison.length === 0 ? (
              <p className="sf-muted">No protocol is associated with {symbol}.</p>
            ) : (
              <>
                {strongest && (
                  <div className="sf-cmp-highlights">
                    <span className="sf-cmp-hl">
                      🟢 Strongest (avg): <strong>{strongest.name}</strong> {fmt(strongest.stats.avg)} over{' '}
                      {strongest.stats.samples} reading(s)
                    </span>
                    {weakest && (
                      <span className="sf-cmp-hl">
                        🔴 Weakest (avg): <strong>{weakest.name}</strong> {fmt(weakest.stats.avg)} over{' '}
                        {weakest.stats.samples} reading(s)
                      </span>
                    )}
                    <span className="sf-cmp-hl sf-muted">
                      Averages cover the last {statsWindow ?? '—'} day(s)
                    </span>
                  </div>
                )}

                <div className="sf-cmp-scroll">
                  <table className="sf-cmp-table">
                    <thead>
                      <tr>
                        <th>Protocol</th>
                        <th>Dir</th>
                        <th className="sf-num">Avg</th>
                        <th className="sf-num">High</th>
                        <th className="sf-num">Low</th>
                        <th className="sf-num">n</th>
                        <th className="sf-num">Bots</th>
                        <th className="sf-num">Trades</th>
                        <th className="sf-num">P&L</th>
                        <th>Why it is here</th>
                      </tr>
                    </thead>
                    <tbody>
                      {comparison.map((p) => (
                        <tr key={p.id} className={!p.stats ? 'sf-cmp-unmeasured' : ''}>
                          <td title={p.id}>{p.name}</td>
                          <td className="sf-cmp-dir">{p.directionMode === 'SHORT_ONLY' ? 'S' : p.directionMode === 'BOTH' ? 'L/S' : 'L'}</td>
                          <td className="sf-num">{p.stats ? fmt(p.stats.avg) : '—'}</td>
                          <td className="sf-num">{p.stats ? fmt(p.stats.high, 0) : '—'}</td>
                          <td className="sf-num">{p.stats ? fmt(p.stats.low, 0) : '—'}</td>
                          <td className="sf-num sf-muted">{p.stats ? p.stats.samples : '—'}</td>
                          {/* ⚠️ `0` bots is not "worthless". gold-macro-v1 has 0 bots AND +30.48
                              realised on XAUUSD — a rule that skipped it would have deleted a
                              profitable protocol. It is marked, not judged. */}
                          <td className="sf-num">
                            {p.bots > 0 ? p.bots : <span className="sf-cmp-flag" title="No active bot subscribes — it still generated score rows">0</span>}
                          </td>
                          <td className="sf-num">{p.realised ? p.realised.trades : '—'}</td>
                          <td className={`sf-num ${p.realised?.pnl > 0 ? 'sf-pnl-up' : p.realised?.pnl < 0 ? 'sf-pnl-down' : ''}`}>
                            {p.realised ? fmtCurrency(p.realised.pnl) : '—'}
                          </td>
                          <td className="sf-cmp-src">{(p.sources || []).join(' · ')}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <p className="sf-muted sf-cmp-note">
                  Rows are score readings written in the window. ⚠️ <strong>Trades and P&L are
                  ATTRIBUTED</strong> — `scoringStrategyId` holds a protocol slug in some rows and a
                  bot id in others, so a figure shown here is attributed, not certain.
                </p>
              </>
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
                      <span className="sf-decision-badge" style={{ background: decisionColor(d.decision) }}>
                        {d.decision}
                      </span>
                      <span className="sf-decision-time">{timeAgo(d.timestamp)}</span>
                    </div>
                    <div className="sf-decision-body">
                      {d.reason && <p className="sf-decision-reason">{d.reason}</p>}
                      <div className="sf-decision-meta">
                        {/* #909 — this used to read `Score: {d.composite}%`, which labelled a RAW
                            score with '%'. The helper names the actual unit per row. */}
                        {decisionScore(d).text && (
                          <span title={decisionScore(d).title || undefined}>Score: {decisionScore(d).text}</span>
                        )}
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
