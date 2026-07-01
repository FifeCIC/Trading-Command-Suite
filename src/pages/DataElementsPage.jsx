import { useState, useEffect, useMemo } from 'react';
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
    minBars: 14,
  },
  {
    id: 'macd',
    name: 'MACD Crossover',
    description: 'Moving Average Convergence Divergence — 26-period EMA vs 12-period.',
    requiredValues: ['OHLCV bars', '26+ periods', 'Freshness: ≤5min (live)'],
    directive: 'macd-crossover',
    minBars: 26,
  },
  {
    id: 'ema',
    name: 'EMA Structure',
    description: 'Price above EMA20 above EMA50 — trend alignment check.',
    requiredValues: ['OHLCV bars', '50+ periods', 'Freshness: ≤5min (live)'],
    directive: 'ema-structure',
    minBars: 50,
  },
  {
    id: 'atr',
    name: 'ATR Normalized Dip',
    description: 'Average True Range pullback quality assessment.',
    requiredValues: ['OHLCV bars', '34+ periods', 'Freshness: ≤5min (live)'],
    directive: 'atr-dip',
    minBars: 34,
  },
  {
    id: 'volume',
    name: 'Volume Confirmation',
    description: 'Above-average volume as signal strength indicator.',
    requiredValues: ['OHLCV bars', '21+ periods', 'Freshness: ≤5min (live)'],
    directive: 'volume-confirmation',
    minBars: 21,
  },
  {
    id: 'budget',
    name: 'Budget Gate',
    description: 'Signal budget tracking — prevents over-trading when capacity is full.',
    requiredValues: ['Active signal count', 'Max signal occupancy threshold'],
    directive: 'budget-gate',
    minBars: 0, // non-OHLCV — always available if signals exist
  },
];

export default function DataElementsPage() {
  const [watchlistSymbols, setWatchlistSymbols] = useState([]);
  const [freshnessData, setFreshnessData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    async function load() {
      try {
        // Get default watchlist symbols
        const wlData = await apiGet('/api/watchlists');
        const lists = Array.isArray(wlData?.watchlists) ? wlData.watchlists : [];
        const defaultList = lists.find((l) => l.isDefault) || lists[0];
        const symbols = Array.isArray(defaultList?.symbols) ? defaultList.symbols : [];
        setWatchlistSymbols(symbols);

        // Get market data freshness for all symbols
        if (symbols.length > 0) {
          const fresh = await apiGet('/api/market-data/freshness');
          const results = Array.isArray(fresh?.results) ? fresh.results : [];
          setFreshnessData(results);
        }
      } catch (e) {
        setError(e.message || 'Failed to load');
      }
      setLoading(false);
    }
    load();
  }, []);

  // Compute real status per element
  const enrichedElements = useMemo(() => {
    if (watchlistSymbols.length === 0) {
      return ELEMENTS.map((el) => ({
        ...el,
        status: 'unavailable',
        statusLabel: 'No symbols',
        coverage: 0,
        total: 0,
      }));
    }

    return ELEMENTS.map((el) => {
      if (el.minBars === 0) {
        // Non-OHLCV element — available if we have any symbols
        return {
          ...el,
          status: watchlistSymbols.length > 0 ? 'complete' : 'unavailable',
          statusLabel: watchlistSymbols.length > 0 ? 'Available' : 'Unavailable',
          coverage: watchlistSymbols.length,
          total: watchlistSymbols.length,
        };
      }

      // Count symbols with enough bars for this element
      const symbolTickers = new Set(watchlistSymbols.map((s) => (typeof s === 'string' ? s : s.ticker).toUpperCase()));
      let withData = 0;
      for (const f of freshnessData) {
        const ticker = (f.ticker || f.symbol || '').toUpperCase();
        if (symbolTickers.has(ticker) && f.barCount >= el.minBars) {
          withData++;
        }
      }

      let status = 'unavailable';
      let statusLabel = 'No Data';
      if (withData > 0 && withData < watchlistSymbols.length) {
        status = 'partial';
        statusLabel = 'Partial';
      } else if (withData >= watchlistSymbols.length && withData > 0) {
        status = 'complete';
        statusLabel = 'Complete';
      }

      return {
        ...el,
        status,
        statusLabel,
        coverage: withData,
        total: watchlistSymbols.length,
      };
    });
  }, [watchlistSymbols, freshnessData]);

  const statusIcon = { complete: '✅', partial: '⚠️', unavailable: '❌', unknown: '⏳' };

  if (loading) {
    return <div className="trading-platforms-page"><div className="tp-page-header"><h1>Data Elements</h1></div><p style={{ padding: '1rem' }}>Loading...</p></div>;
  }

  if (error) {
    return <div className="trading-platforms-page"><div className="tp-page-header"><h1>Data Elements</h1></div><p style={{ padding: '1rem', color: 'var(--tcs-warn)' }}>Could not load data: {error}</p></div>;
  }

  return (
    <div className="trading-platforms-page">
      <header className="tp-page-header">
        <h1>Data Elements</h1>
        <p>
          Each element checks whether the required data exists for its directive to produce valid scores.
          {watchlistSymbols.length > 0 && (
            <> Testing against <strong>{watchlistSymbols.length} symbols</strong> from the default watchlist.</>
          )}
          {watchlistSymbols.length === 0 && ' No default watchlist found — add symbols to a watchlist and set it as default.'}
        </p>
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
              <span className="de-coverage">
                {el.coverage !== undefined ? `${el.coverage}/${el.total} symbols` : '—'}
              </span>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}
