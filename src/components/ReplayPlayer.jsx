/**
 * ReplayPlayer — play a backtest run forward and WATCH it trade (#819).
 * ===================================================================
 *
 * Position in the pipeline: the last surface of the backtest path.
 *   POST /api/backtest/run            → the run happens and is persisted
 *   GET  /api/backtest/results/:id    → the run's metrics + trades (report-shaped)
 *   GET  /api/backtest/replay/:id     → THE SAME RUN, ordered as events + the bars it traded on
 *   → this component plays it
 *
 * ⚠️ WHY IT IS NOT A NEW ROUTE. Sprint #965 item 5 says surfaces are #819 then #606 — a fourth
 * surface is the churn that sprint explicitly forbids. So this mounts inside the existing
 * backtest page, next to the run it replays.
 *
 * ⚠️ THE THREE THINGS IT MUST NOT DO, all of which are the "plausible output, no error" class:
 *   1. draw a trade marker at midnight when the run's timestamps are date-only (the backend
 *      detects that and sends a caveat; this renders the caveat and refuses the timeline);
 *   2. count an OPEN trade as a result (src/core/replay-clock.js owns that rule and is tested);
 *   3. show "not recorded" as a blank or a zero — SL/TP are not persisted per trade, and the
 *      caveats say so in words.
 */

import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiGet } from '../core/api/client';
import NoticeBlock from './NoticeBlock';
import { noticeFromError } from '../core/notices/from-error.js';
import {
  REPLAY_SPEEDS,
  buildReplayEvents,
  summarise,
  visibleRows,
  filterTrades,
  stepMsFor,
} from '../core/replay-clock';
import './replay-player.css';

const pct = (v) => (v === null || v === undefined ? '—' : `${v}%`);
const money = (v) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return '—';
  const sign = n > 0 ? '+' : '';
  return `${sign}${n.toFixed(2)}`;
};

