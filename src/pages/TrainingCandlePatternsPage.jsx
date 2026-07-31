import { useState, useEffect, useCallback } from 'react';
import CandlePatternChart from '../components/CandlePatternChart';
import PatternDetailPanel from '../components/PatternDetailPanel';
import ApiOfflineBanner from '../components/ApiOfflineBanner';
import './training-candle-patterns-page.css';
import PageInfoPopover from '../components/PageInfoPopover';

const TIMEFRAMES = ['M5', 'M15', 'M30', 'H1', 'H4', 'D1'];
const SYMBOLS = ['EURUSD', 'GBPUSD', 'USDJPY', 'AUDUSD', 'NZDUSD', 'XAUUSD', 'BTCUSD', 'NVDA', 'AAPL'];

export default function TrainingCandlePatternsPage() {
  const [symbol, setSymbol] = useState('EURUSD');
  const [timeframe, setTimeframe] = useState('H1');
  const [mode, setMode] = useState('live');
  const [bars, setBars] = useState([]);
  const [patterns, setPatterns] = useState([]);
  const [selectedPattern, setSelectedPattern] = useState(null);
  const [loading, setLoading] = useState(false);
  const [patternCount, setPatternCount] = useState(0);
  const [error, setError] = useState(null);

  const fetchPatterns = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const barCount = mode === 'history' ? 200 : 100;
      const url = mode === 'history'
        ? `/api/training/candle-patterns/history?symbol=${symbol}&bars=${barCount}`
        : `/api/training/candle-patterns?symbol=${symbol}&bars=${barCount}`;

      const res = await fetch(url);
      if (!res.ok) throw new Error(`API error: ${res.status}`);
      const data = await res.json();

      // Convert API response to chart-usable bars
      const chartBars = data.bars || generateLocalBars(data.patterns, barCount);
      setBars(chartBars);
      setPatterns(data.patterns || []);
      setPatternCount((data.patterns || []).length);
    } catch (e) {
      setError(e.message);
      // Fall back to local sample data
      const fallbackBars = generateLocalBars([], 100);
      setBars(fallbackBars);
    } finally {
      setLoading(false);
    }
  }, [symbol, mode]);

  useEffect(() => {
    fetchPatterns();
  }, [fetchPatterns]);

  const handlePatternClick = (pattern) => {
    setSelectedPattern(pattern);
  };

  const closeDetail = () => {
    setSelectedPattern(null);
  };

  return (
    <div className="training-candle-patterns-page">
      <div className="page-header">
        <div className="header-left">
          <h1>Candle Pattern Training
          <PageInfoPopover>
            Learn to identify candlestick patterns. The same patterns that feed your trading signals.
          </PageInfoPopover>
        </h1>
        </div>
        <div className="header-right">
          <div className="pattern-counter" title="Total patterns detected">
            <span className="counter-icon">📊</span>
            <span className="counter-value">{patternCount}</span>
            <span className="counter-label">patterns found</span>
          </div>
        </div>
      </div>

      {/* Controls */}
      <div className="controls-bar">
        <div className="control-group">
          <label>Symbol</label>
          <select value={symbol} onChange={e => setSymbol(e.target.value)}>
            {SYMBOLS.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>

        <div className="control-group">
          <label>Timeframe</label>
          <select value={timeframe} onChange={e => setTimeframe(e.target.value)}>
            {TIMEFRAMES.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>

        <div className="control-group mode-tabs">
          <button
            className={`mode-btn ${mode === 'live' ? 'active' : ''}`}
            onClick={() => setMode('live')}
          >
            🔴 Live
          </button>
          <button
            className={`mode-btn ${mode === 'history' ? 'active' : ''}`}
            onClick={() => setMode('history')}
          >
            📜 Backtest Explorer
          </button>
        </div>

        <button className="refresh-btn" onClick={fetchPatterns} disabled={loading}>
          {loading ? '⏳ Loading...' : '🔄 Refresh'}
        </button>
      </div>

      {/* Chart Area */}
      <div className="chart-area">
        {error && <ApiOfflineBanner serviceName="NestJS Backend" port={3201} />}

        <div className="chart-wrapper">
          <CandlePatternChart
            bars={bars}
            patterns={patterns}
            onPatternClick={handlePatternClick}
          />
        </div>

        {selectedPattern && (
          <PatternDetailPanel
            pattern={selectedPattern}
            onClose={closeDetail}
          />
        )}
      </div>

      {/* Pattern List Summary */}
      <div className="pattern-summary">
        <h3>Detected Patterns ({patterns.length})</h3>
        {patterns.length === 0 ? (
          <p className="no-patterns">No patterns detected. Try a different symbol or timeframe.</p>
        ) : (
          <div className="pattern-list">
            {patterns.slice(-20).reverse().map((p, i) => (
              <div
                key={p.patternId + '-' + p.candleIndex}
                className={`pattern-item direction-${p.direction}`}
                onClick={() => setSelectedPattern(p)}
              >
                <span className="pattern-icon">
                  {p.direction === 'bullish' ? '🟢' : p.direction === 'bearish' ? '🔴' : '⚪'}
                </span>
                <span className="pattern-name">{p.patternName}</span>
                <span className="pattern-score">{p.score}</span>
                <span className="pattern-time">
                  {new Date(p.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/** Generate sample bars when API is not available */
function generateLocalBars(patterns, count = 100) {
  const bars = [];
  let price = 1.0850;
  const now = Date.now();
  for (let i = 0; i < count; i++) {
    const change = (Math.random() - 0.5) * 0.004;
    const open = price;
    const close = open + change;
    bars.push({
      timestamp: new Date(now - (count - i) * 3600000),
      open: Number(open.toFixed(5)),
      high: Number(Math.max(open, close) + Math.random() * 0.001).toFixed(5),
      low: Number(Math.min(open, close) - Math.random() * 0.001).toFixed(5),
      close: Number(close.toFixed(5)),
      volume: Math.floor(Math.random() * 10000 + 5000),
    });
    price = close;
  }
  return bars;
}
