import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'motion/react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { createChart, CandlestickSeries } from 'lightweight-charts';
import { apiGet, apiPost } from '../core/api/client';
import LoadingSkeleton from '../components/LoadingSkeleton';
import './snapshot-replay.css';

const SPEEDS = { '1×': 500, '5×': 100, '20×': 25, 'Instant': 0 };
const TIMEFRAMES = ['1m', '5m', '15m', '1h'];
const DEFAULT_SYMBOLS = ['EURUSD', 'GBPUSD', 'XAUUSD', 'USDCAD'];

export default function SnapshotReplayPage() {
  const [symbol, setSymbol] = useState('EURUSD');
  const [timeframe, setTf] = useState('5m');
  const [fromDate, setFromDate] = useState('2026-07-01');
  const [toDate, setToDate] = useState('2026-07-08');
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState('1×');
  const [currentIdx, setCurrentIdx] = useState(0);
  const [directiveMode, setDirectiveMode] = useState(true);
  const [symbolInput, setSymbolInput] = useState('EURUSD');
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

  // ── Run replay ──
  const replayMutation = useMutation({
    mutationFn: (config) => apiPost('/api/replay/run', config),
  });

  const replayResult = replayMutation.data;
  const steps = replayResult?.steps || [];
  const totalCandles = steps.length;

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
  useEffect(() => {
    if (!candleSeries.current || !chartCandles.length) return;
    candleSeries.current.setData(chartCandles);
    if (chartInst.current) chartInst.current.timeScale().fitContent();
  }, [chartCandles]);

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
    replayMutation.mutate({ symbol: symbolInput.toUpperCase(), timeframe, from: fromDate, to: toDate, windowSize: 30, relativeScoring: true });
  };

  if (inventoryQuery.isLoading) return <LoadingSkeleton variant="card" count={4} />;

  return (
    <div className="sr-page">
      <header className="sr-header">
        <h1>⏮ Market Replay</h1>
        <p className="sr-subtitle">Step through historical bars with full directive scoring</p>
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
          disabled={replayMutation.isPending}
        >
          {replayMutation.isPending ? 'Running…' : 'Load Replay'}
        </button>
        {replayResult && (
          <span className="sr-result-summary">
            {replayResult.totalBars} bars · {steps.length} steps · avg {replayResult.summary.avgComposite}%
          </span>
        )}
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

          {/* ── Chart + Directives ── */}
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
              {allSignals.slice(0, currentIdx + 1).map((s, i) => (
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
