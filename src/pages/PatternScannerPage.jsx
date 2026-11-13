import { useState, useMemo, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { useQuery } from '@tanstack/react-query';
import { createChart, CandlestickSeries, createSeriesMarkers } from 'lightweight-charts';
import { apiGet } from '../core/api/client';
import { toChartSeries, toChartTimes } from '../core/chart-time';
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
    queryFn: () => apiGet(`/api/market-data/candles?symbol=${encodeURIComponent(symbol)}&timeframe=${timeframe}`),
    retry: 1,
    staleTime: 60_000,
  });

  // Memoised so the three hooks below (detections, chart series, raw times) do not see a new array
  // identity on every render — otherwise they recompute and the chart effect tears down and rebuilds
  // the series each time an unrelated state change (filter, expanded card) re-renders the page.
  const rawCandles = useMemo(
    () => candlesQuery.data?.bars || candlesQuery.data?.candles || [],
    [candlesQuery.data],
  );
  const hasRealData = rawCandles.length > 0;

  const detections = useMemo(() => {
    if (!hasRealData) return [];
    return detectPatterns(rawCandles);
  }, [rawCandles, hasRealData]);

  // Format candles for lightweight-charts
  //
  // ⚠️ lightweight-charts requires `time` to be UNIQUE and ASCENDING per series — it ASSERTS
  // (`data must be asc ordered by time, index=1, time=…, prev time=…`) and the exception takes the
  // whole page down into the error boundary.
  //
  // This used to be `new Date(c.timestamp).toISOString().split('T')[0]` — a DATE STRING — which
  // collapsed intraday bars onto a single day. Measured 2026-11-13 on the default view (SPY · 1H):
  // **100 bars → 13 distinct dates**, so 87 bars shared a timestamp and `setData` threw before the
  // chart ever drew. Even without the throw the chart would have shown 13 daily candles for 100
  // hourly bars, so intraday resolution was destroyed as well.
  //
  // A UTCTimestamp (seconds) is valid for BOTH intraday and daily series, so one code path serves all
  // six timeframe pills. Duplicates are collapsed defensively because the assert is fatal, and the
  // sort is explicit rather than trusted from the provider.
  const chartCandles = useMemo(() => toChartSeries(rawCandles), [rawCandles]);

  // ⚠️ `detections[].index` indexes `rawCandles`, but the chart consumes the DEDUPED series above,
  // so the two can differ in length. Markers resolve their time through this parallel array rather
  // than through `candles[d.index]`, which would silently point at the wrong bar.
  const rawTimes = useMemo(() => toChartTimes(rawCandles), [rawCandles]);

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
          Real-time candle pattern detection — {hasRealData ? `${chartCandles.length} candles loaded` : 'no data loaded'}
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
      {/* Candlestick chart */}
      {chartCandles.length > 0 && (
        <section className="ps-section">
          <PsChart candles={chartCandles} rawTimes={rawTimes} detections={detections} />
        </section>
      )}

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
              onClick={() => {
                const newId = expandedId === `${p.pattern}-${p.index}` ? null : `${p.pattern}-${p.index}`;
                setExpandedId(newId);
                // Dispatch custom event for chart to scroll to this candle
                if (newId) {
                  window.dispatchEvent(new CustomEvent('ps-scroll-to', { detail: { index: p.index } }));
                }
              }}
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

// ── Chart Component ──────────────────────────────────────

function PsChart({ candles, rawTimes, detections }) {
  const containerRef = useRef(null);
  const chartRef = useRef(null);

  useEffect(() => {
    if (!containerRef.current || !candles?.length) return;

    const chart = createChart(containerRef.current, {
      height: 380,
      layout: {
        background: { color: 'transparent' },
        textColor: 'var(--ink-soft, #94a3b8)',
        fontSize: 11,
      },
      grid: {
        vertLines: { color: 'rgba(148,163,184,0.06)' },
        horzLines: { color: 'rgba(148,163,184,0.06)' },
      },
      crosshair: { mode: 0 },
      timeScale: { borderColor: 'rgba(148,163,184,0.1)', barSpacing: 8 },
      rightPriceScale: { borderColor: 'rgba(148,163,184,0.1)' },
    });

    chartRef.current = chart;

    const cs = chart.addSeries(CandlestickSeries, {
      upColor: '#22c55e', downColor: '#ef4444',
      borderUpColor: '#22c55e', borderDownColor: '#ef4444',
      wickUpColor: '#22c55e', wickDownColor: '#ef4444',
    });
    cs.setData(candles);

    // Add pattern markers with enhanced visibility
    if (detections?.length > 0) {
      const markers = detections.map((d) => ({
        // Resolve through `rawTimes` (parallel to the RAW bars, which is what `d.index` indexes)
        // rather than `candles[d.index]`, which is the deduped series and may be shorter.
        time: rawTimes?.[d.index],
        position: d.type === 'bullish' ? 'belowBar' : 'aboveBar',
        color: d.type === 'bullish' ? '#22c55e' : d.type === 'bearish' ? '#ef4444' : '#f59e0b',
        shape: d.type === 'bullish' ? 'arrowUp' : d.type === 'bearish' ? 'arrowDown' : 'circle',
        text: d.pattern,
        size: 3,
      })).filter((m) => m.time).sort((a, b) => a.time - b.time);

      // ⚠️ v5 REMOVED `series.setMarkers()` — markers are now an OBJECT owned by a handle.
      // This call threw `cs.setMarkers is not a function` whenever detections existed, so the chart
      // never appeared on any scan with a pattern in it. `createSeriesMarkers` returns the handle;
      // the chart is rebuilt from scratch in this effect and removed by its cleanup, so the handle
      // does not need to outlive it.
      createSeriesMarkers(cs, markers);
    }

    chart.timeScale().fitContent();

    // Listen for scroll-to events from pattern cards
    const handleScrollTo = (e) => {
      const { index } = e.detail;
      const targetTime = candles[index]?.time;
      if (targetTime && chartRef.current) {
        chartRef.current.timeScale().scrollToPosition(
          chartRef.current.timeScale().coordinateToIndex(
            chartRef.current.timeScale().timeToCoordinate(targetTime) ?? 0
          ) / (candles.length || 1),
          false
        );
        // Flash the target candle area briefly
        setTimeout(() => {
          try {
            chartRef.current.timeScale().fitContent();
          } catch {}
        }, 2000);
      }
    };

    window.addEventListener('ps-scroll-to', handleScrollTo);

    return () => {
      window.removeEventListener('ps-scroll-to', handleScrollTo);
      chart.remove();
      chartRef.current = null;
    };
  }, [candles, rawTimes, detections]);

  return <div ref={containerRef} className="ps-chart-container" />;
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
