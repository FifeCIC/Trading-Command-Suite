const TIMEFRAMES = [
  { value: '1h', label: '1 Hour' },
  { value: '4h', label: '4 Hours' },
  { value: '1d', label: '1 Day' },
  { value: '1w', label: '1 Week' },
];

const SYMBOLS = ['AAPL', 'NVDA', 'TSLA', 'MSFT', 'SPY'];

const INDICATORS = [
  { id: 'support-resistance', label: 'S/R Levels', color: '#a78bfa' },
  { id: 'fair-value-gap', label: 'Fair Value Gaps', color: '#f59e0b' },
  { id: 'volatility-envelope', label: 'Volatility Envelope', color: '#06b6d4' },
  { id: 'bos-markers', label: 'BOS Markers', color: '#ef4444' },
  { id: 'patterns', label: 'Candle Patterns', color: '#22c55e' },
];

export default function ChartComparisonPage() {
  const [symbol, setSymbol] = useState('AAPL');
  const [timeframe, setTimeframe] = useState('1h');
  const [activeIndicators, setActiveIndicators] = useState(new Set());
  const uplotRef = useRef(null);
  const [renderTime, setRenderTime] = useState({ uplot: 0 });

  const candles = useMemo(() => [], [symbol, timeframe]);

  const toggleIndicator = (id) => {
    setActiveIndicators((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  // Apply indicator overlays to uPlot chart
  const applyIndicators = () => {
    if (!uplotRef.current) return;
    // S/R lines
    if (activeIndicators.has('support-resistance')) {
      const price = candles[Math.floor(candles.length / 2)]?.close || 100;
      uplotRef.current.addHorizontalLine({ price: price * 0.95, color: '#a78bfa', style: 'dashed', label: 'Support' });
      uplotRef.current.addHorizontalLine({ price: price * 1.05, color: '#a78bfa', style: 'dashed', label: 'Resistance' });
    }
    // Fair value gap zone
    if (activeIndicators.has('fair-value-gap')) {
      const mid = Math.floor(candles.length / 2);
      const price = candles[mid]?.close || 100;
      uplotRef.current.addZone({
        startTime: candles[mid - 5]?.time || 0,
        endTime: candles[mid + 5]?.time || 0,
        topPrice: price * 1.02,
        bottomPrice: price * 0.98,
        color: '#f59e0b',
        label: 'FVG',
      });
    }
    // Volatility envelope
    if (activeIndicators.has('volatility-envelope')) {
      const price = candles[Math.floor(candles.length / 2)]?.close || 100;
      uplotRef.current.addZone({
        startTime: candles[0]?.time || 0,
        endTime: candles[candles.length - 1]?.time || 0,
        topPrice: price * 1.08,
        bottomPrice: price * 0.92,
        color: '#06b6d4',
        label: 'Vol Envelope',
      });
    }
  };

  const handleUplotReady = () => {
    setTimeout(applyIndicators, 100);
  };

  return (
    <div className="chart-compare-page">
      <header className="cc-header">
        <h2>Chart Library Comparison</h2>
        <p>Side-by-side: TradingView Lightweight Charts vs. uPlot. Same data, same symbol.</p>
      </header>

      <div className="pf-unavailable">
        <h2>Chart Data Provider Required</h2>
        <p>Charts require a configured market data provider (e.g. Alpha Vantage or Trading212).</p>
        <p className="pf-hint">Set ALPHA_VANTAGE_API_KEY or TRADING212_API_KEY in your .env file to enable live charts.</p>
      </div>

      <div className="cc-controls">
        <label htmlFor="cc-symbol">Symbol</label>
        <select id="cc-symbol" value={symbol} onChange={(e) => setSymbol(e.target.value)}>
          {SYMBOLS.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>

        <label htmlFor="cc-tf">Timeframe</label>
        <select id="cc-tf" value={timeframe} onChange={(e) => setTimeframe(e.target.value)}>
          {TIMEFRAMES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
        </select>

        <span style={{ color: '#64748b', fontSize: '0.8rem' }}>
          {candles.length} candles loaded
        </span>
      </div>

      <div className="cc-grid">
        {/* TradingView Lightweight Charts panel */}
        <div className="cc-panel">
          <div className="cc-panel-header">
            <span>TradingView Lightweight Charts</span>
            <span style={{ color: '#64748b', fontSize: '0.7rem' }}>Free tier</span>
          </div>
          <div className="cc-panel-body" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 400 }}>
            <div style={{ color: '#64748b', textAlign: 'center' }}>
              <p style={{ fontSize: '1.2rem' }}>📊</p>
              <p>TradingView chart renders in Backtest view.</p>
              <p style={{ fontSize: '0.8rem' }}>
                See <code style={{ background: '#1e2030', padding: '0.15rem 0.4rem', borderRadius: '3px' }}>/backtest</code> for the
                TradingView Lightweight Charts implementation with candlestick rendering, RSI, and MACD indicator panes.
              </p>
            </div>
          </div>
        </div>

        {/* uPlot panel */}
        <div className="cc-panel">
          <div className="cc-panel-header">
            <span>uPlot</span>
            <span style={{ color: '#64748b', fontSize: '0.7rem' }}>Open source · 45KB</span>
          </div>
          <div className="cc-panel-body">
            <UPlotChart
              ref={uplotRef}
              candles={candles}
              height={400}
              onReady={handleUplotReady}
            />
          </div>
        </div>
      </div>

      {/* Indicator toggles */}
      <div className="cc-section">
        <h3>Directive Chart Indicators</h3>
        <div className="cc-indicators">
          {INDICATORS.map((ind) => (
            <button
              key={ind.id}
              className={`cc-indicator-btn ${activeIndicators.has(ind.id) ? 'active' : ''}`}
              style={activeIndicators.has(ind.id) ? { borderColor: ind.color, color: ind.color } : {}}
              onClick={() => toggleIndicator(ind.id)}
            >
              {ind.label}
            </button>
          ))}
        </div>
      </div>

      {/* Performance metrics */}
      <div className="cc-metrics">
        <span>uPlot render: {renderTime.uplot}ms</span>
        <span>Library size: uPlot ~45KB vs TradingView ~160KB</span>
      </div>

      {/* Affiliate link */}
      <div className="cc-affiliate">
        <a href="https://www.tradingview.com/gopro/?aff_id=TRADINGCS" target="_blank" rel="noopener noreferrer">
          Upgrade to TradingView Premium ↗
        </a>
        <span style={{ marginLeft: '0.5rem' }}>— advanced charting, real-time data, more indicators</span>
      </div>
    </div>
  );
}
