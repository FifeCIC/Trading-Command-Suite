import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useParams, Link } from 'react-router-dom';
import { motion } from 'motion/react';
import { createChart } from 'lightweight-charts';
import { apiGet } from '../core/api/client';
import LoadingSkeleton from '../components/LoadingSkeleton';
import './snapshot-replay.css';

const SPEEDS = { '1×': 500, '5×': 100, '20×': 25, 'Instant': 0 };

// ── Generate mock candles if API unavailable ──
function generateMockCandles(count = 200) {
  const candles = [];
  let price = 100, high = 100;
  for (let i = 0; i < count; i++) {
    const trend = (Math.random() - 0.35) * 2;
    const noise = (Math.random() - 0.5) * 3;
    price += trend + noise;
    const o = price - noise;
    const c = price;
    const h = Math.max(o, c) + Math.random() * 1.5;
    const l = Math.min(o, c) - Math.random() * 1.5;
    if (c > high) high = c;
    candles.push({ time: i, open: +o.toFixed(2), high: +h.toFixed(2), low: +l.toFixed(2), close: +c.toFixed(2) });
    price = c;
  }
  return candles;
}

// ── Mock directive scores ──
const MOCK_DIRECTIVES = [
  { id: 'rsi-oversold', name: 'RSI Oversold', scores: [45, 48, 52, 55, 58, 62, 60, 65, 68, 70].concat(Array(190).fill(0).map(() => 30 + Math.random() * 60)) },
  { id: 'macd-crossover', name: 'MACD Crossover', scores: [38, 40, 45, 42, 48, 55, 52, 58, 55, 60].concat(Array(190).fill(0).map(() => 20 + Math.random() * 70)) },
  { id: 'doji-pattern', name: 'Doji Pattern', scores: Array(200).fill(0).map(() => Math.random() * 100) },
];

