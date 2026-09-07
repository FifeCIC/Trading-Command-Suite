/**
 * Protocol Trail — Directive Breakdown (HISTORY VIEWER)
 * ======================================================
 * Shows WHY a symbol scored its protocol score. Displays the directive-level
 * breakdown: every directive in the protocol, its score, and the reason
 * (market data that led to the score).
 *
 * This page is a HISTORY VIEWER — it does NOT auto-refresh. It shows a fixed
 * scoring run, deep-linked from Symbols Ladder via
 *   ?symbol=XAUUSD&protocol=xau-speed-v1&runId=<Score table UUID>
 * The runId locks the view to one historical moment. For a live-updating view
 * of a single symbol + protocol, see SinglesMonitorPage.
 */

import { useState, useMemo } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { motion } from 'motion/react';
import { apiGet } from '../core/api/client';
import LoadingSkeleton from '../components/LoadingSkeleton';
import './decision-trail.css';
import PageInfoPopover from '../components/PageInfoPopover';
import { directionModeLabel } from '../core/signal-utils';
import { buildScoreDisplay } from '../core/score-display';
import SignalBadge from '../components/SignalBadge';
import { formatTimestamp } from '../core/format-utils';

const GROUP_LABELS = {
  technical: 'Technical',
  sentiment: 'Sentiment',
  risk: 'Risk',
};

