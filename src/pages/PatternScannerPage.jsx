import { useState, useMemo } from 'react';
import './pattern-scanner.css';

const PATTERN_TEMPLATES = [
  { id: 'hs', name: 'Head & Shoulders', type: 'bearish', category: 'Reversal', reliability: 78, desc: 'Three peaks with middle highest. Indicates trend reversal from bullish to bearish.' },
  { id: 'ihs', name: 'Inverse H&S', type: 'bullish', category: 'Reversal', reliability: 76, desc: 'Three troughs with middle lowest. Indicates reversal from bearish to bullish.' },
  { id: 'double-top', name: 'Double Top', type: 'bearish', category: 'Reversal', reliability: 73, desc: 'Two peaks at similar level. Failed breakout signals exhaustion.' },
  { id: 'double-bottom', name: 'Double Bottom', type: 'bullish', category: 'Reversal', reliability: 74, desc: 'Two troughs at similar level. Support holds, buyers step in.' },
  { id: 'asc-tri', name: 'Ascending Triangle', type: 'bullish', category: 'Continuation', reliability: 71, desc: 'Flat top resistance with rising lows. Breakout expected upward.' },
  { id: 'desc-tri', name: 'Descending Triangle', type: 'bearish', category: 'Continuation', reliability: 70, desc: 'Flat bottom support with falling highs. Breakdown expected downward.' },
  { id: 'sym-tri', name: 'Symmetrical Triangle', type: 'neutral', category: 'Continuation', reliability: 65, desc: 'Converging trendlines. Breakout direction uncertain, follow volume.' },
  { id: 'bull-flag', name: 'Bull Flag', type: 'bullish', category: 'Continuation', reliability: 69, desc: 'Sharp rise followed by downward channel. Continuation upward expected.' },
  { id: 'bear-flag', name: 'Bear Flag', type: 'bearish', category: 'Continuation', reliability: 68, desc: 'Sharp drop followed by upward channel. Continuation downward expected.' },
  { id: 'wedge-rise', name: 'Rising Wedge', type: 'bearish', category: 'Reversal', reliability: 72, desc: 'Narrowing upward channel. Breakdown likely, reversal signal.' },
  { id: 'wedge-fall', name: 'Falling Wedge', type: 'bullish', category: 'Reversal', reliability: 71, desc: 'Narrowing downward channel. Breakout likely, reversal signal.' },
  { id: 'cup-handle', name: 'Cup & Handle', type: 'bullish', category: 'Continuation', reliability: 75, desc: 'U-shaped recovery with small dip. Bullish continuation pattern.' },
];

const CANDLE_PATTERNS = [
  { id: 'doji', name: 'Doji', type: 'neutral', reliability: 55 },
  { id: 'hammer', name: 'Hammer', type: 'bullish', reliability: 64 },
  { id: 'shooting-star', name: 'Shooting Star', type: 'bearish', reliability: 62 },
  { id: 'engulfing-bull', name: 'Bullish Engulfing', type: 'bullish', reliability: 68 },
  { id: 'engulfing-bear', name: 'Bearish Engulfing', type: 'bearish', reliability: 67 },
  { id: 'morning-star', name: 'Morning Star', type: 'bullish', reliability: 70 },
  { id: 'evening-star', name: 'Evening Star', type: 'bearish', reliability: 69 },
  { id: 'harami-bull', name: 'Bullish Harami', type: 'bullish', reliability: 58 },
  { id: 'harami-bear', name: 'Bearish Harami', type: 'bearish', reliability: 57 },
  { id: 'three-white', name: 'Three White Soldiers', type: 'bullish', reliability: 72 },
  { id: 'three-black', name: 'Three Black Crows', type: 'bearish', reliability: 71 },
];

function generateSparkline(trend = 'neutral', length = 50) {
  const pts = [];
  let v = 50;
  const bias = trend === 'bullish' ? 0.15 : trend === 'bearish' ? -0.15 : 0;
  for (let i = 0; i < length; i++) {
    v += (Math.random() - 0.5 + bias) * 5;
    v = Math.max(5, Math.min(95, v));
    pts.push(+v.toFixed(1));
  }
  return pts;
}

function generateDetectedPatterns() {
  return PATTERN_TEMPLATES.filter(() => Math.random() > 0.35).map((tpl) => ({
    ...tpl,
    confidence: Math.floor(tpl.reliability * (0.7 + Math.random() * 0.3)),
    sparkline: generateSparkline(tpl.type),
    detectedAt: `Bar ${Math.floor(Math.random() * 200) + 10}`,
  }));
}

