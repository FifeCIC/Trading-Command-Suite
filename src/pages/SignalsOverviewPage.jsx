/**
 * Signals Overview — the /signals/ area (#684 Signals v1).
 * ==========================================================
 * The best-of opportunities ladder: every ACTIVE protocol is scored and
 * the strongest actionable setups surface here — no symbol selection, no
 * protocol selection. Action-only (no HOLD), ranked by combined strength
 * (0.5 × signal + 0.5 × opportunity).
 *
 * Contrast with /scoring/ (SEES monitoring: every ladder, all scores —
 * including the poor ones).
 *
 * Data:
 *   GET /api/signals/best        — ranked actionable envelopes
 *   GET /api/signals/dismissals  — active dismissals (show-dismissed)
 *   POST /api/signals/dismiss    — hide a signal for N hours
 *   GET /api/signals/:id/action  — bot-action state per signal
 *   POST /api/signals/:id/trade  — manual trade via the bot's safety chain
 */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { motion, AnimatePresence } from 'motion/react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import PageInfoPopover from '../components/PageInfoPopover';
import LoadingSkeleton from '../components/LoadingSkeleton';
import SignalBadge from '../components/SignalBadge';
import { buildScoreDisplay } from '../core/score-display';
import { timeAgo } from '../core/format-utils';
import { stripWarningGlyph } from '../core/signal-utils';
import {
  fetchBestSignals,
  fetchSignalDismissals,
  fetchSignalAnalytics,
  dismissSignal,
  fetchSignalAction,
  tradeSignal,
  createSignalPlan,
} from '../core/api/signals';
import './signals-overview.css';

const REFRESH_MS = 60_000;

/** Dismissal horizon in hours — Screen Option 'Dismissal Window' (#684). */
function readDismissHours() {
  const v = parseInt(localStorage.getItem('sig-dismiss-hours') || '1', 10);
  return Number.isFinite(v) && v >= 1 && v <= 168 ? v : 1;
}

/** Direction chip label from a protocol's direction intent. */
function directionLabel(mode) {
  if (mode === 'SHORT_ONLY') return { label: 'SHORT', cls: 'short' };
  if (mode === 'BOTH') return { label: 'L/S', cls: 'both' };
  return { label: 'LONG', cls: 'long' };
}

/** Top directives across all groups, best-normalized first (max 3). */
function topDirectives(envelope) {
  const all = [];
  for (const g of envelope.groups || []) {
    for (const d of g.topDirectives || []) all.push(d);
  }
  return all.sort((a, b) => b.normalized - a.normalized).slice(0, 3);
}

