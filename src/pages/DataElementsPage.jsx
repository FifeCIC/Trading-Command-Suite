import { useState, useEffect } from 'react';
import { apiGet } from '../core/api/client';
import './trading-platforms.css';
import './data-elements.css';

const ELEMENTS = [
  {
    id: 'rsi',
    name: 'RSI Calculation',
    description: 'Relative Strength Index — requires 14+ OHLCV periods.',
    requiredValues: ['OHLCV bars', '14+ periods', 'Freshness: ≤5min (live) / ≤1d (EOD)'],
    directive: 'rsi-oversold',
  },
  {
    id: 'macd',
    name: 'MACD Crossover',
    description: 'Moving Average Convergence Divergence — 26-period EMA vs 12-period.',
    requiredValues: ['OHLCV bars', '26+ periods', 'Freshness: ≤5min (live)'],
    directive: 'macd-crossover',
  },
  {
    id: 'ema',
    name: 'EMA Structure',
    description: 'Price above EMA20 above EMA50 — trend alignment check.',
    requiredValues: ['OHLCV bars', '50+ periods', 'Freshness: ≤5min (live)'],
    directive: 'ema-structure',
  },
  {
    id: 'atr',
    name: 'ATR Normalized Dip',
    description: 'Average True Range pullback quality assessment.',
    requiredValues: ['OHLCV bars', '34+ periods', 'Freshness: ≤5min (live)'],
    directive: 'atr-dip',
  },
  {
    id: 'volume',
    name: 'Volume Confirmation',
    description: 'Above-average volume as signal strength indicator.',
    requiredValues: ['OHLCV bars', '21+ periods', 'Freshness: ≤5min (live)'],
    directive: 'volume-confirmation',
  },
  {
    id: 'budget',
    name: 'Budget Gate',
    description: 'Signal budget tracking — prevents over-trading when capacity is full.',
    requiredValues: ['Active signal count', 'Max signal occupancy threshold'],
    directive: 'budget-gate',
  },
];

export default function DataElementsPage() {
  const [elements, setElements] = useState(ELEMENTS);
  const [symbolCount, setSymbolCount] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const data = await apiGet('/api/symbols');
        const syms = Array.isArray(data?.symbols) ? data.symbols : [];
        setSymbolCount(syms.length);
      } catch { /* offline */ }
      setLoading(false);
    }
    load();
  }, []);

  // Compute status per element based on symbol count
  const enrichedElements = elements.map((el) => {
    let status = 'unavailable';
    let statusLabel = 'Unavailable';
    if (symbolCount === null) {
      status = 'unknown';
      statusLabel = 'Checking...';
    } else if (symbolCount > 0) {
      status = 'partial';
      statusLabel = 'Partial';
      if (symbolCount >= 5) {
        status = 'complete';
        statusLabel = 'Complete';
      }
    }
    return { ...el, status, statusLabel, symbolCount };
  });

  const statusIcon = { complete: '✅', partial: '⚠️', unavailable: '❌', unknown: '⏳' };

  if (loading) {
    return <div className="trading-platforms-page"><div className="tp-page-header"><h1>Data Elements</h1></div><p style={{ padding: '1rem' }}>Loading...</p></div>;
  }

  return (
    <div className="trading-platforms-page">
      <header className="tp-page-header">
        <h1>Data Elements</h1>
        <p>Each element groups the data values required for a directive to produce valid scores. {symbolCount !== null && `${symbolCount} symbols available.`}</p>
      </header>

      <div className="de-grid">
        {enrichedElements.map((el) => (
          <article key={el.id} className={`de-card de-card--${el.status}`}>
            <div className="de-card-header">
              <span className="de-status-icon">{statusIcon[el.status]}</span>
              <h2>{el.name}</h2>
            </div>
            <p className="de-desc">{el.description}</p>
            <div className="de-req">
              <strong>Required:</strong>
              <ul>
                {el.requiredValues.map((r, i) => <li key={i}>{r}</li>)}
              </ul>
            </div>
            <div className="de-meta">
              <span className={`de-badge de-badge--${el.status}`}>{el.statusLabel}</span>
              <span className="de-coverage">{el.symbolCount !== null ? `${el.symbolCount} symbols` : '—'}</span>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}
