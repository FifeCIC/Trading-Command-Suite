/**
 * SignalCard — the ONE signal-card presentation, shared by Signals Overview and the META.Stack Cockpit.
 * ======================================================================================================
 * Extracted from `SignalsOverviewPage.jsx` (2026-09-17). This is **variant B**, which was already the
 * default there — the page chose it unless the URL said `?variant=A`. Rendering is UNCHANGED; this is
 * a move, so Signals Overview looks and behaves exactly as before.
 *
 * WHY B
 * The page carried two live implementations of the same card (`OpportunityCard` and
 * `OpportunityCardB`). Per the standing preference, copies are taken from **B**. A is left in place
 * and still reachable at `?variant=A` — deliberately not deleted, because removing a live variant is
 * a decision, not a refactor.
 *
 * ⚠️ MOUNTING THIS CARD COSTS NETWORK CALLS
 * Each mounted instance issues `['scoring-thresholds']` — a SHARED key, so N cards make ONE
 * request and share the 5-minute staleTime.
 *
 * (2026-09-17) A second per-card query, `['signal-action', scoreId]`, was REMOVED here. Its key
 * contains the score id, so it made N requests every `SIGNAL_REFRESH_MS`, and its result fed
 * exactly one variable (`botAction`) that no part of this variant renders — bot action state is a
 * card-A feature. It was leftover from the split, and removing it both clears a lint error and
 * deletes a request-per-card-per-minute. Confirmed dead: `botAction` and `execBlocked` each had
 * ONE occurrence in the file (their own assignment). Relevant because the cockpit is the place
 * where mounting many cards would have made N polls expensive.
 *
 * ⚠️ DO NOT wrap this in `<AnimatePresence mode="popLayout">` without adding `forwardRef`.
 * `popLayout` wraps children in a `PopChild` that passes a ref for measurement; a plain function
 * component silently drops it (React logs "Function components cannot be given refs") and the card
 * still renders, so the defect is nearly invisible. The Signals page uses a plain `<AnimatePresence>`,
 * which does NOT pass refs, so no forwarding is needed today. If popLayout is introduced, convert this
 * to `forwardRef` and pass the ref to the root `motion.article` — exactly the fix required for
 * `ScoreCard` on the same date.
 *
 * ⚠️ `.sig-b-row { display: contents }` joins a fixed 3-column grid (label | bar | value). The
 * standing chip MUST stay inside `.sig-b-row-value`; a 4th direct child wraps to a new implicit row
 * and breaks alignment for EVERY row in the list.
 *
 * ⚠️ CSS lives in `signals-overview.css` (prefixes `sig-`, `sig-b-`, `sig-opp-` — file-unique,
 * validated against `src/**\/*.css`), and this component IMPORTS it so it renders styled on any
 * page. `sig-opp-*` classes are shared BETWEEN variants A and B inside that file and must not
 * be split.
 */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { motion, AnimatePresence } from 'motion/react';
import { useQuery, useMutation } from '@tanstack/react-query';
import NoticeBlock from './NoticeBlock';
import { timeAgo } from '../core/format-utils';
import { thresholdGeometry, describeThresholdScale } from '../core/score-display';
import { notice } from '../core/notices/registry';
import { noticeFromError } from '../core/notices/from-error';
import { tradeFailureNotice } from '../core/notices/trade-result';
import {
  dismissSignal,
  tradeSignal,
  createSignalPlan,
  fetchScoringThresholds,
} from '../core/api/signals';
import {
  buildNotices,
  directionLabel,
  roundPct,
  topDirectives,
} from '../core/signal-card-view';
// ⚠️ The component OWNS its stylesheet. Do not remove this as a "page concern".
// All page CSS is bundled globally, but in DEV Vite injects CSS only when a module is
// imported — so a page that mounts SignalCard without having imported
// signals-overview.css itself renders completely unstyled. Vite dedupes the duplicate.
import '../pages/signals-overview.css';

/**
 * SignalCard B — the redesigned signal card.
 * Shares the exact action/trade/plan/dismiss logic of card A but presents a calmer
 * layout: no protocol/bot icons, age top-right, an explicit Combined-strength
 * breakdown, directives removed (moved to another view), and every
 * blocker/warning/conflict rendered through one uniform notice list.
 */
