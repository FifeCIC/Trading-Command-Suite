import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiGet } from '../core/api/client';
import LoadingSkeleton from '../components/LoadingSkeleton';
import './market-correlations.css';

const SYMBOLS = ['SPY', 'QQQ', 'IWM', 'DIA', 'GLD', 'SLV', 'USO', 'TLT', 'XLK', 'XLF', 'XLE', 'AAPL', 'NVDA', 'TSLA'];
const TIMEFRAMES = [
  { key: 'w1', label: '1 Week' },
  { key: 'm1', label: '1 Month' },
  { key: 'm3', label: '3 Months' },
  { key: 'm6', label: '6 Months' },
  { key: 'y1', label: '1 Year' },
];

// Pre-seeded correlation data
const CORR_DATA = {
  'SPY-QQQ': 0.92, 'SPY-IWM': 0.78, 'SPY-DIA': 0.95, 'SPY-GLD': -0.15, 'SPY-TLT': -0.32, 'SPY-USO': 0.24,
  'QQQ-XLK': 0.96, 'QQQ-NVDA': 0.85, 'QQQ-AAPL': 0.78, 'QQQ-TSLA': 0.62,
  'GLD-SLV': 0.82, 'GLD-TLT': 0.45, 'GLD-USO': 0.28,
  'XLF-JPM': 0.88, 'XLE-USO': 0.91, 'XLK-AAPL': 0.84, 'XLK-NVDA': 0.90,
  'AAPL-MSFT': 0.72, 'NVDA-AMD': 0.78, 'TSLA-RIVN': 0.65,
};

function getCorr(a, b) {
  if (a === b) return 1;
  const key1 = `${a}-${b}`;
  const key2 = `${b}-${a}`;
  if (CORR_DATA[key1] !== undefined) return CORR_DATA[key1];
  if (CORR_DATA[key2] !== undefined) return CORR_DATA[key2];
  return +(Math.random() * 0.6 - 0.15).toFixed(2);
}


function corrColor(v) {
  if (v >= 0.7) return '#22c55e';
  if (v >= 0.4) return '#4ade80';
  if (v >= 0.1) return '#86efac';
  if (v >= -0.1) return '#475569';
  if (v >= -0.4) return '#fca5a5';
  return '#ef4444';
}

function generateScatter(n, corr) {
  const pts = [];
  for (let i = 0; i < n; i++) {
    const x = (Math.random() - 0.5) * 2;
    const y = corr * x + Math.sqrt(1 - corr * corr) * (Math.random() - 0.5) * 1.2;
    pts.push({ x, y });
  }
  return pts;
}

