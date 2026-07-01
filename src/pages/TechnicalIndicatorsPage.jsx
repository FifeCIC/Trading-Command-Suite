import { useState, useEffect, useMemo } from 'react';
import { useQueries } from '@tanstack/react-query';
import { apiGet } from '../core/api/client';
import LoadingSkeleton from '../components/LoadingSkeleton';
import './technical-indicators.css';

const INDICATORS = [
  { id: 'rsi', name: 'RSI', fullName: 'Relative Strength Index', category: 'Momentum', defaultPeriod: 14 },
  { id: 'macd', name: 'MACD', fullName: 'Moving Average Convergence Divergence', category: 'Trend', defaultPeriod: '12/26/9' },
  { id: 'sma', name: 'SMA', fullName: 'Simple Moving Average', category: 'Trend', defaultPeriod: 20 },
  { id: 'ema', name: 'EMA', fullName: 'Exponential Moving Average', category: 'Trend', defaultPeriod: 20 },
  { id: 'bb', name: 'Bollinger', fullName: 'Bollinger Bands', category: 'Volatility', defaultPeriod: '20,2' },
  { id: 'atr', name: 'ATR', fullName: 'Average True Range', category: 'Volatility', defaultPeriod: 14 },
  { id: 'sto', name: 'Stochastic', fullName: 'Stochastic Oscillator', category: 'Momentum', defaultPeriod: '14/3/3' },
  { id: 'adx', name: 'ADX', fullName: 'Average Directional Index', category: 'Trend', defaultPeriod: 14 },
  { id: 'cci', name: 'CCI', fullName: 'Commodity Channel Index', category: 'Momentum', defaultPeriod: 20 },
  { id: 'mfi', name: 'MFI', fullName: 'Money Flow Index', category: 'Volume', defaultPeriod: 14 },
  { id: 'obv', name: 'OBV', fullName: 'On-Balance Volume', category: 'Volume', defaultPeriod: '—' },
  { id: 'ichimoku', name: 'Ichimoku', fullName: 'Ichimoku Cloud', category: 'Trend', defaultPeriod: '9/26/52' },
];

const DEFAULT_SYMBOLS = ['AAPL', 'NVDA', 'TSLA', 'MSFT', 'SPY', 'XAUUSD', 'EURUSD', 'BTCUSD'];

export default function TechnicalIndicatorsPage() {
  const [symbol, setSymbol] = useState('SPY');
  const [symbols, setSymbols] = useState(DEFAULT_SYMBOLS);
  const [expandedInd, setExpandedInd] = useState(null);
  const [categoryFilter, setCategoryFilter] = useState('all');

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

  // Fetch each indicator's current value from the real API
  const indicatorQueries = useQueries({
    queries: INDICATORS.map((ind) => ({
      queryKey: ['indicators', symbol, 'H1', ind.id],
      queryFn: () => apiGet(`/api/indicators/${symbol}/${ind.id}?tf=H1`),
      refetchInterval: 60_000,
      enabled: ind.id !== 'obv' && ind.id !== 'ichimoku' && ind.id !== 'sto' && ind.id !== 'bb', // skip complex ones for now
    })),
  });

  const isLoading = indicatorQueries.some((q) => q.isLoading);
  const anyError = indicatorQueries.some((q) => q.isError);

  const indicatorsWithData = useMemo(() => {
    return INDICATORS.map((ind, i) => {
      const query = indicatorQueries[i];
      const data = query?.data;
      const cv = data?.currentValue ?? null;
      return {
        ...ind,
        currentValue: cv,
        signal: cv != null ? (cv > 70 ? 'sell' : cv < 30 ? 'buy' : 'neutral') : null,
      };
    });
  }, [indicatorQueries]);

  const filtered = categoryFilter === 'all'
    ? indicatorsWithData
    : indicatorsWithData.filter((i) => i.category.toLowerCase() === categoryFilter);

  const categories = ['all', ...new Set(INDICATORS.map((i) => i.category.toLowerCase()))];

  return (
    <div className="ti-page">
      <header className="ti-header">
        <h1>Technical Indicators</h1>
        <p className="ti-subtitle">
          Browse indicators applied to <strong>{symbol}</strong>. Click any card to expand the full chart.
        </p>
      </header>

      {/* Controls */}
      <div className="ti-controls">
        <div className="ti-field">
          <label>Symbol</label>
          <select value={symbol} onChange={(e) => setSymbol(e.target.value)}>
            {symbols.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </div>
        <div className="ti-field">
          <label>Category</label>
          <div className="ti-cat-tabs">
            {categories.map((cat) => (
              <button
                key={cat}
                type="button"
                className={`ti-cat-tab ${categoryFilter === cat ? 'ti-cat-active' : ''}`}
                onClick={() => setCategoryFilter(cat)}
              >
                {cat === 'all' ? 'All' : cat.charAt(0).toUpperCase() + cat.slice(1)}
              </button>
            ))}
          </div>
        </div>
      </div>

      {isLoading && <LoadingSkeleton variant="card" count={4} />}

      {anyError && !isLoading && (
        <div className="ti-section"><p className="error">Could not load indicator data. Is the NestJS API running?</p></div>
      )}

      {/* Indicator grid */}
      <section className="ti-section">
        <div className="ti-grid">
          {filtered.map((ind) => {
            const isExpanded = expandedInd === ind.id;
            const signalCls = ind.signal === 'buy' ? 'ti-buy' : ind.signal === 'sell' ? 'ti-sell' : 'ti-neutral';

            return (
              <div
                key={ind.id}
                className={`ti-card ${isExpanded ? 'ti-expanded' : ''}`}
                onClick={() => setExpandedInd(isExpanded ? null : ind.id)}
              >
                <div className="ti-card-header">
                  <div className="ti-card-title">
                    <span className="ti-ind-name">{ind.name}</span>
                    <span className="ti-ind-full">{ind.fullName}</span>
                  </div>
                  <span className={`ti-signal-dot ${signalCls}`}>
                    {ind.signal === 'buy' ? '▲' : ind.signal === 'sell' ? '▼' : '●'}
                  </span>
                </div>

                {/* Value gauge */}
                {ind.currentValue != null ? (
                  <div className="ti-value-bar-wrap">
                    <div className="ti-value-bar" style={{ width: `${Math.min(100, Math.max(0, ind.currentValue))}%` }} />
                    <span className="ti-value-bar-label">{ind.currentValue}</span>
                  </div>
                ) : (
                  <div className="ti-value-bar-wrap">
                    <div className="ti-value-bar ti-value-bar--empty" />
                    <span className="ti-value-bar-label ti-value-bar-label--muted">No data</span>
                  </div>
                )}

                <div className="ti-card-footer">
                  <span className="ti-category-chip">{ind.category}</span>
                  <span className="ti-period">Period: {ind.defaultPeriod}</span>
                </div>

                {/* Expanded detail */}
                {isExpanded && (
                  <div className="ti-expanded-body" onClick={(e) => e.stopPropagation()}>
                    <div className="ti-expanded-meta">
                      <div className="ti-meta-row">
                        <span>Current Value</span>
                        <strong>{ind.currentValue != null ? ind.currentValue : 'N/A'}</strong>
                      </div>
                      <div className="ti-meta-row">
                        <span>Signal</span>
                        <strong className={signalCls}>{ind.signal?.toUpperCase() || 'N/A'}</strong>
                      </div>
                      <div className="ti-meta-row">
                        <span>Default Period</span>
                        <strong>{ind.defaultPeriod}</strong>
                      </div>
                      <div className="ti-meta-row">
                        <span>Category</span>
                        <strong>{ind.category}</strong>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
