/**
 * ProtocolBacktestPage — PROTOCOL backtesting: scores only, no trades (#823).
 * =============================================================================
 *
 * Pipeline position:
 *   protocol + symbol + window  →  POST /api/replay/run  →  a TIMELINE of scores
 *   the same steps the live loop would produce, one row per bar, in order.
 *
 * ⚠️ WHY A SECOND VIEW, AND WHAT IT IS NOT.
 * The owner's direction, 2026-10-16: *"we should have 'Protocol Backtesting' (generates scores) and
 * 'Strategy Backtesting' (generates trades): two different views."* A protocol's job is to decide
 * whether an opportunity exists. A bot's job is what to do about it — money, gates, limits. The
 * existing `/lab/backtest` answers the SECOND question (it stores TRADES and SIGNALS) but never
 * exposed the range of scores behind those signals. Squashing both into one page was the owner's
 * own conclusion: *"It would be alot to squash into one page so lets go with my two separate ones."*
 *
 * ⚠️ NO NEW SCORING PATH. This page calls the SAME endpoint the Snapshot Replay uses, which calls
 * `ProtocolGatingService.scoreWithGating` — the canonical engine
 * (`validate-single-scoring-path.cjs` fails a second one in prebuild). Nothing here re-derives
 * BUY/HOLD/SELL from a percentage; the signal is the ENGINE's, and the badge is the app's one
 * signal renderer (`SignalBadge` via `buildScoreDisplay`).
 *
 * ⚠️ SYMBOL IS NOT TYPED BY HAND. The owner: *"manual entry of symbol … is wrong and we should
 * only be able to select a symbol from the watchlist that the protocol consumes."* The choices come
 * from the protocol's own `resolvedSymbols`, so a symbol the protocol does not score is not
 * offerable at all.
 *
 * ⚠️ WHAT THIS IS NOT: it is not a RECORD of what happened. `/api/replay/run` RE-SCORES the window
 * from bars; it does not read stored snapshots. Measured 2026-08-15 — `replay.service.ts` has zero
 * references to `scoreSnapshot`/`directiveOutcome`. So the table is a COUNTERFACTUAL: "the engine,
 * run over this window today". Say so on the page, because the numbers look identical either way.
 *
 * @uses POST /api/replay/run                      (the canonical scorer)
 * @uses GET  /api/scoring/gated/protocols          (protocols + their resolvedSymbols)
 */
import { useState, useMemo, useEffect } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { apiGet, apiPost } from '../core/api/client';
import NoticeBlock from '../components/NoticeBlock';
import { noticeFromError } from '../core/notices/from-error.js';
import LoadingSkeleton from '../components/LoadingSkeleton';
import PageInfoPopover from '../components/PageInfoPopover';
import SignalBadge from '../components/SignalBadge';
import { buildScoreDisplay } from '../core/score-display';
import './protocol-backtest.css';

/** Timeframes the store actually holds (measured: 1m, 5m, 15m, 1h, 4h, 1d). */
const TIMEFRAMES = ['15m', '1h', '4h', '1d'];

/**
 * Bars per day, observed in the store for 24/5 instruments, and the window to default to for each.
 *
 * ⚠️ WHY THE WINDOW IS PER-TIMEFRAME. A replay's cost is bars × directives, and the engine refuses
 * what it cannot finish in 20s. Measured 2026-10-17: the FIRST protocol alphabetically
 * (`btc-speed-v1`, 14 directives) over the old flat 14-day default at its recommended 15m hit that
 * deadline on the user's very first click — 1,163 bars. One number cannot serve both 1d and 15m.
 *
 * These figures only WARN; the server's deadline is the authority. They are derived from measured
 * step counts, not guessed: 1h/14d ≈ 212 steps, 15m/14d ≈ 1,163, 5m/10d ≈ 2,153.
 */
const BARS_PER_DAY = { '15m': 83, '1h': 15, '4h': 4, '1d': 1 };
const DEFAULT_DAYS = { '15m': 2, '1h': 10, '4h': 20, '1d': 60 };

/**
 * Above this many scoring operations a run is at RISK of the engine's refusal, because cost per
 * operation varies ~5x between protocols (11.5-59.7 ms measured). 700 ops is ~7.7s for the cheapest
 * protocol and ~42s for the dearest, against a 20s deadline — so it is a warning line, not a block.
 * The server decides.
 */
const RISKY_OPS = 700;

const isoDay = (d) => d.toISOString().slice(0, 10);
const daysAgo = (n) => isoDay(new Date(Date.now() - n * 86400000));

/** A protocol advertises `recommendedTimeframe`; use it only if we can offer it. */
function pickTimeframe(recommended) {
  if (!recommended) return '1h';
  const norm = String(recommended).toLowerCase().replace(/\s/g, '');
  return TIMEFRAMES.find((tf) => norm.includes(tf)) ?? '1h';
}

const isSignal = (signal) =>
  signal === 'BUY' || signal === 'STRONG_BUY' || signal === 'SELL' || signal === 'STRONG_SELL';

