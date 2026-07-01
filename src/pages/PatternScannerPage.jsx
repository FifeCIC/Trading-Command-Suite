import { useState, useMemo, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { useQuery } from '@tanstack/react-query';
import { apiGet } from '../core/api/client';
import { detectPatterns } from '../core/patterns/pattern-detector';
import './pattern-scanner.css';

const TIMEFRAMES = ['1M', '5M', '15M', '1H', '4H', '1D'];
const DEFAULT_SYMBOLS = ['AAPL', 'NVDA', 'TSLA', 'MSFT', 'BTCUSD', 'EURUSD', 'XAUUSD', 'SPY', 'MSTR'];

export default function PatternScannerPage() {
  const [symbol, setSymbol] = useState('SPY');
  const [symbols, setSymbols] = useState(DEFAULT_SYMBOLS);
  const [timeframe, setTimeframe] = useState('1H');
  const [filterType, setFilterType] = useState('all');
  const [expandedId, setExpandedId] = useState(null);

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

  const candlesQuery = useQuery({
    queryKey: ['candles', symbol, timeframe],
    queryFn: () => apiGet(`/api/market-data/candles/${symbol}?timeframe=${timeframe}`),
    retry: 1,
    staleTime: 60_000,
  });

  const rawCandles = candlesQuery.data?.bars || candlesQuery.data?.candles || [];
  const hasRealData = rawCandles.length > 0;

  const detections = useMemo(() => {
    if (!hasRealData) return [];
    return detectPatterns(rawCandles);
  }, [rawCandles, hasRealData]);

  const filtered = filterType === 'all' ? detections : detections.filter((d) => d.type === filterType);

  const stats = useMemo(() => {
    const bull = detections.filter((d) => d.type === 'bullish').length;
    const bear = detections.filter((d) => d.type === 'bearish').length;
    const neut = detections.filter((d) => d.type === 'neutral').length;
    return { bull, bear, neut, total: detections.length };
  }, [detections]);

  return (
    <div className="ps-page">
      <header className="ps-header">
        <h1>Pattern Scanner</h1>
        <p className="ps-subtitle">
          Real candlestick pattern detection on <strong>{symbol}</strong> · {candles.length} candles ·
          {useRealData && rawCandles.length > 0 ? ' Live data' : ' Mock data'}
        </p>
      </header>

      {/* Controls */}
      <div className="ps-controls">
        <div className="ps-symbol-pills">
          {symbols.map((s) => (
            <button key={s} type="button" className={`ps-sym-pill ${symbol === s ? 'active' : ''}`} onClick={() => setSymbol(s)}>
              {s}
            </button>
          ))}
        </div>
        <div className="ps-tf-pills">
          {TIMEFRAMES.map((tf) => (
            <button key={tf} type="button" className={`ps-tf-pill ${timeframe === tf ? 'active' : ''}`} onClick={() => setTimeframe(tf)}>
              {tf}
            </button>
          ))}
        </div>
      </div>

      {candlesQuery.isLoading && (
        <p className="ps-empty">Loading candle data for {symbol}…</p>
      )}

      {!candlesQuery.isLoading && !hasRealData && (
        <p className="ps-empty">No OHLCV data available for {symbol} on {timeframe}. Try another symbol or import market data first.</p>
      )}

      {hasRealData && (
      <>
      {/* Stats bar */}
      <motion.div className="ps-stats" initial={{ opacity: 0, y: -5 }} animate={{ opacity: 1, y: 0 }}>
        <span className="ps-stat"><strong>{stats.total}</strong> patterns</span>
        <span className="ps-stat ps-stat-bull">🟢 {stats.bull} bullish</span>
        <span className="ps-stat ps-stat-bear">🔴 {stats.bear} bearish</span>
        <span className="ps-stat">⚪ {stats.neut} neutral</span>
        <div className="ps-filter">
          <button className={filterType === 'all' ? 'active' : ''} onClick={() => setFilterType('all')}>All</button>
          <button className={filterType === 'bullish' ? 'active' : ''} onClick={() => setFilterType('bullish')}>Bullish</button>
          <button className={filterType === 'bearish' ? 'active' : ''} onClick={() => setFilterType('bearish')}>Bearish</button>
        </div>
      </motion.div>

      {/* Pattern grid */}
      <div className="ps-grid">
        <AnimatePresence mode="popLayout">
          {filtered.length === 0 && (
            <motion.p className="ps-empty" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
              No patterns detected for {symbol} on {timeframe}.
            </motion.p>
          )}
          {filtered.map((p, i) => (
            <motion.div
              key={`${p.pattern}-${p.index}`}
              layout
              initial={{ opacity: 0, scale: 0.9, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: -10 }}
              transition={{ duration: 0.2, delay: i * 0.03 }}
              whileHover={{ scale: 1.02 }}
              className={`ps-card ${p.type}`}
              onClick={() => setExpandedId(expandedId === `${p.pattern}-${p.index}` ? null : `${p.pattern}-${p.index}`)}
            >
              <div className="ps-card-header">
                <span className="ps-card-name">{p.pattern}</span>
                <span className={`ps-card-type ${p.type}`}>{p.type}</span>
              </div>
              {/* Mini candle viz */}
              <div className="ps-mini-candle">
                <CandleStub candle={rawCandles[p.index]} prevCandle={rawCandles[p.index - 1]} />
              </div>
              <div className="ps-card-footer">
                <span className="ps-card-bar">{p.bar}</span>
                <div className="ps-confidence-bar">
                  <motion.div className="ps-confidence-fill" initial={{ width: 0 }} animate={{ width: `${p.confidence}%` }}
                    transition={{ duration: 0.5, delay: 0.1 }}
                    style={{ background: p.confidence >= 70 ? '#22c55e' : p.confidence >= 45 ? '#f59e0b' : '#ef4444' }} />
                </div>
                <span className="ps-card-conf">{p.confidence}%</span>
              </div>

              {/* Expanded detail */}
              <AnimatePresence>
                {expandedId === `${p.pattern}-${p.index}` && (
                  <motion.div className="ps-expand" initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}>
                    <div className="ps-expand-grid">
                      <div><strong>Open</strong> {rawCandles[p.index].open}</div>
                      <div><strong>High</strong> {rawCandles[p.index].high}</div>
                      <div><strong>Low</strong> {rawCandles[p.index].low}</div>
                      <div><strong>Close</strong> {rawCandles[p.index].close}</div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
      </>
      )}
    </div>
  );
}

// Mini candlestick visual
function CandleStub({ candle, prevCandle }) {
  if (!candle) return null;
  const { open, high, low, close } = candle;
  const bullish = close >= open;
  const color = bullish ? '#22c55e' : '#ef4444';
  const range = Math.max(high - low, 0.01);
  const bodyTop = ((Math.max(open, close) - low) / range) * 40;
  const bodyH = Math.max(1, (Math.abs(close - open) / range) * 40);
  const wickTop = ((high - low) / range) * 40;

  return (
    <svg width="36" height="48" viewBox="0 0 36 48">
      <line x1={18} y1={48 - wickTop} x2={18} y2={48} stroke={color} strokeWidth={1} />
      <rect x={8} y={48 - bodyTop - bodyH} width={20} height={Math.max(0.5, bodyH)} fill={color} rx={2} />
    </svg>
  );
}
