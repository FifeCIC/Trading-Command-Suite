/**
 * Singles Monitor — Live Single Symbol + Protocol Directive Breakdown
 * ===================================================================
 * A live, auto-refreshing view of ONE symbol scored by ONE protocol.
 *
 * PURPOSE: Focus on a single symbol/protocol pair in near-real-time. This is
 * the live counterpart to ProtocolTrailPage, which is a fixed history viewer.
 *
 * Deep-links via ?symbol=XAUUSD&protocol=xau-speed-v1 (same params as
 * ProtocolTrail). Refreshes in sync with the automation loop tick, with a
 * countdown indicator in the top row.
 *
 * META.Stack position: reads protocol-gated scores from the Score table
 * (via /api/scoring/breakdown) — it does NOT trigger scoring itself.
 */

import { useState, useMemo, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { keepPreviousData } from '@tanstack/react-query';
import { motion } from 'motion/react';
import { apiGet } from '../core/api/client';
import LoadingSkeleton from '../components/LoadingSkeleton';
import { TopRowSlotContent } from '../core/top-row-slot';
import PageInfoPopover from '../components/PageInfoPopover';
import { signalTone, directionModeLabel, signalArrow } from '../core/signal-utils';
import './decision-trail.css';

const GROUP_LABELS = {
  technical: 'Technical',
  sentiment: 'Sentiment',
  risk: 'Risk',
};

/** Seconds to wait after the automation loop tick before refreshing. */
const REFRESH_AFTER_TICK_MS = 2000;

export default function SinglesMonitorPage() {
  const [searchParams] = useSearchParams();
  const symbol = searchParams.get('symbol') || '';
  const protocol = searchParams.get('protocol') || '';
  const [countdown, setCountdown] = useState(null);

  // Automation status — syncs the refresh with the loop tick.
  const { data: automation } = useQuery({
    queryKey: ['sm-automation'],
    queryFn: () => apiGet('/api/automation/status').catch(() => null),
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
  const nextTickAt = automation?.nextTickAt;

  // Countdown to next loop tick — ticks every second.
  useEffect(() => {
    if (!nextTickAt) { setCountdown(null); return; }
    const tick = () => {
      const remain = new Date(nextTickAt).getTime() - Date.now();
      setCountdown(remain > 0 ? Math.ceil(remain / 1000) : 0);
    };
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [nextTickAt]);

  // ── Live directive breakdown — auto-refreshes in sync with the loop ──
  const breakdownQuery = useQuery({
    queryKey: ['singles-monitor', symbol, protocol],
    queryFn: async () => {
      if (!symbol) return null;
      const params = new URLSearchParams();
      if (protocol) params.set('protocol', protocol);
      const qs = params.toString();
      return apiGet(`/api/scoring/breakdown/${encodeURIComponent(symbol)}${qs ? `?${qs}` : ''}`).catch(() => null);
    },
    enabled: !!symbol,
    staleTime: 10_000,
    refetchInterval: () => {
      if (nextTickAt) {
        const delay = new Date(nextTickAt).getTime() - Date.now() + REFRESH_AFTER_TICK_MS;
        return Math.max(5000, delay);
      }
      return 30_000;
    },
    placeholderData: keepPreviousData,
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

  return (
    <div className="dt-page">
      {countdown != null && (
        <TopRowSlotContent>
          <span className="pl-refresh" title="Time until the next automation loop tick and refresh">
            ⟳ {countdown > 0 ? `${countdown}s` : 'refreshing…'}
          </span>
        </TopRowSlotContent>
      )}

      <header className="dt-header">
        <div>
          <h1>Singles Monitor
          <PageInfoPopover>
            Live directive-level breakdown of a single symbol scored by a single protocol. Refreshes in sync with the automation loop. Use Protocol Trail for fixed historical runs.
          </PageInfoPopover>
          </h1>
        </div>
      </header>

      {!symbol ? (
        <div className="dt-empty">
          <p>No symbol selected.</p>
          <p className="dt-empty-hint">Open via ?symbol=XAUUSD&protocol=xau-speed-v1 to monitor a single symbol/protocol pair live.</p>
        </div>
      ) : isLoading ? (
        <LoadingSkeleton variant="card" count={4} />
      ) : !data ? (
        <div className="dt-empty">
          <p>No breakdown found for {symbol}{protocol ? ` in ${protocol}` : ''}.</p>
          <p className="dt-empty-hint">A breakdown appears after the protocol scores this symbol. It will auto-refresh on each loop tick.</p>
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
                      <span className="pt-directive-name">{d.name || d.directiveId}</span>
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