const fmtTime = (ts) => {
  const d = new Date(ts);
  return Number.isNaN(d.getTime()) ? '—' : d.toISOString().slice(0, 16).replace('T', ' ');
};

const n1 = (v) => (typeof v === 'number' ? v.toFixed(2) : '—');

export default function ProtocolBacktestPage() {
  const [protocolId, setProtocolId] = useState('');
  const [symbol, setSymbol] = useState('');
  const [timeframe, setTimeframe] = useState('1h');
  const [fromDate, setFromDate] = useState(() => daysAgo(DEFAULT_DAYS['1h']));
  const [toDate, setToDate] = useState(() => isoDay(new Date()));
  const [selectedIdx, setSelectedIdx] = useState(null);

  const protocolsQuery = useQuery({
    queryKey: ['pb-protocols'],
    queryFn: () => apiGet('/api/scoring/gated/protocols').catch(() => ({ protocols: [] })),
    staleTime: 60_000,
  });
  const protocols = protocolsQuery.data?.protocols ?? [];

  const protocol = useMemo(
    () => protocols.find((p) => p.id === protocolId) ?? null,
    [protocols, protocolId],
  );
  const symbols = protocol?.resolvedSymbols ?? [];

  // Choosing a protocol sets the symbol (its first) and its own recommended timeframe. The symbol
  // list belongs to the protocol, so changing protocol MUST re-resolve the symbol rather than keep
  // a pairing the protocol does not cover.
  useEffect(() => {
    if (!protocol) return;
    setSymbol((prev) => (symbols.includes(prev) ? prev : (symbols[0] ?? '')));
    setTimeframe(pickTimeframe(protocol.recommendedTimeframe));
  }, [protocol, symbols]);

  // Changing the TIMEFRAME re-scopes the window, because the budget is bars × directives: 10 days
  // is comfortable at 1h and hopeless at 15m. ⚠️ This resets a hand-edited date range when the
  // timeframe changes — deliberate, since the new timeframe invalidates the old window's cost.
  useEffect(() => {
    setFromDate(daysAgo(DEFAULT_DAYS[timeframe] ?? 10));
    setToDate(isoDay(new Date()));
  }, [timeframe]);

  // ── The pre-run estimate. The engine refuses what it cannot finish; this says so BEFORE the
  //    user waits 20s to find out. It is an estimate and is labelled as one. ──
  const windowDays = Math.max(
    1,
    Math.round((new Date(toDate).getTime() - new Date(fromDate).getTime()) / 86400000),
  );
  const estSteps = Math.round(windowDays * (BARS_PER_DAY[timeframe] ?? 15));
  const estOps = estSteps * (protocol?.directiveCount ?? 0);
  const estRisky = estOps > RISKY_OPS;

  const replayMutation = useMutation({
    mutationFn: (config) => apiPost('/api/replay/run', config),
    onSuccess: () => setSelectedIdx(null),
  });

  // A replay is CPU-bound (~11-60ms per bar, measured) so a slow load must not read as a hang.
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (!replayMutation.isPending) {
      setElapsed(0);
      return;
    }
    const t0 = Date.now();
    const id = setInterval(() => setElapsed(Math.round((Date.now() - t0) / 1000)), 400);
    return () => clearInterval(id);
  }, [replayMutation.isPending]);

  const result = replayMutation.data;
  const steps = result?.steps ?? [];
  const selected = selectedIdx != null ? steps[selectedIdx] : null;

  const run = () => {
    if (!protocolId || !symbol) return;
    replayMutation.mutate({
      symbol,
      timeframe,
      from: fromDate,
      to: toDate,
      windowSize: 30,
      protocolIds: [protocolId],
    });
  };

  if (protocolsQuery.isLoading) return <LoadingSkeleton variant="card" count={3} />;

  const canRun = Boolean(protocolId && symbol) && !replayMutation.isPending;

  return (
    <div className="pb-page">
      <header className="pb-header">
        <h1>
          Protocol Backtesting
          <PageInfoPopover>
            Runs one protocol over a historical window and lists every score it produced, in order —
            the timeline behind the signals. Scores only: no bot, no trades, no money.
          </PageInfoPopover>
        </h1>
        <p className="pb-intro">
          Scores only. For trade execution and position management there is a separate{' '}
          <strong>Strategy Backtesting</strong> view (planned) — this page deliberately has no bot
          and no money, because a protocol decides <em>whether an opportunity exists</em> and a bot
          decides <em>what to do about it</em>.
        </p>
      </header>

      <section className="pb-panel">
        <div className="pb-fields">
          <label>
            Protocol
            <select value={protocolId} onChange={(e) => setProtocolId(e.target.value)}>
              <option value="">Select a protocol…</option>
              {protocols.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name || p.id} · {p.directiveCount} directives · max {p.maxScore}
                </option>
              ))}
            </select>
          </label>

          {/* ⚠️ NO FREE-TEXT SYMBOL. The choices are the protocol's OWN resolved symbols, so an
              instrument the protocol does not score cannot be offered. */}
          <label>
            Symbol
            <select
              value={symbol}
              onChange={(e) => setSymbol(e.target.value)}
              disabled={!protocolId || symbols.length === 0}
            >
              {symbols.length === 0 && (
                <option value="">{protocolId ? 'this protocol resolves no symbols' : 'choose a protocol first'}</option>
              )}
              {symbols.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </label>

          <label>
            Timeframe
            <select value={timeframe} onChange={(e) => setTimeframe(e.target.value)}>
              {TIMEFRAMES.map((tf) => (
                <option key={tf} value={tf}>{tf}</option>
              ))}
            </select>
          </label>

          <label>
            From
            <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
          </label>
          <label>
            To
            <input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} />
          </label>

          <button type="button" className="pb-run" onClick={run} disabled={!canRun}>
            {replayMutation.isPending
              ? `Scoring… ${elapsed}s`
              : !protocolId
                ? 'Select a protocol'
                : !symbol
                  ? 'No symbol'
                  : 'Score this window'}
          </button>
        </div>

        {protocol && (
          <p className="pb-proto-note">
            <strong>{protocol.name || protocol.id}</strong> · {protocol.directiveCount} directives ·
            configured capacity <strong>{protocol.maxScore}</strong> · recommended timeframe{' '}
            {protocol.recommendedTimeframe || '—'}
            {protocol.tradingStyle ? ` · style ${protocol.tradingStyle}` : ''}
            {symbols.length === 0 && (
              <> · ⚠️ this protocol resolves NO symbols, so there is nothing it can score.</>
            )}
          </p>
        )}

        {/* Say the cost BEFORE the click. The engine's refusal is rendered below too — this is the
            warning, that is the verdict. */}
        {protocol && symbol && (
          <p className={`pb-estimate ${estRisky ? 'pb-estimate--risky' : ''}`}>
            ≈ {estSteps.toLocaleString()} bars × {protocol.directiveCount} directives ≈{' '}
            <strong>{estOps.toLocaleString()}</strong> scoring operations
            {estRisky
              ? ' — likely over the engine’s budget. Narrow the range or choose a higher timeframe.'
              : ' — within the engine’s budget.'}{' '}
            <span className="pb-estimate-note">estimate only; the engine decides</span>
          </p>
        )}

        {/* The engine refuses a window it cannot finish inside its budget, with the count and the
            fix. That refusal is a RESULT, not a failure — render it verbatim. */}
        {replayMutation.isError && (
          <NoticeBlock notice={noticeFromError(replayMutation.error)} />
        )}
      </section>

      {result && steps.length > 0 && (
        <section className="pb-results">
          <div className="pb-strip">
            <div className="pb-strip-item"><span>Bars</span><strong>{result.totalBars}</strong></div>
            <div className="pb-strip-item"><span>Steps</span><strong>{steps.length}</strong></div>
            <div className="pb-strip-item pb-strip-item--signal"><span>Became a signal</span><strong>{result.summary.buySignals + result.summary.sellSignals}</strong></div>
            <div className="pb-strip-item"><span>HOLD</span><strong>{result.summary.holdSignals}</strong></div>
            <div className="pb-strip-item"><span>No data</span><strong>{result.summary.noDataSignals}</strong></div>
            <div className="pb-strip-item pb-strip-item--muted"><span>Entry bar to signal</span><strong>{result.thresholds?.entry}%</strong></div>
            <div className="pb-strip-item pb-strip-item--muted"><span>Strong at</span><strong>{result.thresholds?.strong}%</strong></div>
          </div>

          {/* ⚠️ THE HONESTY STATEMENT — not decoration, and not abridged. The numbers are computed
              now, over stored bars; they are NOT a record of what the app decided at the time. */}
          <p className="pb-counterfactual">
            ⚠️ <strong>Counterfactual, not a record.</strong> This RE-SCORES {symbol} {timeframe} over
            stored bars using the engine as it is today — it does not read the scores the app stored
            at the time. Bars before this protocol's data begins are absent, so a short window is
            shorter than its dates suggest. Scores are measured against the protocol&rsquo;s{' '}
            <strong>configured</strong> capacity ({result.thresholds?.scale}).
          </p>

          <div className="pb-table-wrap">
            <table className="bt-table">
              <caption className="sr-only">
                Every score this protocol produced, in time order, with the signal the engine
                derived from it.
              </caption>
              <thead>
                <tr>
                  <th scope="col">Time (UTC)</th>
                  <th scope="col">Signal</th>
                  <th scope="col">→ Signal?</th>
                  <th scope="col">Score</th>
                  <th scope="col">%</th>
                  <th scope="col">Opportunity</th>
                  <th scope="col">Directives</th>
                  <th scope="col">Fwd 1</th>
                  <th scope="col">Fwd 5</th>
                  <th scope="col">Correct</th>
                </tr>
              </thead>
              <tbody>
                {steps.map((s, i) => {
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
                      <th scope="col">Directive</th>
                      <th scope="col">Reading</th>
                      <th scope="col">Score</th>
                      <th scope="col">Class</th>
                      <th scope="col">Why</th>
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
        </section>
      )}

      {result && steps.length === 0 && (
        <p className="pb-none">The window produced no steps. That is a finding, not a zero.</p>
      )}
    </div>
  );
}
