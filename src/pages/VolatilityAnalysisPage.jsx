import { useState, useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { createChart, CandlestickSeries, LineSeries } from 'lightweight-charts';
import { apiGet } from '../core/api/client';
import LoadingSkeleton from '../components/LoadingSkeleton';
import './volatility-analysis.css';

const TIMEFRAMES = [
  { id: 'S5', label: '5 min' },
  { id: 'M5', label: '15 min' },
  { id: 'H1', label: '1 hour' },
  { id: 'D1', label: '1 day' },
];

const DEFAULT_SYMBOLS = ['SPY', 'QQQ', 'AAPL', 'NVDA', 'TSLA', 'XAUUSD', 'EURUSD', 'BTCUSD', 'USOIL'];

function VaChart({ metrics, bars }) {
  const containerRef = useRef(null);
  const chartRef = useRef(null);

  useEffect(() => {
    if (!containerRef.current || !bars?.length) return;

    const chart = createChart(containerRef.current, {
      height: 400,
      layout: {
        background: { color: 'transparent' },
        textColor: 'var(--ink-soft, #94a3b8)',
        fontSize: 11,
      },
      grid: {
        vertLines: { color: 'rgba(148,163,184,0.08)' },
        horzLines: { color: 'rgba(148,163,184,0.08)' },
      },
      crosshair: { mode: 0 },
      timeScale: { borderColor: 'rgba(148,163,184,0.12)' },
      rightPriceScale: { borderColor: 'rgba(148,163,184,0.12)' },
    });

    chartRef.current = chart;

    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: '#22c55e',
      downColor: '#ef4444',
      borderUpColor: '#22c55e',
      borderDownColor: '#ef4444',
      wickUpColor: '#22c55e',
      wickDownColor: '#ef4444',
    });
    candleSeries.setData(bars);

    // Bollinger Bands overlay if bbWidth available
    if (metrics?.bbWidth != null && bars.length >= 20) {
      const closes = bars.map((b) => b.close);
      const sma20 = closes.slice(-20).reduce((a, v) => a + v, 0) / 20;
      const std20 = Math.sqrt(closes.slice(-20).reduce((a, v) => a + (v - sma20) ** 2, 0) / 20);

      // Middle band
      const midSeries = chart.addSeries(LineSeries, {
        color: '#f59e0b',
        lineWidth: 1,
        priceLineVisible: false,
        lastValueVisible: false,
      });
      midSeries.setData(bars.map((b) => ({ time: b.time, value: sma20 })));

      // Upper band
      const upperSeries = chart.addSeries(LineSeries, {
        color: '#ef444466',
        lineWidth: 1,
        priceLineVisible: false,
        lastValueVisible: false,
      });
      upperSeries.setData(bars.map((b) => ({ time: b.time, value: sma20 + 2 * std20 })));

      // Lower band
      const lowerSeries = chart.addSeries(LineSeries, {
        color: '#22c55e66',
        lineWidth: 1,
        priceLineVisible: false,
        lastValueVisible: false,
      });
      lowerSeries.setData(bars.map((b) => ({ time: b.time, value: sma20 - 2 * std20 })));
    }

    chart.timeScale().fitContent();

    return () => {
      chart.remove();
      chartRef.current = null;
    };
  }, [bars, metrics]);

  return <div ref={containerRef} className="va-chart-container" />;
}

export default function VolatilityAnalysisPage() {
  const [symbol, setSymbol] = useState('SPY');
  const [timeframe, setTimeframe] = useState('H1');
  const [symbols, setSymbols] = useState(DEFAULT_SYMBOLS);

  useEffect(() => {
    apiGet('/api/watchlists').then((data) => {
      const lists = Array.isArray(data?.watchlists) ? data.watchlists : [];
      const defaultList = lists.find((l) => l.isDefault) || lists[0];
      const wlSymbols = Array.isArray(defaultList?.symbols)
        ? defaultList.symbols.map((s) => (typeof s === 'string' ? s : s.ticker).toUpperCase())
        : [];
      if (wlSymbols.length > 0) setSymbols(wlSymbols);
    }).catch(() => {});
  }, []);

  const { data: metrics, isLoading, isError } = useQuery({
    queryKey: ['indicators', symbol, timeframe, 'volatility'],
    queryFn: () => apiGet(`/api/indicators/${symbol}/volatility?tf=${timeframe}`),
    refetchInterval: 60_000,
  });

  const hasData = metrics?.atr != null;
  const volLevel = hasData ? Number(metrics.volPercentile) : 0;
  const volLabel = volLevel > 70 ? 'High' : volLevel > 35 ? 'Moderate' : 'Low';
  const volCls = volLevel > 70 ? 'va-high' : volLevel > 35 ? 'va-mid' : 'va-low';

  return (
    <div className="va-page">
      <header className="va-header">
        <h1>Volatility Analysis</h1>
        <p className="va-subtitle">
          ATR, Bollinger Bands, historical volatility, and multi-timeframe metrics.
        </p>
      </header>

      {/* Controls */}
      <div className="va-controls">
        <div className="va-field">
          <label>Symbol</label>
          <select value={symbol} onChange={(e) => setSymbol(e.target.value)}>
            {symbols.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </div>
        <div className="va-field">
          <label>Timeframe</label>
          <div className="va-tf-tabs">
            {TIMEFRAMES.map((tf) => (
              <button
                key={tf.id}
                type="button"
                className={`va-tf-tab ${timeframe === tf.id ? 'va-tf-active' : ''}`}
                onClick={() => setTimeframe(tf.id)}
              >
                {tf.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {isLoading && <LoadingSkeleton variant="card" count={3} />}

      {isError && (
        <div className="va-section"><p className="error">Could not load volatility data. Is the NestJS API running?</p></div>
      )}

      {!isLoading && !isError && !hasData && (
        <div className="va-section"><p className="va-subtitle">No OHLCV data available for {symbol} on {timeframe}. Try another symbol or import market data first.</p></div>
      )}

      {!isLoading && !isError && hasData && (
      <>
      {/* Key metrics */}
      <section className="va-section">
        <h2>Key Metrics — {symbol}</h2>
        <div className="va-metrics-grid">
          <div className={`va-metric-card ${volCls}`}>
            <span className="va-metric-label">Volatility Regime</span>
            <span className="va-metric-value">{volLabel}</span>
            <span className="va-metric-sub">{volLevel}th percentile</span>
          </div>
          <div className="va-metric-card">
            <span className="va-metric-label">ATR (14)</span>
            <span className="va-metric-value">{metrics.atr}</span>
            <span className="va-metric-sub">Average True Range</span>
          </div>
          <div className="va-metric-card">
            <span className="va-metric-label">Bollinger Width</span>
            <span className="va-metric-value">{metrics.bbWidth}</span>
            <span className="va-metric-sub">20-period, 2σ bands</span>
          </div>
          <div className="va-metric-card">
            <span className="va-metric-label">Historical Vol</span>
            <span className="va-metric-value">{metrics.histVol != null ? `${metrics.histVol}%` : '—'}</span>
            <span className="va-metric-sub">Annualised (252d)</span>
          </div>
        </div>
      </section>

      {/* Chart with Bollinger Bands */}
      <section className="va-section">
        <h2>Price & Bollinger Bands — {symbol} ({TIMEFRAMES.find((t) => t.id === timeframe)?.label})</h2>
        <VaChart metrics={metrics} bars={metrics.bars} />
      </section>
      </>
      )}
    </div>
  );
}
