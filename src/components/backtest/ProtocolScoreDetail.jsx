import { useEffect, useMemo, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { apiPost } from '../../core/api/client';
import NoticeBlock from '../NoticeBlock';
import { noticeFromError } from '../../core/notices/from-error.js';
import SignalBadge from '../SignalBadge';
import PageInfoPopover from '../PageInfoPopover';
import { buildScoreDisplay } from '../../core/score-display';
import '../../pages/backtest-lab.css';

/**
 * ProtocolScoreDetail — the SCORE-DETAIL half of the Backtest Lab (#1134).
 *
 * ⚠️ WHY THIS IS A COMPONENT AND NOT PART OF THE PAGE. The 2026-10-16 Stage 3 approval in #823
 * required that the score surface be self-contained, so a *focused* view later is a new route
 * rendering this component rather than a copy of it. Everything it needs arrives as props; it owns
 * its own query, sort and selection state.
 *
 * ⚠️ WHAT IT MEASURES, AND WHAT IT DOES NOT. This calls `POST /api/replay/run`, which RE-SCORES
 * stored bars with the engine as it is today. It reads none of the scores the app stored at the
 * time. That is what makes it a useful explanation of a window — and it is why the result is NOT a
 * measurement to compare: it is not stored, it has no `periodId`, and two of them cannot be diffed
 * by `runs/compare`. The stored, comparable measurement is the Backtest Lab run above it.
 *
 * ⚠️ Runs the SAME canonical scorer as the live loop (`ProtocolGatingService.scoreWithGating`,
 * guarded by `validate-single-scoring-path.cjs`) — this is not a second scoring path.
 */

/** Bars the replay engine needs before it will score a single window. Sent as `windowSize`. */
const WINDOW_SIZE = 30;

const isSignal = (signal) =>
  signal === 'BUY' || signal === 'STRONG_BUY' || signal === 'SELL' || signal === 'STRONG_SELL';

// Strongest bearish → strongest bullish; NO_DATA sorts last (null).
const SIGNAL_SORT_ORDER = {
  STRONG_SELL: 0,
  SELL: 1,
  HOLD: 2,
  BUY: 3,
  STRONG_BUY: 4,
};

const sortNumber = (value) => {
  if (value == null) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

const RESULT_SORT_FIELDS = {
  signal: {
    label: 'Signal',
    get: (step) => (step.signal == null || step.signal === 'NO_DATA'
      ? null
      : SIGNAL_SORT_ORDER[step.signal] ?? null),
    firstDir: 'asc',
  },
  score: { label: 'Score', get: (step) => sortNumber(step.signalRaw), firstDir: 'desc' },
  percent: {
    label: '%',
    ariaLabel: 'percentage',
    get: (step) => sortNumber(step.normalizedScore),
    firstDir: 'desc',
  },
  opportunity: {
    label: 'Opportunity',
    get: (step) => sortNumber(step.opportunityPct),
    firstDir: 'desc',
  },
  correct: {
    label: 'Correct',
    get: (step) => (step.signalCorrect === undefined ? null : Number(Boolean(step.signalCorrect))),
    firstDir: 'desc',
  },
};

const EMPTY_STEPS = Object.freeze([]);

const fmtTime = (ts) => {
  const d = new Date(ts);
  return Number.isNaN(d.getTime()) ? '—' : d.toISOString().slice(0, 16).replace('T', ' ');
};

const n1 = (v) => (typeof v === 'number' ? v.toFixed(2) : '—');

export default function ProtocolScoreDetail({
  protocolId,
  protocolName,
  symbol,
  timeframe,
  periodId,
  /** Why the drill-down is unavailable, or null when it is available. */
  blockedReason,
}) {
  const [selectedIdx, setSelectedIdx] = useState(null);
  const [sort, setSort] = useState({ key: null, dir: 'asc' });
  const [elapsed, setElapsed] = useState(0);
  // A replay result belongs to the subject AND window that produced it. Keeping the key lets the
  // component say "this is stale" rather than silently rendering the previous window's table
  // against a new selection — the "plausible output, wrong input" class this repo keeps finding.
  const [resultKey, setResultKey] = useState('');

  const key = `${protocolId}|${periodId || `${symbol}|${timeframe}`}`;

  const replayMutation = useMutation({
    mutationFn: (config) => apiPost('/api/replay/run', config),
    onSuccess: (data, config) => {
      setSelectedIdx(null);
      setResultKey(`${config.protocolIds?.[0]}|${config.periodId || `${config.symbol}|${config.timeframe}`}`);
      return data;
    },
  });

  // A replay is CPU-bound (~11-60ms per bar, measured) so a slow load must not read as a hang.
  useEffect(() => {
    if (!replayMutation.isPending) {
      setElapsed(0);
      return undefined;
    }
    const t0 = Date.now();
    const id = setInterval(() => setElapsed(Math.round((Date.now() - t0) / 1000)), 400);
    return () => clearInterval(id);
  }, [replayMutation.isPending]);

  const result = replayMutation.data;
  const steps = result?.steps ?? EMPTY_STEPS;
  const stale = Boolean(result) && resultKey !== key;
  const selected = selectedIdx != null && !stale ? steps[selectedIdx] : null;

  // Keep each original bar index attached so sorting cannot break row selection or its detail view.
  const sortedSteps = useMemo(() => {
    const indexedSteps = steps.map((step, index) => ({ step, index }));
    if (!sort.key) return indexedSteps;

    const { get } = RESULT_SORT_FIELDS[sort.key];
    const direction = sort.dir === 'asc' ? 1 : -1;
    return indexedSteps.sort((a, b) => {
      const left = get(a.step);
      const right = get(b.step);
      if (left == null || right == null) {
        if (left == null && right == null) return a.index - b.index;
        return left == null ? 1 : -1;
      }
      const difference = (left - right) * direction;
      return difference || a.index - b.index;
    });
  }, [steps, sort]);

  const toggleSort = (key2) => {
    setSort((current) => (
      current.key === key2
        ? { key: key2, dir: current.dir === 'asc' ? 'desc' : 'asc' }
        : { key: key2, dir: RESULT_SORT_FIELDS[key2].firstDir }
    ));
  };

  const sortableHeader = (key2, title) => {
    const field = RESULT_SORT_FIELDS[key2];
    const active = sort.key === key2;
    const nextDirection = active
      ? sort.dir === 'asc' ? 'desc' : 'asc'
      : field.firstDir;

    return (
      <th
        scope="col"
        title={title}
        aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined}
      >
        <button
          type="button"
          className="pb-sort"
          onClick={() => toggleSort(key2)}
          aria-label={`Sort ${field.ariaLabel ?? field.label} ${nextDirection}`}
        >
          {field.label}
          <span className="pb-sort-indicator" aria-hidden="true">
            {active ? (sort.dir === 'asc' ? '↑' : '↓') : '↕'}
          </span>
        </button>
      </th>
    );
  };

  const run = () => {
    if (blockedReason) return;
    replayMutation.mutate(
      periodId
        ? { periodId, protocolIds: [protocolId], windowSize: WINDOW_SIZE }
        : { symbol, timeframe, protocolIds: [protocolId], windowSize: WINDOW_SIZE },
    );
  };

  return (
    <section className="pb-panel bt-score-detail">
      <div className="pb-detail-head">
        <h3>
          Score detail
          <PageInfoPopover label="What score detail measures">
            <strong>This is a diagnostic of the window, not a measurement to compare.</strong>
            <br />
            It RE-SCORES {symbol || 'the subject'} {timeframe ? `at ${timeframe}` : ''} over stored
            bars using the engine as it is today — it does not read the scores the app stored at the
            time. Nothing is saved, so two of these cannot be diffed. The stored, comparable result
            is the run above; use this to explain <em>why</em> a number moved.
            <br />
            <br />
            Scores are measured against the protocol&rsquo;s <strong>configured</strong> directional
            capacity, which is the ceiling shown on its card — a score of 12% of it is normal, not
            weak.
          </PageInfoPopover>
        </h3>
        <button
          type="button"
          className="ff-btn"
          onClick={run}
          disabled={Boolean(blockedReason) || replayMutation.isPending || !protocolId}
        >
          {replayMutation.isPending ? `Scoring… ${elapsed}s` : 'Score this window'}
        </button>
      </div>

      {blockedReason && <p className="pb-none">{blockedReason}</p>}

      {replayMutation.isError && (
        <NoticeBlock notice={noticeFromError(replayMutation.error)} compact />
      )}

      {stale && (
        <p className="pb-none">
          The subject or window changed since this table was produced. Score the window again —
          showing the previous table here would describe a different question.
        </p>
      )}

      {result && !stale && (
        <>
          <div className="pb-strip">
            <div className="pb-strip-item">
              <span>Rows scored</span>
              <strong>{steps.length.toLocaleString()}</strong>
            </div>
            {result.thresholds?.entryPct != null && (
              <div className="pb-strip-item">
                <span>Entry bar</span>
                <strong>{result.thresholds.entryPct}%</strong>
              </div>
            )}
            {result.thresholds?.strongPct != null && (
              <div className="pb-strip-item">
                <span>Strong bar</span>
                <strong>{result.thresholds.strongPct}%</strong>
              </div>
            )}
            {result.thresholds?.scale != null && (
              <div className="pb-strip-item">
                <span>Configured capacity</span>
                <strong>{result.thresholds.scale}</strong>
              </div>
            )}
            {result.summary && (
              <div className="pb-strip-item pb-strip-item--text">
                <span>Signals</span>
                <strong>{result.summary.signalSteps ?? '—'}</strong>
              </div>
            )}
            {result.summary?.buyAccuracy != null && (
              <div className="pb-strip-item pb-strip-item--text">
                <span>Buy right</span>
                <strong>{result.summary.buyAccuracy}%</strong>
              </div>
            )}
            {result.summary?.sellAccuracy != null && (
              <div className="pb-strip-item pb-strip-item--text">
                <span>Sell right</span>
                <strong>{result.summary.sellAccuracy}%</strong>
              </div>
            )}
          </div>

          {/* Column explanations are per-header `title` tooltips — the pattern already used by
              Capability Map, Screener, Backtest Data and Scoring Overview. A single block-level
              popover was tried first and replaced on the owner's direction (2026-10-17): the
              explanation belongs on the column you are looking at, not in a paragraph away from it. */}
          <div className="pb-table-wrap">
            <table className="bt-table">
              <caption className="sr-only">
                Every score this protocol produced in the window, initially in time order, with the
                signal the engine derived from it. Sortable by signal, score, percentage,
                opportunity, and correctness.
              </caption>
              <thead>
                <tr>
                  <th scope="col" title="The bar's close timestamp, in UTC. One row per bar the engine scored.">Time (UTC)</th>
                  {sortableHeader('signal', 'What the engine concluded on this bar: STRONG_BUY, BUY, HOLD, SELL or STRONG_SELL — or NO_DATA when it could not read enough to judge.')}
                  <th scope="col" title="YES when the score cleared the entry threshold. 'no' is HOLD — a reading, just not strong enough. 'no reading' is NO_DATA: nothing to measure, which is NOT the same as the market being quiet.">→ Signal?</th>
                  {sortableHeader('score', "Raw directional score over its denominator: the protocol's CONFIGURED directional capacity. Never compare this number to a percentage threshold.")}
                  {sortableHeader('percent', 'That score as a percentage of the configured directional capacity. This is the figure the thresholds compare.')}
                  {sortableHeader('opportunity', "The dual score's second reading: every directive counted, risk gates included. It shows how much of the protocol produced any reading at all. High opportunity with a low % means the capacity existed but pointed nowhere; low opportunity means most directives stayed silent.")}
                  <th scope="col" title="Directives that produced a non-zero reading, out of the protocol's total.">Directives</th>
                  <th scope="col" title="Price change over the NEXT bar, as a percentage. Blank where the window ends before that bar exists.">Fwd 1</th>
                  <th scope="col" title="Price change over the next 5 bars, as a percentage. Blank where the window ends before those bars exist.">Fwd 5</th>
                  {sortableHeader('correct', 'Whether the call matched Fwd 1: a BUY is right if price rose, a SELL if it fell. Blank for HOLD and NO_DATA, which make no directional claim.')}
                </tr>
              </thead>
              <tbody>
                {sortedSteps.map(({ step: s, index: i }) => {
                  const vm = buildScoreDisplay({
                    rawComposite: s.signalRaw,
                    rawMax: s.signalMax,
                    signal: s.signal,
                    // opportunity arrives as its percentage; 100 is the percentage scale, so
                    // buildScoreDisplay derives the same figure rather than a second one.
                    opportunityScore: s.opportunityPct,
                    opportunityMax: 100,
                  });
                  const signalled = isSignal(s.signal);
                  return (
                    <tr
                      key={`${s.timestamp}-${i}`}
                      className={`pb-row ${signalled ? 'pb-row--signal' : ''} ${i === selectedIdx ? 'pb-row--selected' : ''}`}
                      onClick={() => setSelectedIdx(i === selectedIdx ? null : i)}
                      title="Select for the per-directive breakdown of this bar"
                    >
                      <td className="pb-mono">{fmtTime(s.timestamp)}</td>
                      <td><SignalBadge display={vm} /></td>
                      <td>
                        <span className={signalled ? 'pb-yes' : 'pb-no'}>
                          {signalled ? 'YES' : (s.signal === 'NO_DATA' ? 'no reading' : 'no')}
                        </span>
                      </td>
                      <td className="pb-mono">{s.signalRaw} / {s.signalMax}</td>
                      <td className="pb-mono pb-mono--strong">{Number(s.normalizedScore).toFixed(1)}%</td>
                      <td className="pb-mono">{s.opportunityPct == null ? '—' : `${s.opportunityPct}%`}</td>
                      <td className="pb-mono">{s.activeDirectives} / {s.totalDirectives}</td>
                      <td className={`pb-mono ${s.forwardReturn1 >= 0 ? 'pb-up' : 'pb-down'}`}>{n1(s.forwardReturn1)}</td>
                      <td className={`pb-mono ${s.forwardReturn5 >= 0 ? 'pb-up' : 'pb-down'}`}>{n1(s.forwardReturn5)}</td>
                      <td>{s.signalCorrect === undefined ? '—' : s.signalCorrect ? '✓' : '✗'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {selected && (
            <div className="pb-detail">
              <h3>
                Bar {selectedIdx + 1} · {fmtTime(selected.timestamp)} · {selected.signal}
              </h3>
              {selected.directiveBreakdown?.length ? (
                <table className="bt-table">
                  <caption className="sr-only">Directive scores at the selected bar.</caption>
                  <thead>
                    <tr>
                      <th scope="col" title="The directive whose reading is shown for this bar.">Directive</th>
                      <th scope="col" title="This directive's score out of its OWN maximum — not the protocol's.">Reading</th>
                      <th scope="col" title="The same reading as a percentage of that directive's own maximum.">Score</th>
                      <th scope="col" title="The directive's own conclusion for this bar — e.g. BULLISH, BEARISH, NEUTRAL.">Class</th>
                      <th scope="col" title="The directive's own explanation of why it produced that reading.">Why</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selected.directiveBreakdown.map((d) => (
                      <tr key={d.name}>
                        <td>{d.name}</td>
                        <td className="pb-mono">{d.score} / {d.maxScore}</td>
                        <td className="pb-mono">{Number(d.score / Math.max(1, d.maxScore) * 100).toFixed(0)}%</td>
                        <td>{d.signalClass}</td>
                        <td className="pb-reason">{d.reason}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <p className="pb-none">
                  No directive produced a reading on this bar — that is what <code>NO_DATA</code>{' '}
                  means: nothing to classify, which is a different thing from a neutral HOLD.
                </p>
              )}
            </div>
          )}
        </>
      )}

      {result && !stale && steps.length === 0 && (
        <p className="pb-none">The window produced no steps. That is a finding, not a zero.</p>
      )}
    </section>
  );
}
