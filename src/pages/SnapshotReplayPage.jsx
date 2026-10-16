import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { motion } from 'motion/react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { createChart, CandlestickSeries } from 'lightweight-charts';
import { apiGet, apiPost } from '../core/api/client';
import LoadingSkeleton from '../components/LoadingSkeleton';
import NoticeBlock from '../components/NoticeBlock';
import { noticeFromError } from '../core/notices/from-error.js';
import './snapshot-replay.css';
import PageInfoPopover from '../components/PageInfoPopover';

const SPEEDS = { '1×': 500, '5×': 100, '20×': 25, 'Instant': 0 };
const TIMEFRAMES = ['1m', '5m', '15m', '1h'];
const DEFAULT_SYMBOLS = ['EURUSD', 'GBPUSD', 'XAUUSD', 'USDCAD'];

/**
 * The default window is DERIVED at mount — a `1h` walkthrough of the last 14 days.
 *
 * ⚠️ Two measured corrections here, both 2026-10-16.
 *
 * 1. These were hardcoded `'2026-07-01'` → `'2026-07-08'`. Against the live `marketbar` table
 *    EURUSD 5m holds 14,759 bars but the EARLIEST is 2026-08-05, so the default window predated
 *    all of its own data and every first click returned `400 — found 0 bar(s)`. A hardcoded date
 *    range is a dead control in a store with a rolling horizon: the data ages forward, the
 *    literal does not.
 *
 * 2. The replacement (5m over 10 days) was the SLOWEST possible choice. A replay costs roughly
 *    10ms and 2.2KB per bar, measured on `euro-stoxx-v1`:
 *
 *      | window     | time   | payload | steps |
 *      |------------|--------|---------|-------|
 *      | 1h · 14d   |  2.4s  | 0.46 MB |   212 |
 *      | 1h ·  7d   |  1.0s  | 0.20 MB |    92 |
 *      | 5m ·  2d   |  4.6s  | 0.91 MB |   419 |
 *      | 5m · 10d   | 22.4s  | 4.69 MB | 2,153 |
 *
 *    A 22-second wait with no progress reads as a HANG, and 2,153 steps is not a walkthrough
 *    anyone steps through by hand. 1h/14d is ~2s and is a real walkthrough. A denser timeframe
 *    stays available — it is just no longer the default.
 */
const isoDay = (d) => d.toISOString().slice(0, 10);
const daysAgo = (n) => isoDay(new Date(Date.now() - n * 86400000));
const DEFAULT_TIMEFRAME = '1h';
const DEFAULT_WINDOW_DAYS = 14;

/** Past this many steps, playback is genuinely slow — say so rather than appearing frozen.
 *  600 (≈15s of playback at 20×) sits above the default 1h/14d run (~212) and below the server's
 *  practical ceiling (800 ops ≈ its budget), so it is REACHABLE — a warning that can never fire is
 *  decoration. */
const MANY_STEPS = 600;

/** Bounded sparkline budget — see `sparkTicks` in the component. */
const MAX_SPARK_TICKS = 300;