/** One opportunity card — the unit of the Signals ladder. */
function OpportunityCard({ envelope, dismissHours, onDismissed }) {
  const [confirming, setConfirming] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [copied, setCopied] = useState(false);

  /** Copy the signal's canonical reference (Score UUID) to the clipboard. */
  const copyRef = async () => {
    if (!envelope.scoreId) return;
    try { await navigator.clipboard.writeText(envelope.scoreId); } catch { /* clipboard unavailable */ }
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };

  // NOTE: marketStatus is deliberately omitted from the badge view model.
  // Best-of scores use 1d bars, which are always >30m old — buildScoreDisplay
  // would mark every card STALE/PAUSED. Closed markets are shown as an
  // explicit chip instead, and the server blocks trades when truly closed.
  const vm = buildScoreDisplay({
    signal: envelope.signal,
    value: envelope.composite,
  });
  const marketOpen = envelope.marketStatus ? envelope.marketStatus.open !== false : true;
  const dir = directionLabel(envelope.directionMode);
  // BUY/STRONG_BUY → long; SELL/STRONG_SELL → short; SHORT_ONLY protocols always short.
  const isBuy = envelope.directionMode !== 'SHORT_ONLY'
    && !String(envelope.signal || '').toUpperCase().includes('SELL');
  const directives = topDirectives(envelope);

  // Bot-action state for this signal (none | pending | filled).
  const actionQuery = useQuery({
    queryKey: ['signal-action', envelope.scoreId],
    queryFn: () => fetchSignalAction(envelope.scoreId),
    enabled: Boolean(envelope.scoreId),
    staleTime: 60_000,
    refetchInterval: REFRESH_MS,
  });

  const dismissMutation = useMutation({
    mutationFn: () => dismissSignal({
      symbol: envelope.symbol,
      protocolId: envelope.protocolId,
      hours: dismissHours,
      strengths: {
        combinedStrength: envelope.combinedStrength,
        signalPct: envelope.signalPct,
        opportunityPct: envelope.opportunityPct,
      },
    }),
    onSuccess: () => {
      setResult({ type: 'dismissed', text: `Dismissed for ${dismissHours}h` });
      onDismissed();
    },
    onError: (e) => setError(e?.message || 'Dismiss failed'),
  });

  const tradeMutation = useMutation({
    mutationFn: ({ side }) => tradeSignal(envelope.scoreId, { side, brokerId: 'mt5' }),
    onSuccess: (r) => {
      if (r?.success === false) {
        setError(r.error || 'Order failed');
      } else {
        // Replace the trade button with the placed order — clicking it opens
        // Positions Monitor with the position highlighted. No double-trade.
        setResult({ type: 'trade', text: `Order placed #${r?.orderId}`, orderId: r?.orderId });
      }
      setConfirming(false);
    },
    onError: (e) => {
      setError(e?.message || 'Trade failed');
      setConfirming(false);
    },
  });

  // Signals → Trading handover: queue as a draft plan with signal context (#702).
  const planMutation = useMutation({
    mutationFn: () => createSignalPlan(envelope.scoreId, {
      direction: isBuy ? 'LONG' : 'SHORT',
      protocolName: envelope.protocolName || null,
      context: {
        combinedStrength: envelope.combinedStrength,
        signalPct: envelope.signalPct,
        opportunityPct: envelope.opportunityPct,
        confidence: envelope.confidence,
        topDirectives: directives,
        warnings: envelope.riskGate?.warnings || [],
      },
    }),
    onSuccess: (r) => {
      if (r?.success === false) {
        setError(r.message || 'Plan already exists for this signal');
      } else {
        setResult({ type: 'plan', text: 'Plan created', planId: r?.planId });
      }
    },
    onError: (e) => setError(e?.message || 'Plan creation failed'),
  });

  const startConfirm = () => {
    setError(null);
    setResult(null);
    setConfirming(true);
  };

  const blocked = envelope.preTradeBlockers?.length > 0;
  const botAction = actionQuery.data?.action || 'none';
  // #723 — generation-time execution blockers (same library re-checks at click).
  const execBlockers = envelope.executionBlockers || [];
  const execBlocked = execBlockers.length > 0;
  // Pre-flight: why a trade would 400 right now (checked before the click,
  // mirroring the server's safety chain — market gate + pre-trade readiness
  // + execution feasibility).
  const tradeBlockedReason = execBlockers[0]?.message
    || (!marketOpen ? (envelope.marketStatus?.reason || 'Market closed — trade blocked') : null)
    || (blocked ? envelope.preTradeBlockers.slice(0, 2).join(' · ') : null);

  return (
    <motion.article
      className={`sig-opp-card ${blocked ? 'sig-opp-card--blocked' : ''}`}
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.96 }}
    >
      <header className="sig-opp-head">
        <span className="sig-opp-ticker">{envelope.symbol}</span>
        <SignalBadge display={vm} arrowOnly />
        <span className={`sig-opp-dir sig-opp-dir--${dir.cls}`}>{dir.label}</span>
        {!marketOpen && (
          <span
            className="sig-opp-closed"
            title={`Market closed — trade blocked: ${envelope.marketStatus?.reason || 'closed'}`}
          >
            CLOSED
          </span>
        )}
        <span className="sig-opp-proto" title={`Protocol: ${envelope.protocolId}`}>
          {envelope.protocolName || envelope.protocolId}
        </span>
        <span className="sig-opp-time">{timeAgo(envelope.scoredAt)}</span>
        {envelope.scoreId && (
          <button
            type="button"
            className="sig-opp-ref"
            title={`Signal ref ${envelope.scoreId} — click to copy`}
            onClick={copyRef}
          >
            {copied ? '✓ copied' : `⧉ ${envelope.scoreId.slice(-8)}`}
          </button>
        )}
      </header>

      <div className="sig-opp-scores">
        <div className="sig-opp-combined">
          <div className="sig-opp-combined-head">
            <span>Combined strength</span>
            <strong>{envelope.combinedStrength}</strong>
          </div>
          <div className="sig-opp-bar">
            <div className="sig-opp-bar-fill" style={{ width: `${Math.min(100, envelope.combinedStrength)}%` }} />
          </div>
        </div>
        <div className="sig-opp-metrics">
          <span className="sig-opp-metric">
            <em>Signal</em> <strong>{envelope.signalPct ?? '—'}{envelope.signalPct != null ? '%' : ''}</strong>
          </span>
          <span className="sig-opp-metric">
            <em>Opportunity</em> <strong>{envelope.opportunityPct ?? '—'}{envelope.opportunityPct != null ? '%' : ''}</strong>
          </span>
          <span className="sig-opp-metric">
            <em>Confidence</em> <strong>{envelope.confidence}</strong>
          </span>
          {envelope.rarity && (
            <span className="sig-opp-metric sig-opp-metric--rarity" title="Rarity band">
              <em>Rarity</em> <strong>{envelope.rarity}</strong>
            </span>
          )}
          {botAction === 'filled' && <span className="sig-opp-bot sig-opp-bot--filled" title="Bot already traded this">Bot: filled</span>}
          {botAction === 'pending' && <span className="sig-opp-bot" title="Bot order queued">Bot: pending</span>}
        </div>
      </div>

      {directives.length > 0 && (
        <div className="sig-opp-directives">
          {directives.map((d) => (
            <span key={d.id} className={`sig-opp-chip sig-opp-chip--${d.signalClass || 'neutral'}`} title={`${d.reason || ''} (${d.normalized}/100)`}>
              {d.name}
            </span>
          ))}
        </div>
      )}

      {envelope.riskGate?.warnings?.length > 0 && (
        <div className="sig-opp-warnings">⚠ {envelope.riskGate.warnings.slice(0, 2).map(stripWarningGlyph).join(' · ')}</div>
      )}
      {blocked && <div className="sig-opp-blockers">🚫 {envelope.preTradeBlockers.slice(0, 2).join(' · ')}</div>}
      {execBlocked && (
        <div className="sig-opp-exec">
          {execBlockers.map((b, i) => (
            <span key={i} title={b.hint}>
              ⛔ {b.message}{b.hint ? ` — ${b.hint}` : ''}
            </span>
          ))}
        </div>
      )}
      {envelope.conflicts?.length > 0 && (
        <div className="sig-opp-conflicts">
          {envelope.conflicts.map((c, i) => (
            <span key={i} title={`${c.type} · ${c.severity} severity`}>
              {c.severity === 'high' ? '⚔' : '△'} {c.description}
              {c.directives?.length > 0 ? ` — ${c.directives.join(', ')}` : ''}
            </span>
          ))}
        </div>
      )}

      <footer className="sig-opp-actions">
        {result?.type === 'trade' ? (
          <Link
            to={`/trading/positions-monitor?highlight=${encodeURIComponent(String(result.orderId ?? ''))}`}
            className="sig-opp-btn sig-opp-btn--placed"
            title="View this position in Positions Monitor"
          >
            ✓ {result.text}
          </Link>
        ) : confirming ? (
          <button
            type="button"
            className="sig-opp-btn sig-opp-btn--confirm"
            onClick={() => tradeMutation.mutate({ side: isBuy ? 'BUY' : 'SELL' })}
            disabled={tradeMutation.isPending || !envelope.scoreId}
          >
            {tradeMutation.isPending
              ? 'Sending…'
              : `Confirm ${isBuy ? 'buy' : 'sell'} ${envelope.symbol} on MT5`}
          </button>
        ) : (
          <button
            type="button"
            className={`sig-opp-btn ${isBuy ? 'sig-opp-btn--buy' : 'sig-opp-btn--sell'}`}
            onClick={startConfirm}
            disabled={!envelope.scoreId || Boolean(tradeBlockedReason)}
            title={
              tradeBlockedReason
                ? `Blocked: ${tradeBlockedReason}${execBlockers[0]?.hint ? ` — ${execBlockers[0].hint}` : ''}`
                : !envelope.scoreId
                  ? 'No persisted score to trade against'
                  : `Open ${isBuy ? 'long' : 'short'} CFD on MT5`
            }
          >
            {isBuy ? '▲ Buy CFD' : '▼ Sell CFD'}
          </button>
        )}
        <button
          type="button"
          className="sig-opp-btn sig-opp-btn--plan"
          onClick={() => planMutation.mutate()}
          disabled={planMutation.isPending || !envelope.scoreId}
          title="Queue into the Trading area as a draft plan"
        >
          {planMutation.isPending ? '…' : 'Plan'}
        </button>
        <button
          type="button"
          className="sig-opp-btn sig-opp-btn--dismiss"
          onClick={() => dismissMutation.mutate()}
          disabled={dismissMutation.isPending}
        >
          {dismissMutation.isPending ? '…' : 'Dismiss'}
        </button>
      </footer>

      <AnimatePresence>
        {(result || error) && (
          <motion.div
            className={`sig-opp-feedback ${error ? 'sig-opp-feedback--error' : 'sig-opp-feedback--ok'}`}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            {error || (result?.type === 'plan' ? (
              <span>
                Plan created — <Link to="/trading/trading-plans">open in Trading Plans</Link>
              </span>
            ) : result?.text)}
          </motion.div>
        )}
      </AnimatePresence>
    </motion.article>
  );
}