export default function SnapshotReplayPage() {
  const { snapshotId } = useParams();

  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState('1×');
  const [currentIdx, setCurrentIdx] = useState(0);
  const [directiveMode, setDirectiveMode] = useState(true);
  const chartRef = useRef(null);
  const chartInst = useRef(null);
  const candleSeries = useRef(null);
  const animRef = useRef(null);

  // Try to fetch snapshot, fall back to mock
  const snapshotQuery = useQuery({
    queryKey: ['snapshot-replay', snapshotId],
    queryFn: () => apiGet(`/api/snapshots/${snapshotId}/replay-data`),
    enabled: Boolean(snapshotId),
    retry: 1,
  });

  const candles = useMemo(() => {
    if (snapshotQuery.data?.candles?.length) return snapshotQuery.data.candles;
    return generateMockCandles(200);
  }, [snapshotQuery.data]);

  const snapshot = snapshotQuery.data?.snapshot || { symbol: snapshotId || 'BTCUSD', timeframe: 'M5', notes: 'Mock replay data' };
  const totalCandles = candles.length;
  const currentCandle = candles[currentIdx];

  // ── Directive scores at current candle ──
  const currentScores = MOCK_DIRECTIVES.map((d) => ({
    ...d,
    currentScore: Math.round(d.scores[Math.min(currentIdx, d.scores.length - 1)] || 0),
  }));

  // ── Chart setup ──
  useEffect(() => {
    if (!chartRef.current) return;
    if (chartInst.current) { chartInst.current.remove(); chartInst.current = null; }

    const chart = createChart(chartRef.current, {
      width: chartRef.current.clientWidth, height: 400,
      layout: { background: { color: 'transparent' }, textColor: '#94a3b8' },
      grid: { vertLines: { color: 'rgba(255,255,255,0.04)' }, horzLines: { color: 'rgba(255,255,255,0.04)' } },
      crosshair: { mode: 1 },
      rightPriceScale: { borderColor: 'rgba(255,255,255,0.08)' },
      timeScale: { borderColor: 'rgba(255,255,255,0.08)', visible: false },
    });

    candleSeries.current = chart.addCandlestickSeries({
      upColor: '#22c55e', downColor: '#ef4444',
      borderUpColor: '#22c55e', borderDownColor: '#ef4444',
      wickUpColor: '#22c55e', wickDownColor: '#ef4444',
    });

    chartInst.current = chart;
    const h = () => { if (chartRef.current && chartInst.current) chartInst.current.applyOptions({ width: chartRef.current.clientWidth }); };
    window.addEventListener('resize', h);
    return () => { window.removeEventListener('resize', h); chart.remove(); chartInst.current = null; };
  }, []);

  // ── Update visible candles ──
  useEffect(() => {
    if (!candleSeries.current) return;
    candleSeries.current.setData(candles.slice(0, currentIdx + 1));
    if (chartInst.current) chartInst.current.timeScale().fitContent();
  }, [currentIdx, candles]);

  // ── Animation ──
  const advance = useCallback(() => {
    setCurrentIdx((prev) => {
      if (prev >= totalCandles - 1) { setPlaying(false); return prev; }
      return prev + 1;
    });
  }, [totalCandles]);

  useEffect(() => {
    if (!playing) return;
    const intervalMs = SPEEDS[speed] || 500;
    if (intervalMs === 0) { setCurrentIdx(totalCandles - 1); setPlaying(false); return; }
    animRef.current = setInterval(advance, intervalMs);
    return () => clearInterval(animRef.current);
  }, [playing, speed, advance, totalCandles]);

  // ── Controls ──
  const stepForward = () => setCurrentIdx((p) => Math.min(totalCandles - 1, p + 1));
  const stepBack = () => setCurrentIdx((p) => Math.max(0, p - 1));
  const reset = () => { setPlaying(false); setCurrentIdx(0); };
  const progressPct = ((currentIdx / Math.max(1, totalCandles - 1)) * 100).toFixed(0);

  if (snapshotQuery.isLoading) return <LoadingSkeleton variant="card" count={4} />;

  return (
    <div className="sr-page">
      <Link to="/research/snapshots" className="sr-back">← Back to Snapshots</Link>

      <header className="sr-header">
        <h1>⏮ Snapshot Replay</h1>
        <p className="sr-subtitle">{snapshot.symbol} · {snapshot.timeframe} · {totalCandles} candles</p>
      </header>

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
        <span>Candle {currentIdx + 1} / {totalCandles}</span>
        {currentCandle && <span>O: {currentCandle.open} H: {currentCandle.high} L: {currentCandle.low} C: {currentCandle.close}</span>}
      </div>

      {/* ── Chart + Directives ── */}
      <div className="sr-layout">
        <div className="sr-chart-wrap" ref={chartRef} />

        {directiveMode && (
          <div className="sr-directives">
            <h3>Active at candle {currentIdx + 1}</h3>
            {currentScores.map((d) => (
              <div key={d.id} className="sr-dir-row">
                <span className="sr-dir-name">{d.name}</span>
                <div className="sr-dir-bar-wrap">
                  <motion.div className="sr-dir-bar" animate={{ width: `${d.currentScore}%` }} transition={{ duration: 0.3 }}
                    style={{ background: d.currentScore >= 70 ? '#22c55e' : d.currentScore >= 40 ? '#f59e0b' : '#ef4444' }}
                  />
                </div>
                <span className="sr-dir-score" style={{ color: d.currentScore >= 70 ? '#22c55e' : d.currentScore >= 40 ? '#f59e0b' : '#ef4444' }}>
                  {d.currentScore}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Protocol Overlay Panel ── */}
      <div className="sr-protocol-panel">
        <h3>Protocol: Default Protocol</h3>
        <div className="sr-protocol-grid">
          <div className="sr-protocol-stat">
            <span className="sr-protocol-label">Signal</span>
            <motion.span
              key={currentSignal.signal + currentIdx}
              initial={{ scale: 1.3 }}
              animate={{ scale: 1 }}
              className={`sr-signal-badge ${currentSignal.signal}`}
            >
              {currentSignal.signal.toUpperCase()}
            </motion.span>
          </div>
          <div className="sr-protocol-stat">
            <span className="sr-protocol-label">Avg Score</span>
            <span className="sr-protocol-value">{currentSignal.avgScore}</span>
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
          {protocolSignals.slice(0, currentIdx + 1).map((s, i) => (
            <div
              key={i}
              className={`sr-signal-tick ${s.signal}`}
              title={`Candle ${i + 1}: ${s.signal} (${s.avgScore})`}
            />
          ))}
        </div>
      </div>

      {/* Notes */}
      {snapshot.notes && (
        <div className="sr-notes">
          <strong>📝 Notes</strong>
          <p>{snapshot.notes}</p>
        </div>
      )}
    </div>
  );
}
