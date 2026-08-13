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
import { signalTone, directionModeLabel, signalArrow } from '../core/signal-utils';

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

  // Composite strength: score as % of the summed directive max scores.
  const totalMax = useMemo(
    () => Object.values(subMaxTotals).reduce((sum, v) => sum + (Number(v) || 0), 0),
    [subMaxTotals],
  );
  const score = Number(data?.score ?? 0);
  const strengthPct = totalMax > 0 ? Math.round((score / totalMax) * 100) : null;

  /** Format an ISO timestamp as a readable date + time (UTC). */
  function formatTimestamp(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    const date = d.toISOString().slice(0, 10);
    const time = d.toISOString().slice(11, 19);
    return `${date} ${time} UTC`;
  }

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
              <div className="pt-summary-score">
                {data.score != null ? score.toLocaleString() : '—'}
                {totalMax > 0 && (
                  <span className="pt-summary-score-max">/{totalMax.toLocaleString()}</span>
                )}
              </div>
              <div className="pt-summary-tags">
                <span className={`pt-signal pt-signal--${signalTone(signal)}`}>
                  <span className="pt-signal-arrow" aria-hidden="true">{signalArrow(signal)}</span>
                  {signal}
                </span>
                {directionLabel && <span className="pt-badge pt-badge--neutral">{directionLabel}</span>}
              </div>
            </div>

            {strengthPct != null && (
              <div className="pt-strength">
                <div className="pt-strength-track">
                  <div
                    className={`pt-strength-fill pt-strength-fill--${signalTone(signal)}`}
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