/**
 * Signal Loop panel (#693) — non-executive feedback-loop observability.
 * Dismissal analytics, real-trade outcomes, and rank validation. Read-only:
 * nothing on this panel changes trading behaviour.
 */
function SignalLoopPanel({ data, loading, error }) {
  if (loading && !data) {
    return (
      <section className="sig-loop">
        <details>
          <summary>↺ Signal feedback loop</summary>
          <p className="sig-empty-sub">Loading…</p>
        </details>
      </section>
    );
  }
  if (error && !data) {
    return (
      <section className="sig-loop">
        <details>
          <summary>↺ Signal feedback loop</summary>
          <p className="sig-empty-sub">Analytics unavailable.</p>
        </details>
      </section>
    );
  }
  if (!data) return null;

  const { dismissals, outcomes, ranks } = data;
  const winRate = outcomes.winRate;

  return (
    <section className="sig-loop">
      <details>
        <summary>
          ↺ Signal feedback loop <span className="sig-loop-sub">observability — nothing here changes trading</span>
        </summary>
        <div className="sig-loop-body">
          <div className="sig-loop-stats">
            <div className="sig-loop-stat">
              <strong>{dismissals.total}</strong>
              <em>Dismissals ({dismissals.active} active)</em>
            </div>
            <div className="sig-loop-stat">
              <strong>{outcomes.traded}</strong>
              <em>Signal trades ({outcomes.open} open)</em>
            </div>
            <div className="sig-loop-stat">
              <strong>{winRate != null ? `${winRate}%` : '—'}</strong>
              <em>Closed win rate ({outcomes.won}W / {outcomes.lost}L)</em>
            </div>
            <div className="sig-loop-stat">
              <strong>{ranks.avgRankTraded ?? '—'}</strong>
              <em>Avg rank traded{ranks.avgRankAll != null ? ` vs all ${ranks.avgRankAll}` : ''}</em>
            </div>
          </div>

          <div className="sig-loop-cols">
            <div className="sig-loop-col">
              <h3>Top dismissed protocols</h3>
              {dismissals.byProtocol.length === 0 && <p className="sig-empty-sub">No dismissals recorded yet.</p>}
              <table className="sig-loop-table">
                <tbody>
                  {dismissals.byProtocol.map((r) => (
                    <tr key={r.protocolId}>
                      <td title={r.protocolId}>{r.protocolId}</td>
                      <td className="sig-loop-num">{r.count}</td>
                      <td className="sig-loop-num dim">{r.avgStrength != null ? `avg ${r.avgStrength}` : ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {dismissals.bands.length > 0 && (
                <div className="sig-loop-bands">
                  {dismissals.bands.map((b) => (
                    <span key={b.band} className="sig-loop-chip" title="Dismissals by combined strength at dismissal time">
                      {b.band}: {b.count}
                    </span>
                  ))}
                </div>
              )}
            </div>

            <div className="sig-loop-col">
              <h3>Signal trades by protocol</h3>
              {outcomes.byProtocol.length === 0 && <p className="sig-empty-sub">No signal trades recorded yet.</p>}
              <table className="sig-loop-table">
                <tbody>
                  {outcomes.byProtocol.map((r) => (
                    <tr key={r.protocolId}>
                      <td title={r.protocolId}>{r.protocolId}</td>
                      <td className="sig-loop-num">{r.count}</td>
                      <td className="sig-loop-num dim">{r.closed > 0 ? `${r.won}/${r.closed} won` : ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="sig-loop-note">
                {ranks.snapshots > 0
                  ? `${ranks.snapshots} rank snapshots collected (hourly). Traded cards' avg rank vs all cards validates the 0.5/0.5 combined-strength weighting.`
                  : 'Rank snapshots are collected hourly — first validation data appears after an hour.'}
              </p>
            </div>
          </div>
        </div>
      </details>
    </section>
  );
}

export default function SignalsOverviewPage() {
  const queryClient = useQueryClient();
  const [showDismissed, setShowDismissed] = useState(false);
  const dismissHours = readDismissHours();

  const bestQuery = useQuery({
    queryKey: ['signals-best'],
    queryFn: fetchBestSignals,
    refetchInterval: REFRESH_MS,
  });

  const dismissalsQuery = useQuery({
    queryKey: ['signals-dismissals'],
    queryFn: fetchSignalDismissals,
    refetchInterval: REFRESH_MS,
    enabled: showDismissed,
  });

  // Feedback-loop observability (#693) — non-executive analytics.
  const analyticsQuery = useQuery({
    queryKey: ['signals-analytics'],
    queryFn: fetchSignalAnalytics,
    refetchInterval: 5 * REFRESH_MS,
  });

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['signals-best'] });
    queryClient.invalidateQueries({ queryKey: ['signal-action'] });
  };

  const data = bestQuery.data;
  const envelopes = Array.isArray(data?.envelopes) ? data.envelopes : [];

  return (
    <div className="sig-page">
      <motion.header className="sig-header" initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }}>
        <h1>
          Signals
          <PageInfoPopover>
            The best of opportunities, surfaced for action. Every active protocol is scored and only actionable
            BUY/SELL setups appear — ranked by combined strength (signal + opportunity). Contrast with Scoring
            (SEES monitoring — every ladder and all scores). Trades go through the same safety chain as the bot.
          </PageInfoPopover>
        </h1>
        {data && (
          <span className="sig-sub">
            {data.totalSymbols} opportunit{data.totalSymbols === 1 ? 'y' : 'ies'} · {data.buyCount} buy · {data.sellCount} sell ·{' '}
            {data.activeProtocols} active protocols · updated {timeAgo(data.generatedAt)}
          </span>
        )}
      </motion.header>

      <div className="sig-toolbar">
        <button type="button" className="sig-tool" onClick={refresh} disabled={bestQuery.isFetching}>
          {bestQuery.isFetching ? 'Refreshing…' : '↻ Refresh'}
        </button>
        <button
          type="button"
          className={`sig-tool ${showDismissed ? 'sig-tool--active' : ''}`}
          onClick={() => setShowDismissed((s) => !s)}
        >
          Show dismissed
        </button>
      </div>

      {bestQuery.isLoading && <LoadingSkeleton rows={4} />}

      {bestQuery.isError && (
        <div className="sig-banner sig-banner--error">
          Signals data unavailable — {bestQuery.error?.message || 'check the API'}.{' '}
          <button type="button" className="sig-link-btn" onClick={refresh}>Retry</button>
        </div>
      )}

      {data && envelopes.length === 0 && (
        <div className="sig-empty">
          <p>No actionable signals right now.</p>
          <p className="sig-empty-sub">
            HOLD scores (no directional edge) are intentionally hidden here — see the Scoring area for the full picture.
          </p>
        </div>
      )}

      <div className="sig-opp-grid">
        <AnimatePresence>
          {envelopes.map((env) => (
            <OpportunityCard
              key={`${env.symbol}|${env.protocolId}|${env.directionMode}`}
              envelope={env}
              dismissHours={dismissHours}
              onDismissed={refresh}
            />
          ))}
        </AnimatePresence>
      </div>

      {showDismissed && (
        <section className="sig-dismissed">
          <h2>Dismissed signals</h2>
          {dismissalsQuery.isLoading && <p className="sig-empty-sub">Loading…</p>}
          {dismissalsQuery.data && dismissalsQuery.data.length === 0 && (
            <p className="sig-empty-sub">Nothing dismissed — cards reappear automatically when the horizon passes.</p>
          )}
          {(dismissalsQuery.data || []).map((d) => (
            <span key={`${d.symbol}|${d.protocolId}`} className="sig-dismissed-item">
              {d.symbol} · {d.protocolId} — returns {timeAgo(d.dismissedUntil)}
            </span>
          ))}
        </section>
      )}

      <SignalLoopPanel
        data={analyticsQuery.data}
        loading={analyticsQuery.isLoading}
        error={analyticsQuery.isError}
      />

      <div className="sig-links">
        <Link to="/scoring/symbols-ladder" className="sig-link">View the full Symbols Ladder (Scoring)</Link>
        <Link to="/scoring/live-ordering-stack" className="sig-link">View the Scoring Ladder</Link>
      </div>
    </div>
  );
}

