import { useState, useMemo, useEffect, useRef } from 'react';
import { createChart, CandlestickSeries } from 'lightweight-charts';

// ── Chart Data → OHLC Converter ─────────────────────────────────────────────
// SVG chart data uses: lower number = higher price (y=0 is top of chart).
// We invert to get prices where higher number = higher price for lightweight-charts.
function chartToOHLC(chartData) {
  // Find the range of values across all candles
  let lo = Infinity, hi = -Infinity;
  chartData.forEach(c => {
    [c.wickTop, c.wickBottom, c.bodyTop, c.bodyBottom].forEach(v => {
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    });
  });
  const span = hi - lo || 1;
  // Map SVG-space value (small=high price) to price-space (large=high price)
  const toPrice = (v) => 100 + ((hi - v) / span) * 80;

  const now = Math.floor(Date.now() / 1000) - chartData.length * 3600;
  return chartData.map((c, i) => {
    const high = toPrice(Math.min(c.wickTop, c.bodyTop, c.bodyBottom));
    const low = toPrice(Math.max(c.wickBottom, c.bodyTop, c.bodyBottom));
    const isBear = c.color === 'bear';
    const isDoji = c.color === 'doji' || c.color === 'neutral';
    let open, close;
    if (isDoji) {
      const mid = (toPrice(c.bodyTop) + toPrice(c.bodyBottom)) / 2;
      open = mid - 0.3; close = mid + 0.3;
    } else if (isBear) {
      open = toPrice(c.bodyBottom);
      close = toPrice(c.bodyTop);
    } else {
      open = toPrice(c.bodyTop);
      close = toPrice(c.bodyBottom);
    }
    return { time: now + i * 3600, open, high, low, close, highlighted: c.highlighted, faded: c.faded };
  });
}

// ── TradingView Lightweight-Charts Widget ────────────────────────────────────
function PatternChartWidget({ data, width = 500, height = 200 }) {
  const containerRef = useRef(null);
  const chartRef = useRef(null);

  useEffect(() => {
    if (!containerRef.current) return;
    if (chartRef.current) { chartRef.current.remove(); chartRef.current = null; }

    const ohlc = chartToOHLC(data);
    const chart = createChart(containerRef.current, {
      width, height,
      layout: {
        background: { color: '#0f172a' },
        textColor: '#64748b',
      },
      grid: {
        vertLines: { color: 'rgba(51,65,85,0.25)' },
        horzLines: { color: 'rgba(51,65,85,0.25)' },
      },
      crosshair: { mode: 0 },
      timeScale: {
        borderColor: 'rgba(51,65,85,0.4)',
        timeVisible: false,
        visible: false,
      },
      rightPriceScale: {
        borderColor: 'rgba(51,65,85,0.4)',
        visible: false,
      },
      handleScroll: false,
      handleScale: false,
    });

    const series = chart.addSeries(CandlestickSeries, {
      upColor: '#22c55e',
      downColor: '#ef4444',
      borderUpColor: '#22c55e',
      borderDownColor: '#ef4444',
      wickUpColor: '#22c55e',
      wickDownColor: '#ef4444',
    });
    series.setData(ohlc);

    chart.timeScale().fitContent();
    chartRef.current = chart;

    return () => { if (chartRef.current) { chartRef.current.remove(); chartRef.current = null; } };
  }, [data, width, height]);

  return <div ref={containerRef} style={{ borderRadius: '8px', overflow: 'hidden' }} />;
}

