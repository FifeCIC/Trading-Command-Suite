import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { createChart, CandlestickSeries, LineSeries } from 'lightweight-charts';

// ── Mock data generator ──
function generateMockCandles(count = 100) {
  const candles = [];
  let price = 100;
  let high = price;
  const atr = 1.2;

  for (let i = 0; i < count; i++) {
    const trend = 0.15 + Math.random() * 0.25; // upward bias
    const noise = (Math.random() - 0.3) * atr * 1.8;
    const change = trend + noise;
    const open = price;
    const close = price + change;
    const highC = Math.max(open, close) + Math.random() * atr * 0.5;
    const lowC = Math.min(open, close) - Math.random() * atr * 0.5;
    candles.push({
      time: i,
      open: +open.toFixed(2),
      high: +highC.toFixed(2),
      low: +lowC.toFixed(2),
      close: +close.toFixed(2),
    });
    if (close > high) high = close;
    price = close;
  }
  return { candles, atr, startPrice: candles[0].close };
}

// ── ATR calculation (simple: average true range) ──
function calcATR(candles, period = 14) {
  if (candles.length < period + 1) return 1;
  let sum = 0;
  for (let i = candles.length - period; i < candles.length; i++) {
    const c = candles[i];
    const prev = candles[i - 1];
    const tr = Math.max(c.high - c.low, Math.abs(c.high - prev.close), Math.abs(c.low - prev.close));
    sum += tr;
  }
  return +(sum / period).toFixed(2);
}