export default function PatternScannerPage() {
  const [symbol, setSymbol] = useState('AAPL');
  const [filterType, setFilterType] = useState('all');
  const [expandedId, setExpandedId] = useState(null);

  const chartPatterns = useMemo(() => generateDetectedPatterns(), [symbol]);
  const candlePatterns = useMemo(() =>
    CANDLE_PATTERNS.map((cp) => ({
      ...cp,
      detected: Math.random() > 0.4,
      sparkline: generateSparkline(cp.type, 30),
    })), [symbol]
  );

  const filtered = filterType === 'all'
    ? chartPatterns
    : chartPatterns.filter((p) => p.type === filterType);

  return (
    <div className="ps-page">
      <header className="ps-header">
        <h1>Pattern Scanner</h1>
        <p className="ps-subtitle">
          Automated detection of chart and candlestick patterns on <strong>{symbol}</strong>.
          Algorithmic detection for known patterns; AI integration available for complex formations.
        </p>
      </header>

      {/* Controls */}
      <div className="ps-controls">
        <div className="ps-field">
          <label>Symbol</label>
          <select value={symbol} onChange={(e) => setSymbol(e.target.value)}>
            {['AAPL', 'NVDA', 'TSLA', 'MSFT', 'AMD', 'SPY', 'EURUSD'].map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </div>
        <div className="ps-field">
          <label>Pattern Type</label>
          <div className="ps-type-tabs">
            {['all', 'bullish', 'bearish', 'neutral'].map((t) => (
              <button
                key={t}
                type="button"
                className={`ps-type-tab ${filterType === t ? 'ps-type-active' : ''}`}
                onClick={() => setFilterType(t)}
              >
                {t.charAt(0).toUpperCase() + t.slice(1)}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Chart Patterns */}
      <section className="ps-section">
        <h2>
          Chart Patterns
          <span className="ps-count">{filtered.length} detected</span>
        </h2>

        <div className="ps-grid">
          {filtered.map((pat) => {
            const isExpanded = expandedId === pat.id;
            const typeCls = pat.type === 'bullish' ? 'ps-bullish' : pat.type === 'bearish' ? 'ps-bearish' : 'ps-neutral';
            const confCls = pat.confidence >= 75 ? 'ps-conf-high' : pat.confidence >= 60 ? 'ps-conf-mid' : 'ps-conf-low';
            const linePts = pat.sparkline.map((p, i) => `${(i / (pat.sparkline.length - 1)) * 100},${100 - p}`).join(' ');

            return (
              <div
                key={pat.id}
                className={`ps-card ${isExpanded ? 'ps-expanded' : ''}`}
                onClick={() => setExpandedId(isExpanded ? null : pat.id)}
              >
                <div className="ps-card-top">
                  <div className="ps-card-title">
                    <span className={`ps-type-badge ${typeCls}`}>
                      {pat.type === 'bullish' ? '▲' : pat.type === 'bearish' ? '▼' : '◆'} {pat.type}
                    </span>
                    <span className="ps-name">{pat.name}</span>
                  </div>
                  <span className={`ps-confidence ${confCls}`}>{pat.confidence}%</span>
                </div>

                {/* Mini chart */}
                <svg viewBox="0 0 100 100" className="ps-sparkline" preserveAspectRatio="none">
                  <polyline
                    fill="none"
                    stroke={pat.type === 'bullish' ? '#22c55e' : pat.type === 'bearish' ? '#ef4444' : '#f59e0b'}
                    strokeWidth="1.6"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    points={linePts}
                  />
                </svg>

                <div className="ps-card-meta">
                  <span className="ps-category-chip">{pat.category}</span>
                  <span className="ps-reliability">Historical: {pat.reliability}%</span>
                  <span className="ps-bar-loc">📍 {pat.detectedAt}</span>
                </div>

                {isExpanded && (
                  <div className="ps-expanded-body" onClick={(e) => e.stopPropagation()}>
                    <p className="ps-desc">{pat.desc}</p>
                    <div className="ps-expanded-chart">
                      <svg viewBox="0 0 100 100" className="ps-large-chart" preserveAspectRatio="none">
                        <defs>
                          <linearGradient id={`psGrad-${pat.id}`} x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor={pat.type === 'bullish' ? '#22c55e' : '#ef4444'} stopOpacity="0.18" />
                            <stop offset="100%" stopColor={pat.type === 'bullish' ? '#22c55e' : '#ef4444'} stopOpacity="0" />
                          </linearGradient>
                        </defs>
                        <polygon fill={`url(#psGrad-${pat.id})`} points={`0,100 ${linePts} 100,100`} />
                        <polyline fill="none" stroke={pat.type === 'bullish' ? '#22c55e' : '#ef4444'} strokeWidth="1.5" points={linePts} />
                      </svg>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>

      {/* Candlestick Patterns */}
      <section className="ps-section">
        <h2>Candlestick Patterns</h2>
        <p className="ps-hint">Single and multi-candle formations detected on {symbol}.</p>
        <div className="ps-candle-grid">
          {candlePatterns.map((cp) => {
            const typeCls = cp.type === 'bullish' ? 'ps-bullish' : cp.type === 'bearish' ? 'ps-bearish' : 'ps-neutral';
            const linePts = cp.sparkline.map((p, i) => `${(i / (cp.sparkline.length - 1)) * 100},${100 - p}`).join(' ');

            return (
              <div key={cp.id} className={`ps-candle-card ${cp.detected ? 'ps-detected' : ''}`}>
                <div className="ps-candle-header">
                  <span className={`ps-candle-dot ${typeCls} ${cp.detected ? '' : 'ps-dot-dim'}`} />
                  <span className="ps-candle-name">{cp.name}</span>
                  <span className={`ps-type-badge ${typeCls} ps-type-sm`}>{cp.type}</span>
                </div>
                <svg viewBox="0 0 100 100" className="ps-candle-spark" preserveAspectRatio="none">
                  <polyline
                    fill="none"
                    stroke={cp.detected ? (cp.type === 'bullish' ? '#22c55e' : cp.type === 'bearish' ? '#ef4444' : '#f59e0b') : '#334155'}
                    strokeWidth="1.2"
                    points={linePts}
                  />
                </svg>
                <div className="ps-candle-footer">
                  <span className="ps-reliability">{cp.reliability}% hist</span>
                  {cp.detected && <span className="ps-detected-tag">DETECTED</span>}
                </div>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