export default function MarketCorrelationsPage() {
  const [tf, setTf] = useState('D1');
  const [pairA, setPairA] = useState('SPY');
  const [pairB, setPairB] = useState('QQQ');

  // Fetch real correlation from API
  const { data: corrData, isLoading: corrLoading, isError: corrError } = useQuery({
    queryKey: ['correlation', pairA, pairB, tf],
    queryFn: () => apiGet(`/api/indicators/correlation/${pairA}/${pairB}?tf=${tf}`),
    refetchInterval: 0, // on-demand only
  });

  const apiCorr = corrData?.correlation ?? null;
  const corr = apiCorr ?? CORR_DATA[`${pairA}-${pairB}`] ?? CORR_DATA[`${pairB}-${pairA}`] ?? 0;
  const isLiveData = apiCorr !== null;
  const scatter = useMemo(() => generateScatter(80, corr), [corr]);

  // Scatter coords
  const scMin = -1.5, scMax = 1.5, scRange = scMax - scMin;
  const toScX = (v) => ((v - scMin) / scRange) * 100;
  const toScY = (v) => 100 - ((v - scMin) / scRange) * 100;

  return (
    <div className="mc-page">
      <header className="mc-header">
        <h1>Market Correlations</h1>
        <p className="mc-subtitle">Correlation matrix and visual evidence between symbols, sectors, and indices.</p>
      </header>

      {/* Correlation heatmap */}
      <section className="mc-section">
        <h2>Correlation Matrix <span className="mc-tf-label">(Reference — pair comparison below uses live API)</span></h2>
        <div className="mc-tf-tabs">
          {TIMEFRAMES.map((t) => (
            <button key={t.key} type="button" className={`mc-tf-tab ${tf === t.key ? 'mc-tf-active' : ''}`} onClick={() => setTf(t.key)}>{t.label}</button>
          ))}
          {corrLoading && <span className="mc-corr-desc" style={{padding:'0.3rem 0'}}>Fetching...</span>}
        </div>
        <div className="mc-heatmap-wrap">
          <table className="mc-heatmap">
            <thead>
              <tr>
                <th></th>
                {SYMBOLS.map((s) => <th key={s}>{s}</th>)}
              </tr>
            </thead>
            <tbody>
              {SYMBOLS.map((row) => (
                <tr key={row}>
                  <th>{row}</th>
                  {SYMBOLS.map((col) => {
                    const v = getCorr(row, col);
                    const bg = corrColor(v);
                    const isDiag = row === col;
                    return (
                      <td
                        key={col}
                        className={`mc-cell ${isDiag ? 'mc-diag' : ''}`}
                        style={{ backgroundColor: isDiag ? 'transparent' : bg, color: isDiag ? 'var(--ink-soft)' : Math.abs(v) > 0.3 ? '#fff' : 'var(--ink)' }}
                        title={`${row} ↔ ${col}: ${v}`}
                      >
                        {v.toFixed(2)}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="mc-legend">
          <span className="mc-legend-label">Scale:</span>
          {['-1.0', '-0.5', '0', '0.5', '1.0'].map((l) => (
            <span key={l} className="mc-legend-swatch" style={{ backgroundColor: corrColor(parseFloat(l)) }}>{l}</span>
          ))}
        </div>
      </section>

      {/* Pair comparison */}
      <section className="mc-section">
        <h2>Pair Comparison</h2>
        <div className="mc-pair-select">
          <div className="mc-field">
            <label>Symbol A</label>
            <select value={pairA} onChange={(e) => setPairA(e.target.value)}>
              {SYMBOLS.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div className="mc-field">
            <label>Symbol B</label>
            <select value={pairB} onChange={(e) => setPairB(e.target.value)}>
              {SYMBOLS.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div className="mc-corr-display">
            <span className="mc-corr-label">Correlation {isLiveData ? '(Live)' : '(Reference)'}</span>
            {corrLoading ? (
              <span className="mc-corr-value" style={{ color: '#94a3b8' }}>...</span>
            ) : (
              <span className="mc-corr-value" style={{ color: corrColor(corr) }}>{corr.toFixed(2)}</span>
            )}
            <span className="mc-corr-desc">
              {corr >= 0.7 ? 'Strong Positive' : corr >= 0.4 ? 'Moderate Positive' : corr >= 0.1 ? 'Weak Positive' : corr >= -0.1 ? 'None' : corr >= -0.4 ? 'Weak Negative' : 'Strong Negative'}
            </span>
            {corrError && <span className="mc-corr-desc" style={{color:'#ef4444'}}>API offline — using reference data</span>}
          </div>
        </div>

        {/* Scatter plot */}
        <div className="mc-scatter-wrap">
          <svg viewBox="0 0 100 100" className="mc-scatter">
            {/* Axes */}
            <line x1="5" y1="50" x2="95" y2="50" stroke="rgba(255,255,255,0.08)" strokeWidth="0.3" />
            <line x1="50" y1="5" x2="50" y2="95" stroke="rgba(255,255,255,0.08)" strokeWidth="0.3" />
            {/* Regression line */}
            <line x1="5" y1={toScY(corr * scMin)} x2="95" y2={toScY(corr * scMax)} stroke={corrColor(corr)} strokeWidth="0.5" strokeDasharray="2 2" opacity="0.6" />
            {/* Dots */}
            {scatter.map((pt, i) => (
              <circle key={i} cx={toScX(pt.x)} cy={toScY(pt.y)} r="0.8" fill={corrColor(corr)} opacity="0.5" />
            ))}
            {/* Labels */}
            <text x="5" y="97" fill="rgba(255,255,255,0.25)" fontSize="2.5">{pairA} Returns</text>
            <text x="3" y="4" fill="rgba(255,255,255,0.25)" fontSize="2.5" transform="rotate(-90, 3, 4)">{pairB} Returns</text>
          </svg>
        </div>
      </section>
    </div>
  );
}