/** Index of the first bar at/after an instant, for marker placement. */
function barIndexFor(bars, iso) {
  const t = Date.parse(iso);
  if (!Number.isFinite(t) || bars.length === 0) return null;
  let lo = 0;
  let hi = bars.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (Date.parse(bars[mid].time) < t) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

export default function ReplayPlayer({ runId }) {
  const [cursor, setCursor] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(10);
  const [direction, setDirection] = useState('');
  const [signal, setSignal] = useState('');
  const [exitReason, setExitReason] = useState('');

  const replayQuery = useQuery({
    queryKey: ['backtest-replay', runId],
    queryFn: () => apiGet(`/api/backtest/replay/${runId}`),
    enabled: Boolean(runId),
  });
  const replay = replayQuery.data;

  const trades = useMemo(
    () => filterTrades(replay?.trades ?? [], { direction, signal, exitReason }),
    [replay, direction, signal, exitReason],
  );
  const built = useMemo(() => buildReplayEvents(trades), [trades]);
  const summary = summarise(built, cursor);
  const rows = visibleRows({ trades }, cursor);
  const total = built.events.length;
  const atEnd = cursor >= total;

  // A filter or run change restarts the replay: playing a filtered list from a mid-point would
  // show a sequence the run never had.
  useEffect(() => {
    setCursor(0);
    setPlaying(false);
  }, [runId, direction, signal, exitReason]);

  // The clock. `instant` reveals everything without scheduling a timer.
  useEffect(() => {
    if (!playing) return undefined;
    const ms = stepMsFor(speed);
    if (ms === 0) {
      setCursor(total);
      setPlaying(false);
      return undefined;
    }
    const id = setTimeout(() => setCursor((c) => Math.min(c + 1, total)), ms);
    return () => clearTimeout(id);
  }, [playing, cursor, speed, total]);

  if (!runId) return null;

  if (replayQuery.isLoading) {
    return <div className="rp-panel rp-hint">Loading the run…</div>;
  }
  if (replayQuery.error) {
    return (
      <section className="rp-panel" aria-label="Backtest replay">
        <NoticeBlock notice={noticeFromError(replayQuery.error, 'TCS-SYS-002')} />
        <p className="rp-hint">
          A failed load is not an empty run — nothing below has been measured.
        </p>
      </section>
    );
  }
  if (!replay) {
    return (
      <div className="rp-panel">
        <p className="rp-hint">
          This run could not be loaded. It may have been pruned by retention.
        </p>
      </div>
    );
  }

  const { run, bars, caveats } = replay;
  const midnight = caveats.some((c) => c.includes('00:00:00'));
  const firstBar = bars[0] ? Date.parse(bars[0].time) : null;
  const lastBar = bars.length ? Date.parse(bars[bars.length - 1].time) : null;
  const span = firstBar !== null && lastBar !== null && lastBar > firstBar ? lastBar - firstBar : 0;
  const closes = bars.map((b) => b.close);
  const minClose = closes.length ? Math.min(...closes) : 0;
  const maxClose = closes.length ? Math.max(...closes) : 0;
  const range = maxClose - minClose || 1;
  const x = (i) => (bars.length <= 1 ? 0 : (i / (bars.length - 1)) * 100);
  const y = (c) => 100 - ((c - minClose) / range) * 100;
  const revealed = built.events.slice(0, cursor);
  // #R14 — the most recent trade that HAS levels: its stop/target get drawn as guide lines, which
  // is how a reader of any charting package expects to see them. Old runs have no levels, so this
  // is simply absent rather than drawn at zero.
  const lastWithLevels = [...revealed]
    .reverse()
    .find((e) => e.kind === 'entry' && e.trade.stopLoss !== null && e.trade.stopLoss !== undefined);

  return (
    <section className="rp-panel" aria-label="Backtest replay">
      <header className="rp-head">
        <div>
          <h3 className="rp-title">
            Replay — {run.symbol} {run.timeframe} · {run.protocolId}
          </h3>
          <p className="rp-sub">
            {run.from.slice(0, 16).replace('T', ' ')} → {run.to.slice(0, 16).replace('T', ' ')} UTC ·{' '}
            {run.tradesStored} trades stored
            {run.totalSignals !== null && run.totalSignals !== undefined
              ? ` · ${run.totalSignals} signals`
              : ' · signal count not recorded for this run'}
          </p>
        </div>
        <div className="rp-transport">
          <button type="button" className="rp-btn" onClick={() => setPlaying((p) => !p)} disabled={atEnd}>
            {playing ? '❚❚ Pause' : '▶ Play'}
          </button>
          <button
            type="button"
            className="rp-btn"
            onClick={() => {
              setPlaying(false);
              setCursor((c) => Math.min(c + 1, total));
            }}
            disabled={atEnd}
          >
            ⏭ Step
          </button>
          <button
            type="button"
            className="rp-btn"
            onClick={() => {
              setPlaying(false);
              setCursor(0);
            }}
          >
            ↺ Reset
          </button>
          <label className="rp-speed">
            Speed
            <select
              value={String(speed)}
              onChange={(e) => setSpeed(e.target.value === 'instant' ? 'instant' : Number(e.target.value))}
            >
              {REPLAY_SPEEDS.map((s) => (
                <option key={String(s)} value={String(s)}>
                  {s === 'instant' ? 'instant' : `${s}×`}
                </option>
              ))}
            </select>
          </label>
          <span className="rp-progress">
            event {cursor} / {total}
          </span>
        </div>
      </header>

      <div className="rp-filters">
        <label>
          Direction
          <select value={direction} onChange={(e) => setDirection(e.target.value)}>
            <option value="">all</option>
            <option value="LONG">LONG</option>
            <option value="SHORT">SHORT</option>
          </select>
        </label>
        <label>
          Signal
          <select value={signal} onChange={(e) => setSignal(e.target.value)}>
            <option value="">all</option>
            {[...new Set((replay.trades ?? []).map((t) => t.signal))].filter(Boolean).map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        <label>
          Exit
          <select value={exitReason} onChange={(e) => setExitReason(e.target.value)}>
            <option value="">all</option>
            {[...new Set((replay.trades ?? []).map((t) => t.exitReason))].filter(Boolean).map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        <span className="rp-hint">
          {trades.length} of {run.tradesStored} trades · rows appear as the replay reaches them
        </span>
      </div>

      {/* Running summary — the numbers move AS IT PLAYS, and an open trade is not a result. */}
      <div className="rp-summary">
        <span>
          <strong>{summary.taken}</strong> taken
        </span>
        <span>
          <strong>{summary.open}</strong> open
        </span>
        <span>
          <strong>{summary.closed}</strong> closed
        </span>
        <span>
          <strong>{summary.wins}</strong>W / <strong>{summary.losses}</strong>L
          {summary.flat > 0 ? ` / ${summary.flat} flat` : ''}
        </span>
        <span>
          win rate <strong>{pct(summary.winRatePct)}</strong>
        </span>
        <span>
          realised <strong>{money(summary.realisedPnl)}</strong>
        </span>
        {summary.unusable > 0 && <span className="rp-warn">{summary.unusable} unusable timestamps</span>}
      </div>

      {midnight ? (
        <p className="rp-error">
          This run's trades are all stamped 00:00:00, so their markers cannot be placed on a
          timeline. Re-run it — a run made after the #819 timestamp fix replays with real times.
        </p>
      ) : bars.length === 0 ? (
        <p className="rp-error">
          No {run.timeframe} bars are stored for this window, so there is no price timeline. The
          trade rows below are still real.
        </p>
      ) : (
        <div className="rp-timeline">
          <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="rp-svg" role="img"
               aria-label={`Price series with ${revealed.length} revealed trade events`}>
            <polyline
              className="rp-price"
              points={bars.map((b, i) => `${x(i)},${y(b.close)}`).join(' ')}
            />
            {lastWithLevels && (
              <>
                <line className="rp-level rp-level-sl" x1="0" x2="100"
                      y1={y(lastWithLevels.trade.stopLoss)} y2={y(lastWithLevels.trade.stopLoss)} />
                {lastWithLevels.trade.takeProfit !== null && lastWithLevels.trade.takeProfit !== undefined && (
                  <line className="rp-level rp-level-tp" x1="0" x2="100"
                        y1={y(lastWithLevels.trade.takeProfit)} y2={y(lastWithLevels.trade.takeProfit)} />
                )}
              </>
            )}
            {revealed.map((e, i) => {
              const bi = barIndexFor(bars, e.kind === 'entry' ? e.trade.entryTime : e.trade.exitTime);
              if (bi === null) return null;
              const px = x(bi);
              const py = y(e.kind === 'entry' ? e.trade.entryPrice : e.trade.exitPrice);
              return (
                <circle
                  key={`${e.trade.id}-${e.kind}-${i}`}
                  className={e.kind === 'entry' ? 'rp-mark-entry' : 'rp-mark-exit'}
                  cx={px}
                  cy={py}
                  r="1.1"
                />
              );
            })}
          </svg>
          <div className="rp-axis">
            <span>{bars[0]?.time.slice(0, 16).replace('T', ' ')}</span>
            <span>{span ? `${bars.length} bars` : ''}</span>
            <span>{bars[bars.length - 1]?.time.slice(0, 16).replace('T', ' ')}</span>
          </div>
          <p className="rp-hint">
            ● entry ● exit · markers are placed at the bar whose time the trade recorded — the run's
            own timestamps, not a re-scored approximation.
          </p>
        </div>
      )}

      <div className="rp-table-wrap">
        <table className="rp-table">
          <thead>
            <tr>
              <th>Entry (UTC)</th>
              <th>Dir</th>
              <th>Score</th>
              <th>Signal</th>
              <th>Entry</th>
              <th>SL</th>
              <th>TP</th>
              <th>Exit</th>
              <th>Exit</th>
              <th>Size</th>
              <th>P&amp;L</th>
              <th>%</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={12} className="rp-hint">
                  {total === 0
                    ? 'No trade events to replay for this filter.'
                    : 'Press Play (or Step) to reveal the run.'}
                </td>
              </tr>
            ) : (
              rows.map(({ trade, exited }) => (
                <tr key={trade.id} className={exited ? '' : 'rp-row-open'}>
                  <td className="rp-mono">{trade.entryTime.slice(0, 16).replace('T', ' ')}</td>
                  <td>{trade.direction}</td>
                  <td className="rp-mono">{trade.entryScore === null ? '—' : trade.entryScore}</td>
                  <td>{trade.signal}</td>
                  <td className="rp-mono">{trade.entryPrice}</td>
                  <td className="rp-mono">
                    {trade.stopLoss === null || trade.stopLoss === undefined ? '—' : trade.stopLoss}
                  </td>
                  <td className="rp-mono">
                    {trade.takeProfit === null || trade.takeProfit === undefined ? '—' : trade.takeProfit}
                  </td>
                  <td className="rp-mono">{exited ? trade.exitPrice : '—'}</td>
                  <td>
                    {exited ? (
                      trade.exitReason
                    ) : (
                      <span className="rp-open-chip" title="Entry taken; exit not yet reached in the replay">
                        OPEN
                      </span>
                    )}
                  </td>
                  <td className="rp-mono">{trade.positionSize ?? '—'}</td>
                  <td className={`rp-mono ${exited && trade.pnl > 0 ? 'rp-up' : exited && trade.pnl < 0 ? 'rp-down' : ''}`}>
                    {exited ? money(trade.pnl) : '—'}
                  </td>
                  <td className="rp-mono">{exited ? trade.pnlPct : '—'}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {caveats.length > 0 && (
        <details className="rp-caveats" open>
          <summary>What this run cannot show ({caveats.length})</summary>
          <ul>
            {caveats.map((c, i) => (
              <li key={i}>{c}</li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