// ── SVG Candle Chart Component (collapsed mini view) ────────────────────────
function CandleChart({ data, width = 280, height = 90 }) {
  const pad = { top: 4, right: 8, bottom: 16, left: 40 };
  const chartW = width - pad.left - pad.right;
  const chartH = height - pad.top - pad.bottom;
  const slotW = chartW / data.length;

  let minP = Infinity, maxP = -Infinity;
  data.forEach(c => {
    if (c.wickTop < minP) minP = c.wickTop;
    if (c.wickBottom > maxP) maxP = c.wickBottom;
  });
  const range = maxP - minP || 1;
  const y = (price) => pad.top + ((price - minP) / range) * chartH;

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}
      style={{ display: 'block', background: 'rgba(0,0,0,0.18)', borderRadius: '6px' }}>
      {[0.25, 0.5, 0.75].map(frac => (
        <line key={`h-${frac}`} x1={pad.left} x2={width - pad.right}
          y1={pad.top + frac * chartH} y2={pad.top + frac * chartH}
          stroke="rgba(255,255,255,0.06)" strokeWidth="0.5" />
      ))}
      <line x1={pad.left} x2={width - pad.right} y1={height - pad.bottom} y2={height - pad.bottom}
        stroke="rgba(255,255,255,0.12)" strokeWidth="0.5" />
      {data.map((c, i) => {
        const cx = pad.left + slotW * i + slotW / 2;
        const bodyW = Math.max(slotW * 0.45, 4);
        const bodyTop = y(Math.max(c.bodyTop, c.bodyBottom));
        const bodyBot = y(Math.min(c.bodyTop, c.bodyBottom));
        const wickTop = y(c.wickTop);
        const wickBot = y(c.wickBottom);
        const isBull = c.bodyTop <= c.bodyBottom;
        const fill = c.color === 'doji' ? '#f59e0b'
          : c.color === 'neutral' ? '#94a3b8'
          : isBull ? '#22c55e' : '#ef4444';
        const opacity = c.faded ? 0.35 : 1;
        return (
          <g key={i} opacity={opacity}>
            <line x1={cx} x2={cx} y1={wickTop} y2={wickBot}
              stroke={fill} strokeWidth={c.highlighted ? 1.5 : 1} />
            {Math.abs(bodyBot - bodyTop) < 1.5 ? (
              <line x1={cx - bodyW / 2} x2={cx + bodyW / 2} y1={bodyTop} y2={bodyTop}
                stroke={fill} strokeWidth={c.highlighted ? 2 : 1.5} />
            ) : (
              <rect x={cx - bodyW / 2} y={bodyTop} width={bodyW} height={Math.max(bodyBot - bodyTop, 1)}
                fill={fill} rx={0.5} />
            )}
            {c.highlighted && (
              <rect x={cx - bodyW / 2 - 3} y={bodyTop - 2} width={bodyW + 6}
                height={Math.max(bodyBot - bodyTop, 1) + 4}
                fill="none" stroke="#f59e0b" strokeWidth="1.2" rx="2" strokeDasharray="2,1" />
            )}
          </g>
        );
      })}
      <text x={pad.left - 3} y={pad.top + 9} textAnchor="end"
        fill="rgba(255,255,255,0.35)" fontSize="7">{maxP.toFixed(0)}</text>
      <text x={pad.left - 3} y={height - pad.bottom + 3} textAnchor="end"
        fill="rgba(255,255,255,0.35)" fontSize="7">{minP.toFixed(0)}</text>
    </svg>
  );
}

// ── PATTERN DATA ────────────────────────────────────────────────────────────
import PATTERNS from '../data/candle-patterns.js';

// ── CONSTANTS ───────────────────────────────────────────────────────────────
const TYPE_COLORS = { bullish: '#22c55e', bearish: '#ef4444', neutral: '#f59e0b', both: '#8f7dff' };
const CATEGORIES = [
  { key: 'all', label: 'All' },
  { key: 'single', label: 'Single Candle' },
  { key: 'double', label: 'Two-Candle' },
  { key: 'triple', label: 'Three-Candle' },
  { key: 'multi', label: 'Multi-Candle' }
];
const SIGNAL_LABELS = {
  reversal: 'Reversal',
  continuation: 'Continuation',
  indecision: 'Indecision'
};
const RELIABILITY_ORDER = { 'Very High': 4, 'High': 3, 'Medium': 2, 'Low': 1 };

