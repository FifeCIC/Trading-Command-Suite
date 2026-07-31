/**
 * ChartComparisonPage — Real Protocol A/B Testing
 * ================================================
 * Dual synced lightweight-charts with real MT5 candlesticks
 * and real SEES protocol scores. Replaces mock data.
 * Route: /analysis/chart-comparison
 */
import { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { motion } from 'motion/react';
import { useQuery } from '@tanstack/react-query';
import { createChart, CandlestickSeries, LineSeries } from 'lightweight-charts';
import { apiGet } from '../core/api/client';
import LoadingSkeleton from '../components/LoadingSkeleton';
import ApiOfflineBanner from '../components/ApiOfflineBanner';
import './chart-comparison.css';
import PageInfoPopover from '../components/PageInfoPopover';

const SYMBOLS = ['AAPL', 'NVDA', 'TSLA', 'MSFT', 'AMD', 'SPY', 'QQQ', 'GOOGL', 'META', 'AMZN'];
const TIMEFRAMES = [
  { value: '1h', label: '1 Hour' },
  { value: '4h', label: '4 Hours' },
  { value: '1d', label: '1 Day' },
  { value: '1w', label: '1 Week' },
];
const LIMIT = 120;

function mapCandles(bars) {
  if (!Array.isArray(bars)) return [];
  return bars.map(b => ({
    time: new Date(b.timestamp).getTime() / 1000,
    open: b.open, high: b.high, low: b.low, close: b.close,
  })).sort((a, b) => a.time - b.time);
}

function ScoreOverlay({ data, symbol }) {
  if (!data) return null;
  const ranked = Array.isArray(data?.ranked) ? data.ranked : [];
  const sym = ranked.find(r => r.ticker === symbol);
  if (!sym) return <span className="cc-score-none">—</span>;

  const sig = sym.signal;
  const color = sig === 'entry' ? '#22c55e' : sig === 'watch' ? '#f59e0b' : sig === 'defensive' ? '#94a3b8' : '#ef4444';

  return (
    <div className="cc-score-row">
      <span className="cc-score-val" style={{ color }}>{sym.normalizedScore.toFixed(0)}%</span>
      <span className="cc-score-sig" style={{ color }}>{sig}</span>
      <span className="cc-score-dirs">{sym.activeDirectives}/{sym.totalDirectives} directives</span>
    </div>
  );
}

export default function ChartComparisonPage() {
  const [symbolA, setSymbolA] = useState('NVDA');
  const [symbolB, setSymbolB] = useState('AMD');
  const [timeframe, setTimeframe] = useState('1h');

  const chartARef = useRef(null);
  const chartBRef = useRef(null);
  const chartAInstance = useRef(null);
  const chartBInstance = useRef(null);

  const candlesA = useQuery({
    queryKey: ['chart-candles', symbolA, timeframe],
    queryFn: () => apiGet(`/api/trading/mt5/candles?symbol=${symbolA}&timeframe=${timeframe}&limit=${LIMIT}`),
    refetchOnWindowFocus: false,
  });
  const candlesB = useQuery({
    queryKey: ['chart-candles', symbolB, timeframe],
    queryFn: () => apiGet(`/api/trading/mt5/candles?symbol=${symbolB}&timeframe=${timeframe}&limit=${LIMIT}`),
    refetchOnWindowFocus: false,
  });

  const scores = useQuery({
    queryKey: ['chart-scores', symbolA, symbolB],
    queryFn: () => apiGet('/api/scoring/ranked?limit=50'),
    refetchInterval: 120_000,
  });

  const barsA = useMemo(() => mapCandles(candlesA.data?.bars), [candlesA.data]);
  const barsB = useMemo(() => mapCandles(candlesB.data?.bars), [candlesB.data]);

  const mountChart = useCallback((ref, instanceRef, bars) => {
    if (!ref.current || bars.length === 0) return;
    if (instanceRef.current) instanceRef.current.remove();

    const chart = createChart(ref.current, {
      width: ref.current.clientWidth,
      height: 380,
      layout: { background: { color: 'transparent' }, textColor: '#94a3b8' },
      grid: { vertLines: { color: 'rgba(128,128,128,0.08)' }, horzLines: { color: 'rgba(128,128,128,0.08)' } },
      crosshair: { mode: 0 },
      rightPriceScale: { borderColor: 'rgba(128,128,128,0.15)' },
      timeScale: { borderColor: 'rgba(128,128,128,0.15)', timeVisible: true },
    });

    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: '#22c55e', downColor: '#ef4444',
      borderUpColor: '#22c55e', borderDownColor: '#ef4444',
      wickUpColor: '#22c55e', wickDownColor: '#ef4444',
    });
    candleSeries.setData(bars);
    chart.timeScale().fitContent();
    instanceRef.current = chart;
  }, []);

  useEffect(() => { mountChart(chartARef, chartAInstance, barsA); }, [barsA, mountChart]);
  useEffect(() => { mountChart(chartBRef, chartBInstance, barsB); }, [barsB, mountChart]);

  useEffect(() => {
    return () => { chartAInstance.current?.remove(); chartBInstance.current?.remove(); };
  }, []);

  const loading = candlesA.isLoading || candlesB.isLoading || scores.isLoading;
  const error = candlesA.isError || candlesB.isError || scores.isError;

  return (
    <div className="cc-page">
      <header className="cc-header">
        <div>
          <h1>Chart Comparison
          <PageInfoPopover>
            Real MT5 candlesticks + SEES protocol scores — A/B comparison
          </PageInfoPopover>
        </h1>
        </div>
      </header>

      <div className="cc-controls">
        <div className="cc-control-group">
          <label>Chart A — Symbol</label>
          <select value={symbolA} onChange={e => setSymbolA(e.target.value)}>
            {SYMBOLS.map(s => <option key={s} value={s}>{s}</option>)}
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
        </div>
      </div>

      {error && <ApiOfflineBanner />}

      {loading ? (
        <LoadingSkeleton variant="chart" count={2} />
      ) : (
        <div className="cc-dual-grid">
          <motion.div className="cc-panel" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
            <div className="cc-panel-label">
              <span className="cc-dot" style={{ background: '#0ea5a6' }} />
              {symbolA} — {barsA.length} candles
              <ScoreOverlay data={scores.data} symbol={symbolA} />
            </div>
            <div ref={chartARef} className="cc-chart-container" />
          </motion.div>
          <motion.div className="cc-panel" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.05 }}>
            <div className="cc-panel-label">
              <span className="cc-dot" style={{ background: '#f59e0b' }} />
              {symbolB} — {barsB.length} candles
              <ScoreOverlay data={scores.data} symbol={symbolB} />
            </div>
            <div ref={chartBRef} className="cc-chart-container" />
          </motion.div>
        </div>
      )}

      {scores.data && (
        <motion.div className="cc-metrics-bar" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.1 }}>
          <div className="cc-metric-card">
            <span className="cc-metric-label">{symbolA} Score</span>
            <span className="cc-metric-value" style={{ color: '#0ea5a6' }}>
              {(() => { const s = (scores.data.ranked || []).find(r => r.ticker === symbolA); return s ? s.normalizedScore.toFixed(0) + '% (' + s.signal + ')' : '—'; })()}
            </span>
          </div>
          <div className="cc-metric-card">
            <span className="cc-metric-label">{symbolB} Score</span>
            <span className="cc-metric-value" style={{ color: '#f59e0b' }}>
              {(() => { const s = (scores.data.ranked || []).find(r => r.ticker === symbolB); return s ? s.normalizedScore.toFixed(0) + '% (' + s.signal + ')' : '—'; })()}
            </span>
          </div>
          <div className="cc-metric-card">
            <span className="cc-metric-label">Data Source</span>
            <span className="cc-metric-value">MT5 Bridge — real {timeframe} candles</span>
          </div>
          <div className="cc-metric-card">
            <span className="cc-metric-label">Scored Symbols</span>
            <span className="cc-metric-value">{scores.data?.ranked?.length || 0} total</span>
          </div>
        </motion.div>
      )}
    </div>
  );
}