export default function SignalCard({ envelope, dismissHours, onDismissed, defaults }) {
  const [confirming, setConfirming] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [copied, setCopied] = useState(false);

  const copyRef = async () => {
    if (!envelope.scoreId) return;
    try { await navigator.clipboard.writeText(envelope.scoreId); } catch { /* clipboard unavailable */ }
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };

  const marketOpen = envelope.marketStatus ? envelope.marketStatus.open !== false : true;
  const dir = directionLabel(envelope.directionMode);
  const isBuy = envelope.directionMode !== 'SHORT_ONLY'
    && !String(envelope.signal || '').toUpperCase().includes('SELL');

  // Live thresholds — the scale the Signal bar is drawn against.
  //
  // ⚠️ Shared queryKey with card A: only ONE network call is made however many cards
  // render. A failure here must NOT blank the card — `thresholdGeometry()` falls back to
  // the documented defaults and reports `conventional: false`.
  const { data: thresholdData } = useQuery({
    queryKey: ['scoring-thresholds'],
    queryFn: fetchScoringThresholds,
    staleTime: 5 * 60_000,
    retry: 1,
  });
  const scale = thresholdData?.classification ?? null;
  const signalGeometry = thresholdGeometry(envelope.signalPct, scale);
  const scaleTitle = describeThresholdScale(scale);

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
    onSuccess: () => { setResult({ type: 'dismissed', text: `Dismissed for ${dismissHours}h`, notice: notice('TCS-SIG-003', { hours: dismissHours }) }); onDismissed(); },
    onError: (e) => setError(noticeFromError(e, 'TCS-SIG-002')),
  });

  const tradeMutation = useMutation({
    mutationFn: ({ side }) => tradeSignal(envelope.scoreId, { side, brokerId: 'mt5' }),
    onSuccess: (r) => {
      if (r?.success === false) {
        // ⚠️ The server sends a CAUSE-SPECIFIC code and params; use them. Hardcoding
        // TCS-TRADE-005 here discarded them, so a bridge position-cap refusal was rendered
        // with TCS-TRADE-005's action ("Broker refusals carry a retcode …") even though no
        // broker was contacted. See trade-result.js for the full reasoning.
        setError(tradeFailureNotice(r, envelope.symbol));
      } else {
        setResult({ type: 'trade', text: `Order placed #${r?.orderId}`, orderId: r?.orderId, notice: notice('TCS-TRADE-008', { symbol: envelope.symbol, orderId: r?.orderId ?? 'pending' }) });
      }
      setConfirming(false);
    },
    onError: (e) => { setError(noticeFromError(e, 'TCS-TRADE-005', { symbol: envelope.symbol })); setConfirming(false); },
  });

  const planMutation = useMutation({
    mutationFn: () => createSignalPlan(envelope.scoreId, {
      direction: isBuy ? 'LONG' : 'SHORT',
      protocolName: envelope.protocolName || null,
      context: {
        combinedStrength: envelope.combinedStrength,
        signalPct: envelope.signalPct,
        opportunityPct: envelope.opportunityPct,
        confidence: envelope.confidence,
        topDirectives: topDirectives(envelope),
        warnings: envelope.riskGate?.warnings || [],
      },
    }),
    onSuccess: (r) => {
      if (r?.success === false) {
        setError(r.message
          ? notice('TCS-TRADE-007', { symbol: envelope.symbol, detail: r.message })
          : notice('TCS-TRADE-006', { symbol: envelope.symbol }));
      } else { setResult({ type: 'plan', text: 'Plan created', planId: r?.planId, notice: notice('TCS-TRADE-009', { symbol: envelope.symbol }) }); }
    },
    onError: (e) => setError(noticeFromError(e, 'TCS-TRADE-007', { symbol: envelope.symbol })),
  });

  const startConfirm = () => { setError(null); setResult(null); setConfirming(true); };

  const blocked = envelope.preTradeBlockers?.length > 0;
  const execBlockers = envelope.executionBlockers || [];
  const tradeBlockedReason = execBlockers[0]?.message
    ? notice('TCS-RISK-001', { reason: [execBlockers[0].message, execBlockers[0].hint].filter(Boolean).join(' · ') }).message
      + ` [TCS-RISK-001]`
    : !marketOpen
      ? `The market for ${envelope.symbol} is closed, so the trade was blocked. [TCS-TRADE-002]`
      : (blocked ? `${envelope.preTradeBlockers.slice(0, 2).join(' · ')} [TCS-RISK-001]` : null);

  const notices = buildNotices(envelope);
  const signalPct = roundPct(envelope.signalPct);
  const oppPct = roundPct(envelope.opportunityPct);
  const protocolName = envelope.protocolName || envelope.protocolId;
  const strength = Math.min(100, envelope.combinedStrength || 0);

  return (
    <motion.article
      className={`sig-b-card ${blocked ? 'sig-b-card--blocked' : ''}`}
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.96 }}
    >
      {/* ── Title row: symbol · direction · age (top right) ── */}
      <header className="sig-b-head">
        <div className="sig-b-title">
          <span className="sig-b-ticker">{envelope.symbol}</span>
          <span className={`sig-opp-dir sig-opp-dir--${dir.cls}`}>{dir.label}</span>
          {!marketOpen && (
            <span className="sig-opp-closed" title={`Market closed — trade blocked: ${envelope.marketStatus?.reason || 'closed'}`}>
              MARKET CLOSED
            </span>
          )}
        </div>
        <span className="sig-b-age" title={`Scored ${timeAgo(envelope.scoredAt)}`}>{timeAgo(envelope.scoredAt)}</span>
      </header>

      {/* ── Context row: protocol + bot, no icons ── */}
      <div
        className="sig-b-context"
        title={`Protocol (thesis): ${protocolName}${envelope.botName ? ` · Execution bot: ${envelope.botName}` : ''}`}
      >
        <span className="sig-b-proto">{protocolName}</span>
        {envelope.botName && <span className="sig-b-dot" aria-hidden="true">·</span>}
        {envelope.botName && <span className="sig-b-bot">{envelope.botName}</span>}
        {envelope.rarity && <span className="sig-b-rarity">{envelope.rarity}</span>}
      </div>

      {/* ── Strength: combined + metrics — one aligned list (Label | Bar | value) ── */}
      <section className="sig-b-strength">
        <div className="sig-b-bars">
          <div className="sig-b-row sig-b-row--combined" title="Combined strength = the average of Signal and Opportunity, rounded.">
            <span className="sig-b-row-label">Combined strength</span>
            <span className="sig-b-row-track"><span className="sig-b-row-fill" style={{ width: `${strength}%` }} /></span>
            <strong className="sig-b-row-pct sig-b-row-pct--combined">{envelope.combinedStrength}</strong>
          </div>
          <div className="sig-b-row" title={`Signal = directional conviction of this setup. ${scaleTitle}`}>
            <span className="sig-b-row-label">Signal</span>
            <span className="sig-b-row-track">
              {/*
                * ⚠️ Width is the NORMALISED fill (STRONG = 100%), NOT the raw percentage.
                * Raw ~15% at the measured peak used to draw a near-empty bar, which read as
                * "nothing here is worth trading" when the reading was in fact at the top of
                * the achievable range. See `thresholdGeometry()` for the full reasoning.
                */}
              <span
                className="sig-b-row-fill sig-b-row-fill--accent"
                style={{ width: `${signalGeometry.fillPct}%` }}
              />
              {/*
                * ⚠️ CONDITIONAL. `entryMarkPct` is null when the thresholds could not be read,
                * and `left: null%` is not valid CSS — the tick would silently sit at 0.
                * No scale known means NO mark, rather than a mark in the wrong place.
                */}
              {signalGeometry.entryMarkPct != null && (
                <span
                  className="sig-b-row-tick"
                  style={{ left: `${signalGeometry.entryMarkPct}%` }}
                  aria-hidden="true"
                />
              )}
            </span>
            {/*
              * ⚠️ The chip MUST stay INSIDE this wrapper. `.sig-b-row { display: contents }`
              * joins a fixed 3-column grid (label | bar | value), so a 4th direct child wraps
              * to a new implicit row and breaks the alignment of EVERY row in the list.
              * Wrap, don't add a sibling.
              */}
            <span className="sig-b-row-value">
              <strong className="sig-b-row-pct">{signalPct ?? '—'}{signalPct != null ? '%' : ''}</strong>
              {signalGeometry.standing && (
                <span
                  className={`sig-b-row-standing sig-b-row-standing--${signalGeometry.standing}`}
                  title={
                    signalGeometry.standing === 'strong' ? 'At or above the STRONG bar — the top of the achievable scale.'
                      : signalGeometry.standing === 'entry' ? 'At or above the entry bar — a tradable reading.'
                        : 'Below the entry bar — not yet a tradable reading.'
                  }
                >
                  {signalGeometry.standing === 'strong' ? 'STRONG'
                    : signalGeometry.standing === 'entry' ? 'ENTRY'
                      : 'BELOW'}
                </span>
              )}
            </span>
          </div>
          <div className="sig-b-row" title="Opportunity = additive screen value on top of the setup. Measured against ALL directive capacity (including gates), so its scale differs from Signal's — do not compare the two bars directly.">
            <span className="sig-b-row-label">Opportunity</span>
            <span className="sig-b-row-track"><span className="sig-b-row-fill" style={{ width: `${Math.max(0, Math.min(100, oppPct || 0))}%` }} /></span>
            <strong className="sig-b-row-pct">{oppPct ?? '—'}{oppPct != null ? '%' : ''}</strong>
          </div>
          <div className="sig-b-row" title="Confidence = how certain the model is (0–100, not a percentage band)">
            <span className="sig-b-row-label">Confidence</span>
            <span className="sig-b-row-track"><span className="sig-b-row-fill sig-b-row-fill--conf" style={{ width: `${Math.max(0, Math.min(100, envelope.confidence || 0))}%` }} /></span>
            <strong className="sig-b-row-pct">{envelope.confidence ?? '—'}</strong>
          </div>
        </div>
      </section>

      {/* ── Uniform notices (all blockers/warnings/conflicts, one style) ── */}
      {notices.length > 0 && (
        <ul className="sig-b-notices">
          {notices.map((n, i) => (
            // ⚠️ Deliberately COMPACT. This list can hold several notices, so it shows severity,
            // the message and the CODE, and keeps the full why/fix in the tooltip. The code is the
            // part that makes it reportable. A single notice that needs explaining (the feedback
            // slot below) gets the full <NoticeBlock> with Why and Fix written out.
            <li
              key={`${n.code}-${i}`}
              className={`sig-b-notice sig-b-notice--${n.severity}`}
              title={[n.cause, n.action].filter(Boolean).join(' — ')}
            >
              <strong className="sig-b-notice-label">{n.severity === 'critical' || n.severity === 'error' ? 'Blocked' : n.severity === 'warning' ? 'Warning' : 'Note'}</strong>
              <span className="sig-b-notice-text">{n.message}</span>
              <code className="sig-b-notice-code">{n.code}</code>
            </li>
          ))}
        </ul>
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
              : `Confirm ${isBuy ? 'buy' : 'sell'} ${envelope.symbol} on MT5 · ${defaults?.size ?? 0.01} lots · SL ${defaults?.slPct ?? 2}% · TP ${defaults?.tpPct ?? 4}%`}
          </button>
        ) : (
          <button
            type="button"
            className={`sig-opp-btn ${isBuy ? 'sig-opp-btn--buy' : 'sig-opp-btn--sell'}`}
            onClick={startConfirm}
            disabled={!envelope.scoreId || Boolean(tradeBlockedReason)}
            title={
              tradeBlockedReason
                ? `Blocked: ${tradeBlockedReason}`
                : !envelope.scoreId
                  ? 'No persisted score to trade against'
                  : `Open ${isBuy ? 'long' : 'short'} CFD on MT5`
            }
          >
            {isBuy ? 'Buy (Long)' : 'Sell (Short)'}
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

      {envelope.scoreId && (
        <button type="button" className="sig-b-ref" onClick={copyRef} title={`Signal ref ${envelope.scoreId} — click to copy`}>
          {copied ? '✓ ref copied' : `⧉ ref ${envelope.scoreId.slice(-8)}`}
        </button>
      )}

      <AnimatePresence>
        {(result || error) && (
          <motion.div
            className="sig-opp-feedback"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            {/* #826 Phase 2 — the registry notice IS the message: title, code, why and the fix.
                It replaced a bare server string, which is why a failure used to arrive with
                nothing to act on. */}
            <NoticeBlock notice={error || result?.notice} compact />
            {!error && result?.type === 'plan' && (
              <span className="sig-opp-feedback-link">
                <Link to="/trading/trading-plans">Open in Trading Plans</Link>
              </span>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </motion.article>
  );
}
