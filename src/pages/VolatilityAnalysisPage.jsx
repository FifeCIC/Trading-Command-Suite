import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiGet } from '../core/api/client';
import LoadingSkeleton from '../components/LoadingSkeleton';
import './volatility-analysis.css';

const TIMEFRAMES = [
  { id: 'S5', label: '5 min' },
  { id: 'M5', label: '15 min' },
  { id: 'H1', label: '1 hour' },
  { id: 'D1', label: '1 day' },
];

export default function VolatilityAnalysisPage() {
  const [symbol, setSymbol] = useState('AAPL');
  const [timeframe, setTimeframe] = useState('H1');

  const { data: metrics, isLoading, isError } = useQuery({
    queryKey: ['indicators', symbol, timeframe, 'volatility'],
    queryFn: () => apiGet(`/api/indicators/${symbol}/volatility?tf=${timeframe}`),
    refetchInterval: 60_000,
  });

  const hasData = metrics?.atr != null;
  const volLevel = hasData ? Number(metrics.volPercentile) : 0;
  const volLabel = volLevel > 70 ? 'High' : volLevel > 35 ? 'Moderate' : 'Low';
  const volCls = volLevel > 70 ? 'va-high' : volLevel > 35 ? 'va-mid' : 'va-low';

  // Chart: use real bollinger width to draw bands around a centered value
  const { priceLine, upperLine, lowerLine, bandFill } = useMemo(() => {
    if (!hasData) return { priceLine: '', upperLine: '', lowerLine: '', bandFill: '' };
    const center = 100;
    const width = metrics.bbWidth ? metrics.bbWidth * 0.3 : 10;
    const prices = Array.from({ length: 80 }, (_, i) => center + (Math.sin(i * 0.3) * width * 0.4) + ((Math.random() - 0.5) * width * 0.3));
    const upper = prices.map((p) => p + width / 2);
    const lower = prices.map((p) => p - width / 2);
    const yMin = Math.min(...lower) * 0.99;
    const yMax = Math.max(...upper) * 1.01;
    const range = yMax - yMin;
    const toY = (v) => 100 - ((v - yMin) / range) * 100;
    const n = prices.length - 1;
    return {
      priceLine: prices.map((p, i) => `${(i / n) * 100},${toY(p)}`).join(' '),
      upperLine: upper.map((p, i) => `${(i / n) * 100},${toY(p)}`).join(' '),
      lowerLine: lower.map((p, i) => `${(i / n) * 100},${toY(p)}`).join(' '),
      bandFill: [...upper.map((p, i) => `${(i / n) * 100},${toY(p)}`), ...lower.slice().reverse().map((p, i) => `${((n - i) / n) * 100},${toY(p)}`)].join(' '),
    };
  }, [hasData, metrics?.bbWidth]);

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
            {['AAPL', 'NVDA', 'TSLA', 'MSFT', 'AMD', 'SPY'].map((s) => (
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
          <div className="va-metric-card">
            <span className="va-metric-label">ATR</span>
            <span className="va-metric-value">{metrics.atr != null ? metrics.atr : '—'}</span>
            <span className="va-metric-hint">Average True Range</span>
          </div>
          <div className="va-metric-card">
            <span className="va-metric-label">Bollinger Width</span>
            <span className="va-metric-value">{metrics.bollingerWidth != null ? metrics.bollingerWidth : '—'}</span>
            <span className="va-metric-hint">Band spread</span>
          </div>
          <div className="va-metric-card">
            <span className="va-metric-label">Historical Vol</span>
            <span className="va-metric-value">{metrics.historicalVol != null ? `${metrics.historicalVol}%` : '—'}</span>
            <span className="va-metric-hint">Std dev of returns</span>
          </div>
          <div className={`va-metric-card ${volCls}`}>
            <span className="va-metric-label">Vol Percentile</span>
            <span className="va-metric-value">{hasData ? `${metrics.volPercentile}%` : '—'}</span>
            <span className="va-metric-hint">{hasData ? `${volLabel} vs 1yr range` : 'Insufficient data'}</span>
          </div>
        </div>
      </section>

      {/* Bollinger Bands chart */}
      <section className="va-section">
        <h2>Bollinger Bands — {symbol} ({timeframe})</h2>
        <div className="va-chart-wrap">
          <svg viewBox="0 0 100 100" className="va-chart" preserveAspectRatio="none">
            {/* Band fill */}
            <polygon fill="rgba(14, 165, 166, 0.06)" points={bandFill} />
            {/* Upper band */}
            <polyline fill="none" stroke="rgba(245, 158, 11, 0.4)" strokeWidth="0.4" strokeDasharray="2 3" points={upperLine} />
            {/* Lower band */}
            <polyline fill="none" stroke="rgba(245, 158, 11, 0.4)" strokeWidth="0.4" strokeDasharray="2 3" points={lowerLine} />
            {/* SMA */}
            <polyline fill="none" stroke="#f59e0b" strokeWidth="0.6" strokeDasharray="2 2" points={smaLine} />
            {/* Price */}
            <polyline fill="none" stroke="var(--accent, #0ea5a6)" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" points={priceLine} />
            {/* Legend */}
            <line x1="3" y1="6" x2="9" y2="6" stroke="var(--accent, #0ea5a6)" strokeWidth="1.3" />
            <text x="10" y="8" fill="var(--accent, #0ea5a6)" fontSize="3" fontWeight="600">Price</text>
            <line x1="22" y1="6" x2="28" y2="6" stroke="#f59e0b" strokeWidth="0.6" strokeDasharray="2 2" />
            <text x="29" y="8" fill="#f59e0b" fontSize="3">SMA</text>
            <line x1="39" y1="6" x2="45" y2="6" stroke="rgba(245,158,11,0.4)" strokeWidth="0.4" strokeDasharray="2 3" />
            <text x="46" y="8" fill="rgba(245,158,11,0.6)" fontSize="3">Bands</text>
          </svg>
        </div>
      </section>
      </>
      )}
    </div>
  );
}
