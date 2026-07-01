import { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { motion } from 'motion/react';
import { createChart, CandlestickSeries, LineSeries } from 'lightweight-charts';
import './chart-comparison.css';

const SYMBOLS = ['AAPL', 'NVDA', 'TSLA', 'MSFT', 'AMD', 'SPY'];
const TIMEFRAMES = [
  { value: '1H', label: '1 Hour' },
  { value: '4H', label: '4 Hours' },
  { value: '1D', label: '1 Day' },
  { value: '1W', label: '1 Week' },
];

const PROTOCOLS = [
  { id: 'a', name: 'Protocol A — Trend Following', color: '#0ea5a6' },
  { id: 'b', name: 'Protocol B — Mean Reversion', color: '#f59e0b' },
];

function generateMockBars(count = 120) {
  let price = 100 + Math.random() * 50;
  const bars = [];
  const baseTime = new Date('2026-06-01').getTime();
  for (let i = 0; i < count; i++) {
    const time = baseTime + i * 3600_000;
    const volatility = price * 0.015;
    const open = price;
    const close = open + (Math.random() - 0.48) * volatility * 2;
    const high = Math.max(open, close) + Math.random() * volatility;
    const low = Math.min(open, close) - Math.random() * volatility;
    bars.push({ time: time / 1000, open, high, low, close });
    price = close;
  }
  return bars;
}

export default function ChartComparisonPage() {
  const [symbolA, setSymbolA] = useState('NVDA');
  const [symbolB, setSymbolB] = useState('AMD');
  const [timeframe, setTimeframe] = useState('1H');
  const [protocolA, setProtocolA] = useState('a');
  const [protocolB, setProtocolB] = useState('b');
  const [synced, setSynced] = useState(true);

  const chartARef = useRef(null);
  const chartBRef = useRef(null);
  const chartAInstance = useRef(null);
  const chartBInstance = useRef(null);

  const barsA = useMemo(() => generateMockBars(120), [symbolA]);
  const barsB = useMemo(() => generateMockBars(120), [symbolB]);

  const mountChart = useCallback((ref, instanceRef, bars, protocolColor) => {
    if (!ref.current) return;
    if (instanceRef.current) {
      instanceRef.current.remove();
    }

    const chart = createChart(ref.current, {
      width: ref.current.clientWidth,
      height: 380,
      layout: {
        background: { color: 'transparent' },
        textColor: '#94a3b8',
      },
      grid: {
        vertLines: { color: 'rgba(128,128,128,0.08)' },
        horzLines: { color: 'rgba(128,128,128,0.08)' },
      },
      crosshair: { mode: 0 },
      rightPriceScale: { borderColor: 'rgba(128,128,128,0.15)' },
      timeScale: { borderColor: 'rgba(128,128,128,0.15)', timeVisible: true },
    });

    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: '#22c55e',
      downColor: '#ef4444',
      borderUpColor: '#22c55e',
      borderDownColor: '#ef4444',
      wickUpColor: '#22c55e',
      wickDownColor: '#ef4444',
    });
    candleSeries.setData(bars);

    // Protocol marker line
    const midPrice = bars[Math.floor(bars.length / 2)]?.close || 100;
    chart.addSeries(LineSeries, {
      color: protocolColor,
      lineWidth: 1,
      lineStyle: 2,
      priceLineVisible: false,
      lastValueVisible: false,
    }).setData([
      { time: bars[0].time, value: midPrice * 1.03 },
      { time: bars[bars.length - 1].time, value: midPrice * 1.03 },
    ]);

    chart.timeScale().fitContent();
    instanceRef.current = chart;
  }, []);

  useEffect(() => {
    mountChart(chartARef, chartAInstance, barsA, PROTOCOLS.find(p => p.id === protocolA)?.color || '#0ea5a6');
  }, [barsA, protocolA, mountChart]);

  useEffect(() => {
    mountChart(chartBRef, chartBInstance, barsB, PROTOCOLS.find(p => p.id === protocolB)?.color || '#f59e0b');
  }, [barsB, protocolB, mountChart]);

  useEffect(() => {
    return () => {
      chartAInstance.current?.remove();
      chartBInstance.current?.remove();
    };
  }, []);

  return (
    <div className="cc-page">
      <header className="cc-header">
        <div>
          <h1>Chart Comparison</h1>
          <p className="cc-subtitle">Dual synced lightweight-charts — Protocol A vs B comparison</p>
        </div>
        <label className="cc-sync-toggle">
          <input type="checkbox" checked={synced} onChange={e => setSynced(e.target.checked)} />
          <span>Sync crosshair</span>
        </label>
      </header>

      <div className="cc-controls">
        <div className="cc-control-group">
          <label>Chart A — Symbol</label>
          <select value={symbolA} onChange={e => setSymbolA(e.target.value)}>
            {SYMBOLS.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          <select value={protocolA} onChange={e => setProtocolA(e.target.value)}>
            {PROTOCOLS.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>
        <div className="cc-control-group">
          <label>Timeframe</label>
          <select value={timeframe} onChange={e => setTimeframe(e.target.value)}>
            {TIMEFRAMES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
        </div>
        <div className="cc-control-group">
          <label>Chart B — Symbol</label>
          <select value={symbolB} onChange={e => setSymbolB(e.target.value)}>
            {SYMBOLS.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          <select value={protocolB} onChange={e => setProtocolB(e.target.value)}>
            {PROTOCOLS.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>
      </div>

      <div className="cc-dual-grid">
        <div className="cc-panel">
          <div className="cc-panel-label">
            <span className="cc-dot" style={{ background: PROTOCOLS.find(p => p.id === protocolA)?.color }} />
            {symbolA} — {PROTOCOLS.find(p => p.id === protocolA)?.name}
          </div>
          <div ref={chartARef} className="cc-chart-container" />
        </div>
        <div className="cc-panel">
          <div className="cc-panel-label">
            <span className="cc-dot" style={{ background: PROTOCOLS.find(p => p.id === protocolB)?.color }} />
            {symbolB} — {PROTOCOLS.find(p => p.id === protocolB)?.name}
          </div>
          <div ref={chartBRef} className="cc-chart-container" />
        </div>
      </div>

      <div className="cc-metrics-bar">
        <motion.div className="cc-metric-card" whileHover={{ y: -2 }}>
          <span className="cc-metric-label">Protocol A Signal</span>
          <span className="cc-metric-value buy">BUY {symbolA}</span>
        </motion.div>
        <motion.div className="cc-metric-card" whileHover={{ y: -2 }}>
          <span className="cc-metric-label">Protocol B Signal</span>
          <span className="cc-metric-value sell">SELL {symbolB}</span>
        </motion.div>
        <motion.div className="cc-metric-card" whileHover={{ y: -2 }}>
          <span className="cc-metric-label">Divergence</span>
          <span className="cc-metric-value div">OPPOSITE</span>
        </motion.div>
        <motion.div className="cc-metric-card" whileHover={{ y: -2 }}>
          <span className="cc-metric-label">Library</span>
          <span className="cc-metric-value">lightweight-charts 5.x</span>
        </motion.div>
      </div>
    </div>
  );
}