// ── COMPONENT ───────────────────────────────────────────────────────────────
export default function CandlePatternsGuidePage() {
  const [expanded, setExpanded] = useState(null);
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [typeFilter, setTypeFilter] = useState('all');
  const [search, setSearch] = useState('');

  const filtered = useMemo(() => {
    return PATTERNS.filter(p => {
      if (categoryFilter !== 'all' && p.category !== categoryFilter) return false;
      if (typeFilter !== 'all') {
        if (typeFilter === 'both' && p.type !== 'both') return false;
        if (typeFilter === 'neutral' && p.type !== 'neutral') return false;
        if (typeFilter === 'bullish' && p.type !== 'bullish' && p.type !== 'both') return false;
        if (typeFilter === 'bearish' && p.type !== 'bearish' && p.type !== 'both') return false;
      }
      if (search && !p.name.toLowerCase().includes(search.toLowerCase())) return false;
      return true;
    });
  }, [categoryFilter, typeFilter, search]);

  const toggle = (id) => setExpanded(expanded === id ? null : id);

  return (
    <div className="pf-page" style={{ maxWidth: '1100px' }}>
      <div className="pf-header">
        <div>
          <h1>🕯️ Candle Patterns Guide</h1>
          <p style={{ color: 'var(--ink-soft)', margin: '0.25rem 0 0', fontSize: '0.88rem' }}>
            Comprehensive educational reference for {PATTERNS.length} candlestick patterns with detailed charts,
            market psychology breakdowns, and trading scenarios.
            See <strong>Pattern Detection</strong> for live scanning against real market data.
          </p>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="pf-summary" style={{ marginBottom: '1rem' }}>
        <div className="pf-sum-card">
          <div className="pf-sum-val">{PATTERNS.length}</div>
          <div>Patterns</div>
        </div>
        <div className="pf-sum-card">
          <div className="pf-sum-val">{PATTERNS.filter(p => p.type === 'bullish').length}</div>
          <div>Bullish</div>
        </div>
        <div className="pf-sum-card">
          <div className="pf-sum-val">{PATTERNS.filter(p => p.type === 'bearish').length}</div>
          <div>Bearish</div>
        </div>
        <div className="pf-sum-card">
          <div className="pf-sum-val">{PATTERNS.filter(p => p.type === 'both' || p.type === 'neutral').length}</div>
          <div>Both/Neutral</div>
        </div>
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: '0.6rem', marginBottom: '1rem', flexWrap: 'wrap', alignItems: 'center' }}>
        <div style={{ display: 'flex', gap: '2px', background: 'rgba(255,255,255,0.05)', borderRadius: '6px', padding: '2px' }}>
          {CATEGORIES.map(c => (
            <button key={c.key} onClick={() => setCategoryFilter(c.key)}
              style={{
                padding: '0.3rem 0.7rem', border: 'none', borderRadius: '4px', cursor: 'pointer',
                fontSize: '0.76rem', fontWeight: 600, background: categoryFilter === c.key ? 'rgba(255,255,255,0.12)' : 'transparent',
                color: categoryFilter === c.key ? '#f1f5f9' : '#64748b',
              }}>
              {c.label}
            </button>
          ))}
        </div>
        <select value={typeFilter} onChange={e => setTypeFilter(e.target.value)}
          style={{
            padding: '0.3rem 0.6rem', borderRadius: '6px', border: '1px solid #334155',
            background: '#1e293b', color: '#e2e8f0', fontSize: '0.76rem'
          }}>
          <option value="all">All Types</option>
          <option value="bullish">Bullish</option>
          <option value="bearish">Bearish</option>
          <option value="both">Both</option>
          <option value="neutral">Neutral</option>
        </select>
        <input type="text" placeholder="Search patterns…" value={search} onChange={e => setSearch(e.target.value)}
          style={{
            padding: '0.3rem 0.7rem', borderRadius: '6px', border: '1px solid #334155',
            background: '#1e293b', color: '#e2e8f0', fontSize: '0.76rem', width: '180px'
          }} />
        <span style={{ fontSize: '0.72rem', color: '#64748b', marginLeft: 'auto' }}>
          Showing {filtered.length} of {PATTERNS.length}
        </span>
      </div>

      {/* Pattern Cards */}
      <div className="pf-section">
        {filtered.map((p) => {
          const isOpen = expanded === p.id;
          return (
            <div key={p.id} style={{
              border: `1px solid ${isOpen ? TYPE_COLORS[p.type] + '60' : 'var(--line, #334155)'}`,
              borderRadius: '10px', marginBottom: '0.7rem', overflow: 'hidden',
              background: isOpen ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.12)',
              transition: 'border-color 0.15s, background 0.15s'
            }}>
              {/* Card Header — always visible */}
              <button onClick={() => toggle(p.id)} style={{
                width: '100%', display: 'flex', alignItems: 'center', gap: '0.75rem',
                padding: '0.75rem 1rem', border: 'none', cursor: 'pointer',
                background: 'transparent', color: '#e2e8f0', textAlign: 'left', fontFamily: 'inherit',
              }}>
                <div style={{ flexShrink: 0 }}>
                  <CandleChart data={p.chart} width={160} height={56} />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                    <strong style={{ fontSize: '0.92rem' }}>{p.name}</strong>
                    <span style={{
                      padding: '0.1rem 0.4rem', borderRadius: '4px', fontSize: '0.62rem',
                      fontWeight: 700, textTransform: 'uppercase',
                      background: `${TYPE_COLORS[p.type]}20`, color: TYPE_COLORS[p.type],
                      border: `1px solid ${TYPE_COLORS[p.type]}40`,
                    }}>{p.type}</span>
                    <span style={{
                      padding: '0.1rem 0.4rem', borderRadius: '4px', fontSize: '0.62rem',
                      fontWeight: 600, background: 'rgba(255,255,255,0.06)', color: '#94a3b8',
                      border: '1px solid rgba(255,255,255,0.08)',
                    }}>{SIGNAL_LABELS[p.signal]}</span>
                    <span style={{
                      padding: '0.1rem 0.4rem', borderRadius: '4px', fontSize: '0.62rem',
                      fontWeight: 600, background: 'rgba(255,255,255,0.04)', color: '#64748b',
                    }}>{CATEGORIES.find(c => c.key === p.category)?.label}</span>
                  </div>
                  <p style={{ margin: '0.25rem 0 0', fontSize: '0.8rem', color: '#94a3b8', lineHeight: 1.5 }}>
                    {p.summary}
                  </p>
                </div>
                <div style={{ flexShrink: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '2px' }}>
                  <span style={{ fontSize: '0.65rem', color: '#64748b' }}>Reliability</span>
                  <span style={{
                    fontSize: '0.72rem', fontWeight: 700,
                    color: RELIABILITY_ORDER[p.reliability] >= 3 ? '#22c55e' : RELIABILITY_ORDER[p.reliability] >= 2 ? '#f59e0b' : '#ef4444'
                  }}>{p.reliability}</span>
                </div>
                <span style={{ fontSize: '0.8rem', color: '#64748b', transform: isOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }}>▾</span>
              </button>

              {/* Expanded Detail */}
              {isOpen && (
                <div style={{ borderTop: '1px solid var(--line, #334155)', padding: '1rem' }}>
                  <div style={{ marginBottom: '1rem' }}>
                    <PatternChartWidget data={p.chart} width={680} height={220} />
                  </div>
                  <div style={{ marginBottom: '0.8rem' }}>
                    <h4 style={{ margin: '0 0 0.3rem', fontSize: '0.8rem', color: '#f59e0b', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Pattern Overview</h4>
                    {p.overview.split('\n\n').filter(Boolean).map((para, i) => (
                      <p key={i} style={{ margin: '0 0 0.5rem', fontSize: '0.83rem', color: '#cbd5e1', lineHeight: 1.65 }}>{para}</p>
                    ))}
                  </div>
                  <div style={{ marginBottom: '0.8rem', padding: '0.7rem', background: 'rgba(245,158,11,0.06)', borderRadius: '6px', borderLeft: '3px solid #f59e0b' }}>
                    <h4 style={{ margin: '0 0 0.3rem', fontSize: '0.8rem', color: '#f59e0b', textTransform: 'uppercase', letterSpacing: '0.5px' }}>🧠 Market Psychology</h4>
                    <p style={{ margin: 0, fontSize: '0.83rem', color: '#cbd5e1', lineHeight: 1.65 }}>{p.psychology}</p>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', marginBottom: '0.75rem' }}>
                    <div style={{
                      padding: '0.7rem', borderRadius: '6px',
                      background: 'rgba(34,197,94,0.05)', border: '1px solid rgba(34,197,94,0.15)',
                      opacity: p.bullish.context === 'N/A' ? 0.35 : 1
                    }}>
                      <h4 style={{ margin: '0 0 0.4rem', fontSize: '0.78rem', color: '#22c55e', textTransform: 'uppercase', letterSpacing: '0.5px' }}>📈 Bullish Scenario</h4>
                      <p style={{ margin: '0 0 0.35rem', fontSize: '0.8rem', color: '#cbd5e1', lineHeight: 1.55 }}><strong>Context:</strong> {p.bullish.context}</p>
                      <p style={{ margin: '0 0 0.35rem', fontSize: '0.8rem', color: '#cbd5e1', lineHeight: 1.55 }}><strong>Confirmation:</strong> {p.bullish.confirmation}</p>
                      <p style={{ margin: 0, fontSize: '0.78rem', color: '#ef4444', lineHeight: 1.5 }}><strong>❌ Failure:</strong> {p.bullish.failure}</p>
                    </div>
                    <div style={{
                      padding: '0.7rem', borderRadius: '6px',
                      background: 'rgba(239,68,68,0.05)', border: '1px solid rgba(239,68,68,0.15)',
                      opacity: p.bearish.context === 'N/A' ? 0.35 : 1
                    }}>
                      <h4 style={{ margin: '0 0 0.4rem', fontSize: '0.78rem', color: '#ef4444', textTransform: 'uppercase', letterSpacing: '0.5px' }}>📉 Bearish Scenario</h4>
                      <p style={{ margin: '0 0 0.35rem', fontSize: '0.8rem', color: '#cbd5e1', lineHeight: 1.55 }}><strong>Context:</strong> {p.bearish.context}</p>
                      <p style={{ margin: '0 0 0.35rem', fontSize: '0.8rem', color: '#cbd5e1', lineHeight: 1.55 }}><strong>Confirmation:</strong> {p.bearish.confirmation}</p>
                      <p style={{ margin: 0, fontSize: '0.78rem', color: '#ef4444', lineHeight: 1.5 }}><strong>❌ Failure:</strong> {p.bearish.failure}</p>
                    </div>
                  </div>
                  <div style={{ padding: '0.6rem 0.7rem', background: 'rgba(143,125,255,0.06)', borderRadius: '6px', borderLeft: '3px solid #8f7dff' }}>
                    <h4 style={{ margin: '0 0 0.25rem', fontSize: '0.78rem', color: '#8f7dff', textTransform: 'uppercase', letterSpacing: '0.5px' }}>💡 Trading Tips</h4>
                    <p style={{ margin: 0, fontSize: '0.82rem', color: '#cbd5e1', lineHeight: 1.6 }}>{p.tips}</p>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