export default function SnapshotReplayPage() {
  const [symbol, setSymbol] = useState('EURUSD');
  const [timeframe, setTf] = useState(DEFAULT_TIMEFRAME);
  const [fromDate, setFromDate] = useState(() => daysAgo(DEFAULT_WINDOW_DAYS));
  const [toDate, setToDate] = useState(() => isoDay(new Date()));
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState('1×');
  const [currentIdx, setCurrentIdx] = useState(0);
  const [directiveMode, setDirectiveMode] = useState(true);
  const [symbolInput, setSymbolInput] = useState('EURUSD');
  const [selectedProtocols, setSelectedProtocols] = useState([]);
  const chartRef = useRef(null);
  const chartInst = useRef(null);
  const candleSeries = useRef(null);
  const animRef = useRef(null);

  // ── Data inventory for available symbols ──
  const inventoryQuery = useQuery({
    queryKey: ['replay-inventory'],
    queryFn: () => apiGet('/api/replay/data-inventory'),
    staleTime: 60000,
  });

  const availableSymbols = inventoryQuery.data || [];

  // ── Protocols for canonical scoring (each replay scores the selected set) ──
  const protocolsQuery = useQuery({
    queryKey: ['replay-protocols'],
    queryFn: () => apiGet('/api/scoring/gated/protocols').catch(() => ({ protocols: [] })),
    staleTime: 60_000,
  });
  const protocols = protocolsQuery.data?.protocols || [];

  // ── Run replay ──
  const replayMutation = useMutation({
    mutationFn: (config) => apiPost('/api/replay/run', config),
  });

  const replayResult = replayMutation.data;
  const steps = replayResult?.steps || [];
  const totalCandles = steps.length;

  /**
   * ⚠️ ELAPSED FEEDBACK — because a replay is SLOW, and silence reads as broken.
   * Measured 2026-10-16: 1h/14d takes 2.4s; 5m/10d took 22.4s. With the button simply saying
   * "Running…", a 22-second wait is indistinguishable from a hang — which is exactly what it was
   * reported as. The page already renders its errors (see the NoticeBlock below); this is the same
   * rule applied to the waiting, not just the failing.
   */
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

  /** Sparkline ticks are DOM NODES. See `sparkTicks` below — it must be declared AFTER
   *  `allSignals`, which it samples. */

  // ── Current step data ──
  const currentStep = steps[currentIdx];
  const currentCandle = currentStep?.bar;

  // ── Format bar for chart ──
  const chartCandles = useMemo(() => {
    return steps.slice(0, currentIdx + 1).map((s) => ({
      time: new Date(s.timestamp).getTime() / 1000,
      open: s.bar.open, high: s.bar.high, low: s.bar.low, close: s.bar.close,
    }));
  }, [steps, currentIdx]);

  // ── Directive breakdown at current step ──
  const currentDirectives = currentStep?.directiveBreakdown || [];

  // ── Signal summary ──
  const currentSignal = useMemo(() => {
    if (!currentStep) return { signal: 'hold', avgScore: 0, runningPnl: 0 };
    const firstClose = steps[0]?.bar?.close || currentStep.bar.close;
    const pnl = ((currentStep.bar.close - firstClose) / firstClose) * 100;
    return {
      signal: currentStep.signal?.toLowerCase() || 'hold',
      avgScore: currentStep.normalizedScore || 0,
      runningPnl: +pnl.toFixed(2),
    };
  }, [currentStep, steps]);

  // ── All signals sparkline ──
  const allSignals = useMemo(() => {
    return steps.map((s) => ({
      signal: (s.signal || 'HOLD').toLowerCase(),
      avgScore: s.normalizedScore || 0,
    }));
  }, [steps]);

  /**
   * ⚠️ BOUNDED SPARKLINE — ticks are DOM NODES.
   *
   * `allSignals.slice(0, currentIdx + 1)` grew one node per bar and was rebuilt on every playback
   * tick: a 2,153-step replay re-created 2,153 nodes every 25ms at 20× speed, on top of the chart
   * update. Sampling to a fixed budget keeps the SHAPE (the run of buy/sell/no-data) while the
   * DOM stops scaling with the window. Measured 2026-10-16 — the default window is now 1h/14d
   * (~212 steps), but a hand-chosen 5m/10d window is 2,153 and must not freeze the tab.
   */
  const sparkTicks = useMemo(() => {
    const upTo = allSignals.slice(0, currentIdx + 1);
    if (upTo.length <= MAX_SPARK_TICKS) return upTo;
    const stride = Math.ceil(upTo.length / MAX_SPARK_TICKS);
    return upTo.filter((_, i) => i % stride === 0 || i === upTo.length - 1);
  }, [allSignals, currentIdx]);

  // ── Chart setup ──
  useEffect(() => {
    if (!chartRef.current || chartInst.current) return;
    const chart = createChart(chartRef.current, {
      width: chartRef.current.clientWidth, height: 420,
      layout: { background: { color: 'transparent' }, textColor: '#94a3b8' },
      grid: { vertLines: { color: 'rgba(255,255,255,0.04)' }, horzLines: { color: 'rgba(255,255,255,0.04)' } },
      crosshair: { mode: 1 },
      rightPriceScale: { borderColor: 'rgba(255,255,255,0.08)' },
      timeScale: { borderColor: 'rgba(255,255,255,0.08)', timeVisible: true },
    });
    candleSeries.current = chart.addSeries(CandlestickSeries, {
      upColor: '#22c55e', downColor: '#ef4444',
      borderUpColor: '#22c55e', borderDownColor: '#ef4444',
      wickUpColor: '#22c55e', wickDownColor: '#ef4444',
    });
    chartInst.current = chart;
    const h = () => { if (chartRef.current && chartInst.current) chartInst.current.applyOptions({ width: chartRef.current.clientWidth }); };
    window.addEventListener('resize', h);
    return () => { window.removeEventListener('resize', h); chart.remove(); chartInst.current = null; };
  }, [replayResult]);

  // ── Update chart candles ──
  // ⚠️ `fitContent()` used to run on EVERY step — i.e. every animation frame at 20× speed (25ms) —
  // and each call re-lays out the whole visible series. Measured 2026-10-16: a 5m/10d replay is
  // 2,153 steps, so playback re-fitted a 2,000+ candle series ~40 times a second. That is a large
  // part of why the tab froze. The fit now happens once per RUN (below); the progressive reveal
  // still happens here, because `chartCandles` is the prefix up to `currentIdx`.
  useEffect(() => {
    if (!candleSeries.current || !chartCandles.length) return;
    candleSeries.current.setData(chartCandles);
  }, [chartCandles]);

  // One fit per run, not per tick.
  useEffect(() => {
    if (chartInst.current && replayResult) chartInst.current.timeScale().fitContent();
  }, [replayResult]);

  // ── Animation ──
  const advance = useCallback(() => {
    setCurrentIdx((prev) => {
      if (prev >= totalCandles - 1) { setPlaying(false); return prev; }
      return prev + 1;
    });
  }, [totalCandles]);

  useEffect(() => {
    if (!playing) return;
    const ms = SPEEDS[speed] || 500;
    if (ms === 0) { setCurrentIdx(totalCandles - 1); setPlaying(false); return; }
    animRef.current = setInterval(advance, ms);
    return () => clearInterval(animRef.current);
  }, [playing, speed, advance, totalCandles]);

  const stepForward = () => setCurrentIdx((p) => Math.min(totalCandles - 1, p + 1));
  const stepBack = () => setCurrentIdx((p) => Math.max(0, p - 1));
  const reset = () => { setPlaying(false); setCurrentIdx(0); };
  const progressPct = totalCandles > 0 ? ((currentIdx / Math.max(1, totalCandles - 1)) * 100).toFixed(0) : 0;

  const handleRun = () => {
    reset();
    replayMutation.mutate({
      symbol: symbolInput.toUpperCase(),
      timeframe,
      from: fromDate,
      to: toDate,
      windowSize: 30,
      protocolIds: selectedProtocols,
    });
  };

  const toggleProtocol = (id) => {
    setSelectedProtocols((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  };

  if (inventoryQuery.isLoading) return <LoadingSkeleton variant="card" count={4} />;

  return (
    <div className="sr-page">
      <header className="sr-header">
        <h1>⏮ Market Replay
          <PageInfoPopover>
            Step through historical bars with full directive scoring
          </PageInfoPopover>
        </h1>
      </header>

      {/* ── Replay Config ── */}
      <div className="sr-config">
        <input
          className="sr-symbol-input"
          value={symbolInput}
          onChange={(e) => setSymbolInput(e.target.value.toUpperCase())}
          placeholder="Symbol"
          list="sr-symbols"
        />
        <datalist id="sr-symbols">
          {availableSymbols.slice(0, 20).map((s) => (
            <option key={s.symbol} value={s.symbol} />
          ))}
        </datalist>
        <select value={timeframe} onChange={(e) => setTf(e.target.value)} className="sr-tf-select">
          {TIMEFRAMES.map((tf) => <option key={tf} value={tf}>{tf}</option>)}
        </select>
        <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} className="sr-date-input" />
        <span>to</span>
        <input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} className="sr-date-input" />
        <button
          className="sr-run-btn"
          onClick={handleRun}
          disabled={replayMutation.isPending || selectedProtocols.length === 0}
        >
          {replayMutation.isPending
            ? `Running… ${elapsed}s`
            : selectedProtocols.length === 0
              ? 'Select a protocol'
              : 'Load Replay'}
        </button>
        {replayResult && (
          <span className="sr-result-summary">
            {replayResult.totalBars} bars · {steps.length} steps
            {/* ⚠️ `holdSignals` deliberately EXCLUDES no-data bars (#758). Reporting them
                together as "hold" is what made a replay of an unreadable market look like a
                quiet one. */}
            · {replayResult.summary.buySignals} buy · {replayResult.summary.sellSignals} sell
            {replayResult.summary.noDataSignals > 0 && (
              <> · <span className="sr-nodata-count">{replayResult.summary.noDataSignals} no-data</span></>
            )}
            · avg {replayResult.summary.avgComposite}%
          </span>
        )}
      </div>

      {/* ── A FAILED REPLAY MUST SAY SO ────────────────────────────────────────────────────
          Measured 2026-10-16: this page rendered no error at all. `POST /api/replay/run` was
          returning HTTP 500 on every no-data tick — the common case — so clicking "Load Replay"
          did *nothing visible*: no spinner result, no message, no chart, no empty state. The
          feature looked unimplemented rather than broken, which is why backtesting felt
          unproductive for months. Silence is not a UI state. */}
      {replayMutation.isError && (
        <NoticeBlock notice={noticeFromError(replayMutation.error)} />
      )}

      {/* ⚠️ A big replay is SLOW — say so before it is mistaken for a hang.
          Playback ticks at 25ms per step at 20×, so a 2,153-step replay needs ~54s of watching
          even after the 22s load. Instant mode is the escape hatch; naming it is the point. */}
      {replayResult && totalCandles > MANY_STEPS && (
        <p className="sr-hint sr-many-steps">
          ⚠️ {totalCandles.toLocaleString()} steps — at 20× that is about{' '}
          {Math.round((totalCandles * 25) / 1000)}s of playback after the load. Use{' '}
          <strong>Instant</strong>, or narrow the window, if it feels stuck.
        </p>
      )}

      {/* ── Protocol selection (canonical scoring set) ── */}
      <div className="sr-protocol-select">
        <span className="sr-protocol-select-label">Protocols:</span>
        {protocols.map((p) => {
          const checked = selectedProtocols.includes(p.id);
          return (
            <label key={p.id} className={`sr-proto-chip ${checked ? 'active' : ''}`} title={p.id}>
              <input type="checkbox" checked={checked} onChange={() => toggleProtocol(p.id)} />
              {p.name || p.id}
            </label>
          );
        })}
        <span className="sr-hint">
          {selectedProtocols.length ? `${selectedProtocols.length} selected` : 'select ≥1 protocol to score'}
        </span>
      </div>

      {!replayResult && (
        <div className="sr-empty">
          <p>Choose a symbol, timeframe, date range and load a replay.</p>
          {availableSymbols.length > 0 && (
            <p className="sr-hint">{availableSymbols.length} symbols have bar data available.</p>
          )}
        </div>
      )}

      {replayResult && totalCandles > 0 && (
        <>
          {/* ── Controls ── */}
          <div className="sr-controls">
            <div className="sr-controls-left">
              <button type="button" className="sr-ctrl-btn" onClick={reset}>↺ Reset</button>
              <button type="button" className="sr-ctrl-btn" onClick={stepBack}>⏮ Step</button>
              <button type="button" className={`sr-ctrl-btn sr-ctrl-play ${playing ? 'active' : ''}`} onClick={() => setPlaying(!playing)}>
                {playing ? '⏸ Pause' : '▶ Play'}
              </button>
              <button type="button" className="sr-ctrl-btn" onClick={stepForward}>⏭ Step</button>
            </div>
            <div className="sr-controls-speed">
              {Object.keys(SPEEDS).map((s) => (
                <button key={s} type="button" className={`sr-speed-btn ${speed === s ? 'active' : ''}`} onClick={() => setSpeed(s)}>{s}</button>
              ))}
            </div>
            <label className="sr-toggle">
              <input type="checkbox" checked={directiveMode} onChange={(e) => setDirectiveMode(e.target.checked)} />
              Directives
            </label>
          </div>

          {/* Progress */}
          <div className="sr-progress-bar">
            <motion.div className="sr-progress-fill" animate={{ width: `${progressPct}%` }} transition={{ duration: 0.3 }} />
          </div>
          <div className="sr-progress-info">
            <span>Bar {currentIdx + 1} / {totalCandles}</span>
            {currentCandle && (
              <span>O: {currentCandle.open} H: {currentCandle.high} L: {currentCandle.low} C: {currentCandle.close}</span>
            )}
            {currentStep && (
              <>
                <span className={`sr-signal-badge ${currentSignal.signal}`}>
                  {currentStep.signal} ({currentStep.normalizedScore}%)
                </span>
                {currentStep.forwardReturn1 !== undefined && (
                  <span className={`sr-fwd-badge ${currentStep.forwardReturn1 >= 0 ? 'up' : 'down'}`}>
                    Fwd1: {currentStep.forwardReturn1 >= 0 ? '+' : ''}{currentStep.forwardReturn1}%
                  </span>
                )}
                {currentStep.forwardReturn5 !== undefined && (
                  <span className={`sr-fwd-badge ${currentStep.forwardReturn5 >= 0 ? 'up' : 'down'}`}>
                    Fwd5: {currentStep.forwardReturn5 >= 0 ? '+' : ''}{currentStep.forwardReturn5}%
                  </span>
                )}
                {currentStep.signalCorrect !== undefined && (
                  <span className={`sr-correct-badge ${currentStep.signalCorrect ? 'correct' : 'wrong'}`}>
                    {currentStep.signalCorrect ? '✓ Correct' : '✗ Wrong'}
                  </span>
                )}
              </>
            )}
          </div>

          {/* ── Decision Card (primary — the star of the show, not the candles) ── */}
          {currentStep && (
            <div className="sr-decision-card">
              <div className="sr-dc-top">
                <span className="sr-dc-symbol">
                  {symbolInput.toUpperCase()} · {timeframe} · {new Date(currentStep.timestamp).toLocaleString()}
                </span>
                <span className={`sr-dc-signal ${currentSignal.signal}`}>{currentStep.signal}</span>
                <span className="sr-dc-score">{currentStep.normalizedScore}%</span>
              </div>

              <div className="sr-dc-identity">
                <span className="sr-dc-proto" title="Protocol (signal thesis) — the scoring recipe / directional edge">
                  🧭 {currentStep.protocolName || currentStep.protocolId || '—'}
                </span>
                {currentStep.botName && (
                  <span className="sr-dc-bot" title="Execution bot (policy) — money-management & risk gates">
                    🤖 {currentStep.botName}
                  </span>
                )}
              </div>

              <div className="sr-dc-fwd">
                {currentStep.forwardReturn1 !== undefined && (
                  <span className={`sr-dc-fwd-item ${currentStep.forwardReturn1 >= 0 ? 'up' : 'down'}`}>
                    Fwd1 {currentStep.forwardReturn1 >= 0 ? '+' : ''}{currentStep.forwardReturn1}%
                  </span>
                )}
                {currentStep.forwardReturn5 !== undefined && (
                  <span className={`sr-dc-fwd-item ${currentStep.forwardReturn5 >= 0 ? 'up' : 'down'}`}>
                    Fwd5 {currentStep.forwardReturn5 >= 0 ? '+' : ''}{currentStep.forwardReturn5}%
                  </span>
                )}
                {currentStep.signalCorrect !== undefined && (
                  <span className={`sr-dc-correct ${currentStep.signalCorrect ? 'correct' : 'wrong'}`}>
                    {currentStep.signalCorrect ? '✓ Correct' : '✗ Wrong'}
                  </span>
                )}
              </div>

              {directiveMode && currentDirectives.length > 0 && (
                <div className="sr-dc-directives">
                  {currentDirectives.map((d) => (
                    <div key={d.name} className="sr-dc-dir" title={d.reason}>
                      <span className={`sr-dc-dir-dot ${d.signalClass}`} />
                      <span className="sr-dc-dir-name">{d.name}</span>
                      <span className="sr-dc-dir-score">{d.score}/{d.maxScore}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ── Chart + Directives (secondary price context) ── */}
          <div className="sr-layout">
            <div className="sr-chart-wrap" ref={chartRef} />

            {directiveMode && currentDirectives.length > 0 && (
              <div className="sr-directives">
                <h3>Directives at bar {currentIdx + 1}</h3>
                {currentDirectives.map((d) => (
                  <div key={d.name} className="sr-dir-row">
                    <span className="sr-dir-name" title={d.reason}>{d.name}</span>
                    <div className="sr-dir-bar-wrap">
                      <motion.div
                        className="sr-dir-bar"
                        animate={{ width: `${Math.min(100, (d.score / Math.max(1, d.maxScore)) * 100)}%` }}
                        transition={{ duration: 0.3 }}
                        style={{ background: d.signalClass === 'bullish' ? '#22c55e' : d.signalClass === 'bearish' ? '#ef4444' : '#6366f1' }}
                      />
                    </div>
                    <span className="sr-dir-score">{d.score}/{d.maxScore}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* ── Protocol Panel ── */}
          <div className="sr-protocol-panel">
            <h3>Replay: {symbolInput.toUpperCase()} · {timeframe} · {fromDate} → {toDate}</h3>
            <div className="sr-protocol-grid">
              <div className="sr-protocol-stat">
                <span className="sr-protocol-label">Signal</span>
                <motion.span
                  key={currentSignal.signal + currentIdx}
                  initial={{ scale: 1.3 }} animate={{ scale: 1 }}
                  className={`sr-signal-badge ${currentSignal.signal}`}
                >
                  {currentSignal.signal.toUpperCase()}
                </motion.span>
              </div>
              <div className="sr-protocol-stat">
                <span className="sr-protocol-label">Composite</span>
                <span className="sr-protocol-value">{currentSignal.avgScore}%</span>
              </div>
              <div className="sr-protocol-stat">
                <span className="sr-protocol-label">Hypothetical P&amp;L</span>
                <span className={`sr-protocol-value ${currentSignal.runningPnl >= 0 ? 'up' : 'down'}`}>
                  {currentSignal.runningPnl >= 0 ? '+' : ''}{currentSignal.runningPnl}%
                </span>
              </div>
            </div>

            {/* Signal history sparkline */}
            <div className="sr-signal-sparkline">
              {sparkTicks.map((s, i) => (
                <div
                  key={i}
                  className={`sr-signal-tick ${s.signal}`}
                  title={`Bar ${i + 1}: ${s.signal} (${s.avgScore}%)`}
                />
              ))}
            </div>
          </div>

          {/* ── Outcomes Panel ── */}
          {replayResult.outcomes && replayResult.outcomes.signalCount > 0 && (
            <div className="sr-outcomes-panel">
              <h3>📊 Backtesting Outcomes</h3>
              <div className="sr-outcomes-grid">
                <div className="sr-outcome-card">
                  <span className="sr-outcome-label">Buy Accuracy</span>
                  <span className="sr-outcome-value">{replayResult.outcomes.buyAccuracy}%</span>
                  <span className="sr-outcome-sub">of {replayResult.summary.buySignals} signals</span>
                </div>
                <div className="sr-outcome-card">
                  <span className="sr-outcome-label">Sell Accuracy</span>
                  <span className="sr-outcome-value">{replayResult.outcomes.sellAccuracy}%</span>
                  <span className="sr-outcome-sub">of {replayResult.summary.sellSignals} signals</span>
                </div>
                <div className="sr-outcome-card">
                  <span className="sr-outcome-label">Avg Buy Return</span>
                  <span className={`sr-outcome-value ${replayResult.outcomes.avgBuyReturn1 >= 0 ? 'up' : 'down'}`}>
                    {replayResult.outcomes.avgBuyReturn1 >= 0 ? '+' : ''}{replayResult.outcomes.avgBuyReturn1}%
                  </span>
                  <span className="sr-outcome-sub">1-bar forward</span>
                </div>
                <div className="sr-outcome-card">
                  <span className="sr-outcome-label">Avg Sell Return</span>
                  <span className={`sr-outcome-value ${replayResult.outcomes.avgSellReturn1 >= 0 ? 'up' : 'down'}`}>
                    {replayResult.outcomes.avgSellReturn1 >= 0 ? '+' : ''}{replayResult.outcomes.avgSellReturn1}%
                  </span>
                  <span className="sr-outcome-sub">1-bar forward</span>
                </div>
                <div className="sr-outcome-card">
                  <span className="sr-outcome-label">Best / Worst Buy</span>
                  <span className="sr-outcome-value">
                    <span className="up">+{replayResult.outcomes.bestBuyReturn}%</span>
                    {' / '}
                    <span className="down">{replayResult.outcomes.worstBuyReturn}%</span>
                  </span>
                </div>
                <div className="sr-outcome-card">
                  <span className="sr-outcome-label">Missed Opportunities</span>
                  <span className="sr-outcome-value">{replayResult.outcomes.missedOpportunities}</span>
                  <span className="sr-outcome-sub">significant moves missed</span>
                </div>
                <div className="sr-outcome-card">
                  <span className="sr-outcome-label">False Positives</span>
                  <span className="sr-outcome-value">{replayResult.outcomes.falsePositives}</span>
                  <span className="sr-outcome-sub">wrong signals &gt;0.5% adverse</span>
                </div>
                <div className="sr-outcome-card">
                  <span className="sr-outcome-label">5-Bar Buy / Sell</span>
                  <span className="sr-outcome-value">
                    <span className={replayResult.outcomes.avgBuyReturn5 >= 0 ? 'up' : 'down'}>
                      {replayResult.outcomes.avgBuyReturn5 >= 0 ? '+' : ''}{replayResult.outcomes.avgBuyReturn5}%
                    </span>
                    {' / '}
                    <span className={replayResult.outcomes.avgSellReturn5 >= 0 ? 'up' : 'down'}>
                      {replayResult.outcomes.avgSellReturn5 >= 0 ? '+' : ''}{replayResult.outcomes.avgSellReturn5}%
                    </span>
                  </span>
                  <span className="sr-outcome-sub">5-bar forward avg</span>
                </div>
              </div>
            </div>
          )}
        </>
      )}

      {replayResult && totalCandles === 0 && (
        <div className="sr-empty">
          <p>Not enough bars for {symbolInput} {timeframe} ({replayResult.totalBars} bars found, need 30+).</p>
        </div>
      )}
    </div>
  );
}
