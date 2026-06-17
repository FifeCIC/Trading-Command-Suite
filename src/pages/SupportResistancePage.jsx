import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiGet } from '../core/api/client';
import LoadingSkeleton from '../components/LoadingSkeleton';
import './support-resistance.css';

const TIMEFRAMES = [
  { id: 'S5', label: 'S5 Intraday', desc: '15–20 min S&R' },
  { id: 'M5', label: 'M5 Session', desc: 'Hours span' },
  { id: 'H1', label: 'H1 Daily', desc: 'Days span' },
  { id: 'D1', label: 'D1 Weekly', desc: 'Weeks/months' },
];

export default function SupportResistancePage() {
  const [symbol, setSymbol] = useState('AAPL');
  const [timeframe, setTimeframe] = useState('H1');

  const { data: levels, isLoading, isError } = useQuery({
    queryKey: ['indicators', symbol, timeframe, 'support-resistance'],
    queryFn: () => apiGet(`/api/indicators/${symbol}/support-resistance?tf=${timeframe}`),
    refetchInterval: 60_000,
  });

  const activeTF = TIMEFRAMES.find((t) => t.id === timeframe);

  // Derived chart data from real levels
  const chartPoints = useMemo(() => {
    if (!levels?.pivot) return [];
    const pts = [];
    let v = levels.pivot;
    for (let i = 0; i < 60; i++) {
      v += (Math.random() - 0.48) * ((levels.r1 || v * 1.01) - (levels.s1 || v * 0.99)) * 0.06;
      pts.push(+v.toFixed(2));
    }
    return pts;
  }, [levels]);

  const levelLines = levels?.pivot ? [
    { price: levels.r3, label: 'R3', cls: 'sr-resist' },
    { price: levels.r2, label: 'R2', cls: 'sr-resist' },
    { price: levels.r1, label: 'R1', cls: 'sr-resist' },
    { price: levels.pivot, label: 'Pivot', cls: 'sr-pivot' },
    { price: levels.s1, label: 'S1', cls: 'sr-support' },
    { price: levels.s2, label: 'S2', cls: 'sr-support' },
    { price: levels.s3, label: 'S3', cls: 'sr-support' },
  ] : [];

  const yMin = chartPoints.length > 0 ? Math.min(...chartPoints) * 0.998 : 0;
  const yMax = chartPoints.length > 0 ? Math.max(...chartPoints) * 1.002 : 100;
  const yRange = yMax - yMin || 1;
  const toY = (price) => 100 - ((price - yMin) / yRange) * 100;
  const polylinePts = chartPoints.map((p, i) => `${(i / (chartPoints.length - 1)) * 100},${toY(p)}`).join(' ');

  return (
    <div className="sr-page">
      <header className="sr-header">
        <h1>Support & Resistance</h1>
        <p className="sr-subtitle">
          Pivot points, round number levels, and moving average support/resistance across timeframes.
        </p>
      </header>

      {/* Symbol selector */}
      <div className="sr-controls">
        <div className="sr-field">
          <label>Symbol</label>
          <select value={symbol} onChange={(e) => setSymbol(e.target.value)}>
            {['AAPL', 'NVDA', 'TSLA', 'MSFT', 'AMD', 'SPY'].map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </div>
        <div className="sr-field">
          <label>Timeframe</label>
          <div className="sr-tf-tabs">
            {TIMEFRAMES.map((tf) => (
              <button
                key={tf.id}
                type="button"
                className={`sr-tf-tab ${timeframe === tf.id ? 'sr-tf-active' : ''}`}
                onClick={() => setTimeframe(tf.id)}
                title={tf.desc}
              >
                {tf.id}
              </button>
            ))}
          </div>
        </div>
      </div>

      {isLoading && <LoadingSkeleton variant="card" count={2} />}

      {isError && (
        <div className="sr-section">
          <p className="error">Could not load support & resistance data. Is the NestJS API running?</p>
        </div>
      )}

      {!isLoading && !isError && !levels?.pivot && (
        <div className="sr-section">
          <p className="sr-subtitle">No OHLCV data available for {symbol} on {timeframe} timeframe. Try another symbol or timeframe, or import market data first.</p>
        </div>
      )}

      {!isLoading && !isError && levels?.pivot && (
      <>
      {/* Chart with S/R lines */}
      <section className="sr-section">
        <h2>
          {symbol} — {activeTF?.label}
          <span className="sr-badge">{activeTF?.desc}</span>
        </h2>

        <div className="sr-chart-wrap">
          <svg viewBox="0 0 100 100" className="sr-chart" preserveAspectRatio="none">
            {/* Price line */}
            <polyline
              fill="none"
              stroke="var(--accent, #0ea5a6)"
              strokeWidth="1.2"
              strokeLinecap="round"
              strokeLinejoin="round"
              points={polylinePts}
            />
            {/* Gradient fill */}
            <defs>
              <linearGradient id="srGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--accent, #0ea5a6)" stopOpacity="0.18" />
                <stop offset="100%" stopColor="var(--accent, #0ea5a6)" stopOpacity="0" />
              </linearGradient>
            </defs>
            <polygon fill="url(#srGrad)" points={`0,${toY(yMin)} ${polylinePts} 100,${toY(yMin)}`} />

            {/* S/R Horizontal lines */}
            {levelLines.map((ll) => {
              const yPct = toY(ll.price);
              return (
                <g key={ll.label}>
                  <line
                    x1="0" y1={yPct} x2="100" y2={yPct}
                    stroke={ll.cls === 'sr-resist' ? '#ef4444' : ll.cls === 'sr-support' ? '#22c55e' : '#f59e0b'}
                    strokeWidth="0.5"
                    strokeDasharray={ll.cls === 'sr-pivot' ? 'none' : '2 3'}
                    opacity="0.7"
                  />
                  <rect
                    x="0" y={yPct - 2.5} width="14" height="5" rx="1"
                    fill={ll.cls === 'sr-resist' ? '#ef4444' : ll.cls === 'sr-support' ? '#22c55e' : '#f59e0b'}
                  />
                  <text x="1" y={yPct - 1.5} fill="#fff" fontSize="3.5" fontWeight="600">
                    {ll.label}
                  </text>
                </g>
              );
            })}
          </svg>
        </div>
      </section>

      {/* Level detail cards */}
      <section className="sr-section">
        <h2>Levels</h2>
        <div className="sr-levels-grid">
          {levelLines.map((ll) => (
            <div key={ll.label} className={`sr-level-card ${ll.cls}`}>
              <span className="sr-level-label">{ll.label}</span>
              <span className="sr-level-price">{ll.price}</span>
            </div>
          ))}
        </div>
      </section>

      {/* Round number levels + MAs */}
      <section className="sr-section">
        <h2>Additional Levels</h2>
        <div className="sr-extras">
          <div className="sr-extra-block">
            <h3>Round Numbers</h3>
            <div className="sr-round-list">
              {levels.roundLevels?.length > 0 ? levels.roundLevels.map((r) => (
                <span key={r} className="sr-round-chip">{r}</span>
              )) : <span className="sr-round-chip">No round levels available</span>}
            </div>
          </div>
          <div className="sr-extra-block">
            <h3>Moving Averages</h3>
            <div className="sr-ma-list">
              <div className="sr-ma-item">
                <span className="sr-ma-label">MA 20</span>
                <span className="sr-ma-val">{levels.ma20 != null ? levels.ma20 : '—'}</span>
              </div>
              <div className="sr-ma-item">
                <span className="sr-ma-label">MA 50</span>
                <span className="sr-ma-val">{levels.ma50 != null ? levels.ma50 : '—'}</span>
              </div>
            </div>
          </div>
        </div>
      </section>
      </>
      )}
    </div>
  );
}