export default function TrailingStopDemo() {
  const chartRef = useRef(null);
  const chartInstance = useRef(null);
  const candleSeries = useRef(null);
  const stopLine = useRef(null);
  const entryMarker = useRef(null);
  const animFrame = useRef(null);

  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [currentIdx, setCurrentIdx] = useState(0);
  const [triggered, setTriggered] = useState(false);
  const [showATR, setShowATR] = useState(false);
  const [log, setLog] = useState([]);

  const data = useMemo(() => {
    const result = generateMockCandles(100);
    result.atr = calcATR(result.candles);
    return result;
  }, []);

  const entryPrice = data.startPrice;
  const currentCandle = data.candles[currentIdx] || data.candles[data.candles.length - 1];
  const currentPrice = currentCandle.close;

  // Highest high over trailing window
  const lookback = 14;
  const windowCandles = data.candles.slice(Math.max(0, currentIdx - lookback), currentIdx + 1);
  const highestHigh = Math.max(...windowCandles.map((c) => c.high));
  const stopLevel = +(highestHigh - 1.5 * data.atr).toFixed(2);

  // Check if stop hit
  const stopHit = currentCandle.low <= stopLevel && currentIdx > 0;

  // ── Chart setup ──
  useEffect(() => {
    if (!chartRef.current || chartInstance.current) return;
    const chart = createChart(chartRef.current, {
      width: chartRef.current.clientWidth,
      height: 340,
      layout: {
        background: { color: 'transparent' },
        textColor: '#94a3b8',
      },
      grid: {
        vertLines: { color: 'rgba(255,255,255,0.04)' },
        horzLines: { color: 'rgba(255,255,255,0.04)' },
      },
      crosshair: { mode: 0 },
      rightPriceScale: { borderColor: 'rgba(255,255,255,0.08)' },
      timeScale: { borderColor: 'rgba(255,255,255,0.08)', visible: false },
    });

    candleSeries.current = chart.addSeries(CandlestickSeries, {
      upColor: '#22c55e',
      downColor: '#ef4444',
      borderUpColor: '#22c55e',
      borderDownColor: '#ef4444',
      wickUpColor: '#22c55e',
      wickDownColor: '#ef4444',
    });

    // Entry marker
    entryMarker.current = chart.addSeries(LineSeries, {
      color: '#f59e0b',
      lineWidth: 1,
      lineStyle: 2,
      priceLineVisible: false,
      lastValueVisible: false,
    });

    // Stop line
    stopLine.current = chart.addSeries(LineSeries, {
      color: '#ef4444',
      lineWidth: 2,
      lineStyle: 2,
      priceLineVisible: false,
      lastValueVisible: false,
    });

    chartInstance.current = chart;

    const handleResize = () => {
      if (chartRef.current && chartInstance.current) {
        chartInstance.current.applyOptions({ width: chartRef.current.clientWidth });
      }
    };
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      chart.remove();
      chartInstance.current = null;
    };
  }, []);

  // ── Set chart data ──
  useEffect(() => {
    if (!candleSeries.current || !entryMarker.current || !stopLine.current) return;
    candleSeries.current.setData(data.candles);

    // Entry line across all visible
    const entryData = data.candles.map((c) => ({ time: c.time, value: entryPrice }));
    entryMarker.current.setData(entryData);

    // Initial stop
    const initialStop = data.candles.map((c) => ({ time: c.time, value: +(entryPrice - 1.5 * data.atr).toFixed(2) }));
    stopLine.current.setData(initialStop);
  }, [data]);

  // ── Animation loop ──
  const advanceTick = useCallback(() => {
    setCurrentIdx((prev) => {
      const next = prev + 1;
      if (next >= data.candles.length) {
        setPlaying(false);
        return prev;
      }
      return next;
    });
  }, [data.candles.length]);

  useEffect(() => {
    if (!playing || triggered) return;
    const interval = Math.max(30, 500 / speed);
    animFrame.current = setInterval(advanceTick, interval);
    return () => clearInterval(animFrame.current);
  }, [playing, speed, triggered, advanceTick]);

  // ── Update stop line visually ──
  useEffect(() => {
    if (!stopLine.current) return;
    const stopData = [];
    for (let i = 0; i <= currentIdx; i++) {
      const win = data.candles.slice(Math.max(0, i - lookback), i + 1);
      const hh = Math.max(...win.map((c) => c.high));
      stopData.push({ time: data.candles[i].time, value: +(hh - 1.5 * data.atr).toFixed(2) });
    }
    stopLine.current.setData(stopData);

    // Log stop adjustments
    if (stopData.length >= 2) {
      const prev = stopData[stopData.length - 2];
      const curr = stopData[stopData.length - 1];
      if (curr.value > prev.value) {
        setLog((l) => [{ idx: currentIdx, price: currentPrice, stop: curr.value, time: currentCandle.time }, ...l].slice(0, 10));
      }
    }
  }, [currentIdx]);

  // ── Stop hit detection ──
  useEffect(() => {
    if (stopHit && !triggered) {
      setTriggered(true);
      setPlaying(false);
      if (animFrame.current) clearInterval(animFrame.current);
    }
  }, [stopHit, triggered]);

  function handleReset() {
    setPlaying(false);
    setCurrentIdx(0);
    setTriggered(false);
    setLog([]);
  }

  function handleTogglePlay() {
    if (triggered) return;
    setPlaying((p) => !p);
  }

  const progressPct = ((currentIdx / (data.candles.length - 1)) * 100).toFixed(0);

  return (
    <div>
      {/* Chart */}
      <div
        ref={chartRef}
        style={{ width: '100%', borderRadius: 8, overflow: 'hidden', background: 'rgba(0,0,0,0.15)', border: '1px solid var(--line, #1e2a45)' }}
      />

      {/* Controls */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
        <button
          type="button"
          onClick={handleTogglePlay}
          disabled={triggered}
          style={{
            padding: '6px 16px', borderRadius: 6, border: 'none', cursor: triggered ? 'default' : 'pointer',
            background: 'var(--accent, #0ea5a6)', color: '#fff', fontFamily: 'inherit', fontSize: 13, fontWeight: 600, opacity: triggered ? 0.5 : 1,
          }}
        >
          {triggered ? '⏹ STOPPED' : playing ? '⏸ Pause' : '▶ Play'}
        </button>
        {[1, 5, 20].map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setSpeed(s)}
            style={{
              padding: '4px 10px', borderRadius: 4, border: `1px solid ${speed === s ? 'var(--accent, #0ea5a6)' : 'var(--line, #1e2a45)'}`,
              background: speed === s ? 'rgba(14,165,166,0.15)' : 'transparent', color: speed === s ? 'var(--accent, #0ea5a6)' : 'var(--ink-soft, #94a3b8)',
              cursor: 'pointer', fontFamily: 'inherit', fontSize: 12,
            }}
          >
            {s}×
          </button>
        ))}
        <button type="button" onClick={handleReset} style={{ padding: '4px 10px', borderRadius: 4, border: '1px solid var(--line, #1e2a45)', background: 'transparent', color: 'var(--ink-soft, #94a3b8)', cursor: 'pointer', fontFamily: 'inherit', fontSize: 12 }}>↺ Reset</button>
        <label style={{ fontSize: 12, color: 'var(--ink-soft, #94a3b8)', display: 'flex', alignItems: 'center', gap: 4, marginLeft: 4 }}>
          <input type="checkbox" checked={showATR} onChange={(e) => setShowATR(e.target.checked)} />
          Show ATR
        </label>
        <span style={{ fontSize: 12, color: 'var(--ink-soft, #94a3b8)', marginLeft: 'auto' }}>
          Bar {currentIdx}/{data.candles.length - 1} ({progressPct}%)
        </span>
      </div>

      {/* Triggered overlay */}
      <AnimatePresence>
        {triggered && (
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            style={{ marginTop: 10, padding: '10px 16px', borderRadius: 8, background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.3)', textAlign: 'center' }}
          >
            <strong style={{ color: '#ef4444', fontSize: 14 }}>🛑 STOP TRIGGERED</strong>
            <span style={{ display: 'block', fontSize: 12, color: 'var(--ink-soft, #94a3b8)', marginTop: 2 }}>
              Price dropped to ${stopLevel} — trailing stop executed at bar {currentIdx}
            </span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Info panel */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 8, marginTop: 10 }}>
        <InfoCard label="Entry Price" value={`$${entryPrice.toFixed(2)}`} color="var(--accent, #0ea5a6)" />
        <InfoCard label="Current Price" value={`$${currentPrice.toFixed(2)}`} color={currentPrice >= entryPrice ? '#22c55e' : '#ef4444'} />
        <InfoCard label="Stop Level" value={`$${stopLevel.toFixed(2)}`} color="#ef4444" />
        <InfoCard label="Stop Distance" value={`$${(currentPrice - stopLevel).toFixed(2)} (${(((currentPrice - stopLevel) / currentPrice) * 100).toFixed(1)}%)`} color="#f59e0b" />
        {showATR && <InfoCard label="14-Bar ATR" value={`$${data.atr.toFixed(2)}`} color="var(--ink-soft, #94a3b8)" />}
        <InfoCard label="Highest High (14)" value={`$${highestHigh.toFixed(2)}`} color="var(--ink-soft, #94a3b8)" />
      </div>

      {/* Math breakdown */}
      <div style={{ marginTop: 10, padding: '8px 12px', borderRadius: 6, background: 'rgba(0,0,0,0.1)', border: '1px solid var(--line, #1e2a45)', fontSize: 12, color: 'var(--ink-soft, #94a3b8)', fontFamily: 'monospace' }}>
        Stop = Highest High({lookback}) − 1.5 × ATR({data.atr.toFixed(2)}) = ${highestHigh.toFixed(2)} − ${(1.5 * data.atr).toFixed(2)} = <strong style={{ color: '#ef4444' }}>${stopLevel.toFixed(2)}</strong>
      </div>

      {/* Trailing log */}
      {log.length > 0 && (
        <div style={{ marginTop: 10 }}>
          <h4 style={{ fontSize: 12, color: 'var(--ink-soft, #94a3b8)', margin: '0 0 4px' }}>Stop Adjustments</h4>
          <div style={{ maxHeight: 140, overflowY: 'auto', fontSize: 11, fontFamily: 'monospace', color: 'var(--ink-soft, #94a3b8)' }}>
            {log.map((entry, i) => (
              <div key={i} style={{ padding: '2px 0', borderBottom: '1px solid rgba(255,255,255,0.03)' }}>
                Bar {entry.idx}: Price ${entry.price.toFixed(2)} → Stop raised to <span style={{ color: '#ef4444' }}>${entry.stop.toFixed(2)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function InfoCard({ label, value, color }) {
  return (
    <div style={{ padding: '6px 10px', borderRadius: 6, background: 'rgba(0,0,0,0.1)', border: '1px solid var(--line, #1e2a45)' }}>
      <div style={{ fontSize: 10, color: 'var(--ink-soft, #94a3b8)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>{label}</div>
      <div style={{ fontSize: 14, fontWeight: 700, color, marginTop: 2 }}>{value}</div>
    </div>
  );
}