export default function ProtocolTrailPage() {
  const [searchParams] = useSearchParams();
  const symbol = searchParams.get('symbol') || '';
  const protocol = searchParams.get('protocol') || '';
  const urlRunId = searchParams.get('runId') || '';

  // ── Fetch directive breakdown (single fetch — no auto-refresh) ──
  const breakdownQuery = useQuery({
    queryKey: ['score-breakdown', symbol, protocol, urlRunId],
    queryFn: async () => {
      if (!symbol) return null;
      const params = new URLSearchParams();
      if (protocol) params.set('protocol', protocol);
      if (urlRunId) params.set('runId', urlRunId);
      const qs = params.toString();
      return apiGet(`/api/scoring/breakdown/${encodeURIComponent(symbol)}${qs ? `?${qs}` : ''}`).catch(() => null);
    },
    enabled: !!symbol,
  });

  const data = breakdownQuery.data;
  const isLoading = breakdownQuery.isLoading && !breakdownQuery.data;

  const breakouts = data?.breakdown?.breakouts ?? {};
  const subScores = data?.breakdown?.subScores ?? {};
  const subMaxTotals = data?.breakdown?.subMaxTotals ?? {};
  const signal = data?.breakdown?.signal ?? '—';
  const directionMode = data?.breakdown?.directionMode ?? '';
  const directionLabel = directionModeLabel(directionMode);
  const runId = data?.runId ?? null;
  const scoredAt = data?.timestamp ?? null;
  // Phase C dual-score model: Signal (directional) vs Opportunity (additive).
  const rawComposite = data?.breakdown?.rawComposite ?? null;
  const rawMax = data?.breakdown?.rawMax ?? null;
  const opportunityScore = data?.breakdown?.opportunityScore ?? null;
  const opportunityMax = data?.breakdown?.opportunityMax ?? null;

  // Output layer: one view model decides signal/tone/state/pct.
  const vm = buildScoreDisplay({
    signal,
    value: data?.score ?? null,
    rawComposite,
    rawMax,
    opportunityScore,
    opportunityMax,
    marketStatus: data?.breakdown?.marketStatus ?? null,
  });

  // Composite strength: signal (directional) as % of its own denominator.
  // Legacy rows without a stored rawMax fall back to the summed group max.
  const totalMax = useMemo(
    () => Object.values(subMaxTotals).reduce((sum, v) => sum + (Number(v) || 0), 0),
    [subMaxTotals],
  );
  const signalMax = vm.scoreMax ?? totalMax;
  const strengthPct = signalMax > 0 ? Math.round(((vm.score ?? 0) / signalMax) * 100) : null;

  // Flatten all directive breakouts across groups
  const allDirectives = useMemo(() => {
    const list = [];
    for (const [groupId, dirs] of Object.entries(breakouts)) {
      for (const d of dirs) {
        list.push({ ...d, groupId });
      }
    }
    return list;
  }, [breakouts]);

  // ── Pipeline stage tracker (#583 Phase 2) ──
  // One strip of stages showing how this score was reached, colour-coded
  // pass (green) / warn (amber) / block (red) / idle (muted).
  const stages = useMemo(() => {
    const market = data?.breakdown?.marketStatus;
    const readiness = data?.breakdown?.readinessGate;
    const riskMult = typeof data?.breakdown?.riskMultiplier === 'number'
      ? data?.breakdown?.riskMultiplier
      : null;
    const hardGated = rawComposite != null && rawComposite > 0 && (data?.score ?? 0) === 0;
    const fired = allDirectives.length;
    const groupCount = Object.keys(breakouts).length;

    const riskTone = hardGated ? 'block'
      : riskMult == null ? 'idle'
      : riskMult < 0.3 ? 'block'
      : riskMult < 0.7 ? 'warn'
      : 'pass';

    return [
      { key: 'market', label: 'Market', value: market?.open === false ? 'closed' : market?.open ? 'open' : '—', tone: market?.open === false ? 'block' : market?.open ? 'pass' : 'idle', detail: market?.reason || '' },
      { key: 'directives', label: 'Directives', value: `${fired} fired`, tone: fired > 0 ? 'pass' : 'block', detail: `${fired} of the protocol's directives produced a result` },
      { key: 'groups', label: 'Groups', value: `${groupCount} groups`, tone: groupCount > 0 ? 'pass' : 'block', detail: Object.keys(subScores).map((g) => `${GROUP_LABELS[g] || g} ${subScores[g]}`).join(' · ') },
      { key: 'risk', label: 'Risk gate', value: riskMult != null ? `${Math.round(riskMult * 100)}%` : '—', tone: riskTone, detail: hardGated ? 'Hard gate forced composite to 0' : `Risk multiplier ${riskMult != null ? Math.round(riskMult * 100) + '%' : 'not applied'}` },
      { key: 'readiness', label: 'Readiness', value: readiness?.ready === false ? 'blocked' : readiness ? 'ready' : '—', tone: readiness?.ready === false ? 'block' : readiness ? 'pass' : 'idle', detail: readiness?.reason || '' },
      { key: 'classify', label: 'Classify', value: signal, tone: signal === 'HOLD' ? 'warn' : 'pass', detail: strengthPct != null ? `${strengthPct}% signal strength` : '' },
    ];
  }, [data, rawComposite, allDirectives, breakouts, subScores, signal, strengthPct]);

  return (
    <div className="dt-page">
      <header className="dt-header">
        <div>
          <h1>Protocol Trail
          <PageInfoPopover>
            Directive-level breakdown of a symbol's protocol score. Every directive in the protocol, its score, and the market data that produced it. Deep-linked from Symbols Ladder.
          </PageInfoPopover>
          </h1>
        </div>
      </header>

      {!symbol ? (
        <div className="dt-empty">
          <p>No symbol selected.</p>
          <p className="dt-empty-hint">Click a score on the Symbols Ladder to see its directive breakdown here.</p>
        </div>
      ) : isLoading ? (
        <LoadingSkeleton variant="card" count={4} />
      ) : !data ? (
        <div className="dt-empty">
          <p>No breakdown found for {symbol}{protocol ? ` in ${protocol}` : ''}.</p>
          <p className="dt-empty-hint">A breakdown appears after the protocol scores this symbol. Each directive's score and reason are recorded at scoring time.</p>
        </div>
      ) : (
        <>
          {/* Score summary hero card */}
          <div className="pt-summary">
            <div className="pt-summary-main">
              <div className="pt-summary-id">
                <span className="pt-summary-symbol">{data.ticker || symbol}</span>
                {data.strategyId && <span className="pt-summary-protocol">{data.strategyId}</span>}
              </div>
              <div className="pt-summary-stats">
                <div className="pt-summary-stat">
                  <span className="pt-summary-label" tabIndex={0}>
                    Signal
                    <span className="pt-pop" role="tooltip">Signal — directional conviction (which way, how strongly). Drives BUY/HOLD/SELL.</span>
                  </span>
                  <span className="pt-summary-score">
                    {vm.score != null ? vm.score.toLocaleString() : '—'}
                    {signalMax > 0 && (
                      <span className="pt-summary-score-max">/{signalMax.toLocaleString()}</span>
                    )}
                  </span>
                </div>
                {opportunityScore != null && opportunityMax != null && (
                  <div className="pt-summary-stat">
                    <span className="pt-summary-label" tabIndex={0}>
                      Opportunity
                      <span className="pt-pop" role="tooltip">Opportunity — additive 'everything counts' score (direction + conditions + forecasts). Used for ranking/screening across symbols.</span>
                    </span>
                    <span className="pt-summary-score">
                      {opportunityScore.toLocaleString()}<span className="pt-summary-score-max">/{opportunityMax.toLocaleString()}</span>
                    </span>
                  </div>
                )}
              </div>
              <div className="pt-summary-tags">
                <SignalBadge display={vm} />
                {directionLabel && <span className="pt-badge pt-badge--neutral">{directionLabel}</span>}
              </div>
            </div>

            {strengthPct != null && (
              <div className="pt-strength">
                <div className="pt-strength-track">
                  <div
                    className={`pt-strength-fill pt-strength-fill--${vm.frozen ? 'neutral' : vm.tone}`}
                    style={{ width: `${Math.max(2, Math.min(100, strengthPct))}%` }}
                  />
                </div>
                <span className="pt-strength-label">{strengthPct}% signal strength</span>
              </div>
            )}

            <div className="pt-meta">
              {scoredAt && (
                <span className="pt-meta-item">
                  <span className="pt-meta-label">Scored</span> {formatTimestamp(scoredAt)}
                </span>
              )}
              {runId && (
                <span className="pt-meta-item">
                  <span className="pt-meta-label">Run ID</span> <code>{runId}</code>
                </span>
              )}
            </div>
          </div>

          {/* Pipeline stage tracker (#583 Phase 2) */}
          <div className="pt-pipeline">
            {stages.map((st) => (
              <div key={st.key} className={`pt-stage pt-stage--${st.tone}`} title={st.detail}>
                <span className="pt-stage-icon">{st.tone === 'pass' ? '✓' : st.tone === 'block' ? '⛔' : st.tone === 'warn' ? '△' : '○'}</span>
                <span className="pt-stage-label">{st.label}</span>
                <span className="pt-stage-value">{st.value}</span>
              </div>
            ))}
          </div>

          {/* Group sections */}
          {Object.entries(breakouts).map(([groupId, dirs]) => (
            <div key={groupId} className="pt-group">
              <div className="pt-group-header">
                <span className="pt-group-title">{GROUP_LABELS[groupId] || groupId}</span>
                {subMaxTotals[groupId] != null && (
                  <span className="pt-group-subscore">
                    {subScores[groupId] ?? 0} / {subMaxTotals[groupId]}
                  </span>
                )}
              </div>
              <div className="pt-directive-list">
                {dirs.map((d, i) => (
                  <motion.div
                    key={d.directiveId}
                    className="pt-directive-row"
                    initial={{ opacity: 0, y: 3 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: i * 0.02 }}
                  >
                    <div className="pt-directive-head">
                      <Link
                        to={`/protocols/directive-viewer?id=${encodeURIComponent(d.directiveId)}`}
                        className="pt-directive-name pt-directive-link"
                        title={`View ${d.name || d.directiveId} in the Directive Viewer`}
                      >
                        {d.name || d.directiveId}
                      </Link>
                      <span className="pt-directive-score">
                        {d.score} / {d.maxScore}
                      </span>
                    </div>
                    <div className="pt-directive-reason">{d.reason || '—'}</div>
                    {!d.inSignal && (
                      <span
                        className="pt-directive-excluded"
                        title="Condition/gate — contributes to the Opportunity score, not the directional Signal."
                      >
                        condition
                      </span>
                    )}
                  </motion.div>
                ))}
              </div>
            </div>
          ))}
        </>
      )}
    </div>
  );
}
