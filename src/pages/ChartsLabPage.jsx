/**
 * Charts Lab
 * =========
 * Experimental charting playground. Goal: build a custom charting
 * solution approaching TradingView quality using:
 *
 * - Canvas 2D for candle rendering (fast, GPU-composited)
 * - uPlot for high-performance time-series (or D3 as fallback)
 * - Synthetic sub-minute candles from MT5 quote polling
 * - Web Workers for indicator calculation off main thread
 * - Multi-timeframe overlay (1s quote → 5s/15s/1m synthetic)
 *
 * Tech stack to explore:
 *   uPlot      — 45KB, 150k+ datapoints at 60fps, canvas-based
 *   lightweight-charts — TradingView's free lib (good but limited)
 *   Canvas API  — fully custom, maximum control
 *   D3.js       — flexible but slower at scale
 *   Web Workers — offload TA computation
 */

import { useState, useRef, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiGet } from '../core/api/client';
import { SPEED_PROTOCOL_SYMBOLS } from '../data/speed-protocols';
import CandlestickChart from '../components/CandlestickChart';
import CanvasCandlestickChart from '../components/CanvasCandlestickChart';
import './charts-lab.css';

const TIMEFRAMES = ['1s', '5s', '15s', '1m', '5m'];
const ENGINES = [
  { id: 'canvas', label: 'Canvas 2D', desc: 'Custom-built candle renderer' },
  { id: 'lightweight', label: 'Lightweight Charts', desc: 'TradingView free lib' },
  { id: 'uplot', label: 'uPlot', desc: '45KB, 150k+ pts at 60fps' },
];

const INDICATOR_PRESETS = [
  { type: 'ema', period: 9, color: '#f59e0b', label: 'EMA 9' },
  { type: 'ema', period: 21, color: '#3b82f6', label: 'EMA 21' },
  { type: 'ema', period: 50, color: '#a78bfa', label: 'EMA 50' },
  { type: 'sma', period: 20, color: '#ec4899', label: 'SMA 20' },
  { type: 'sma', period: 200, color: '#ef4444', label: 'SMA 200' },
];

export default function ChartsLabPage() {
  const [symbol, setSymbol] = useState('BTCUSD');
  const [timeframe, setTf] = useState('5s');
  const [engine, setEngine] = useState('lightweight');
  const [bars, setBars] = useState(60);
  const [activeIndicators, setActiveIndicators] = useState(new Set(['ema-9', 'ema-21']));
  const chartContainerRef = useRef(null);

  // ── Tick accumulator for synthetic candles ──
  const [ticks, setTicks] = useState([]);
  const tickCountRef = useRef(0);

  // ── Live quotes ────────────────────────────────────
  const tfMs = { '1s': 1000, '5s': 5000, '15s': 15000, '1m': 60000, '5m': 300000 };
  const quoteQuery = useQuery({
    queryKey: ['lab-quote', symbol],
    queryFn: () => apiGet(`/api/speed/quote/${symbol}`).catch(() => null),
    refetchInterval: tfMs[timeframe] ?? 1000,
    staleTime: 200,
    enabled: !!symbol,
  });

  // ── MT5 candles (1m+) ──────────────────────────────
  const candlesQuery = useQuery({
    queryKey: ['lab-candles', symbol, timeframe],
    queryFn: () =>
      apiGet(`/api/providers/mt5/candles?symbol=${symbol}&timeframe=${timeframe}&limit=${bars}`).catch(() => null),
    refetchInterval: tfMs[timeframe] ?? 60000,
    staleTime: 5000,
    enabled: ['1m', '5m'].includes(timeframe) && !!symbol,
  });

  const quote = quoteQuery.data;
  const candles = candlesQuery.data?.bars ?? [];

  // Accumulate ticks into our synthetic candle engine
  const prevQuoteRef = useRef(null);
  if (quote && quote !== prevQuoteRef.current) {
    prevQuoteRef.current = quote;
    const now = Date.now();
    const mid = (quote.bid + quote.ask) / 2;
    if (mid > 0) {
      tickCountRef.current++;
      setTicks(prev => {
        const next = [...prev, { time: now, bid: quote.bid, ask: quote.ask, mid }];
        // Keep last 300 ticks (~25 min at 5s polling)
        return next.slice(-300);
      });
    }
  }

  const tickCount = tickCountRef.current;

  // ── Synthetic OHLC from quote polling (for 1s/5s/15s) ──
  // Each poll snapshots bid/ask into a synthetic bar bucket

  return (
    <div className="clab-page">
      <header className="clab-header">
        <div>
          <h2>Charts Lab</h2>
          <p className="clab-subtitle">
            Experimental charting engine — building toward TradingView quality
          </p>
        </div>
      </header>

      {/* ── Controls ── */}
      <div className="clab-controls">
        <div className="clab-control-group">
          <label>Symbol</label>
          <select value={symbol} onChange={(e) => setSymbol(e.target.value)}>
            {SPEED_PROTOCOL_SYMBOLS.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </div>
        <div className="clab-control-group">
          <label>Timeframe</label>
          <div className="clab-tf-row">
            {TIMEFRAMES.map((tf) => (
              <button
                key={tf}
                className={`clab-tf-btn ${tf === timeframe ? 'active' : ''}`}
                onClick={() => setTf(tf)}
              >
                {tf}
              </button>
            ))}
          </div>
        </div>
        <div className="clab-control-group">
          <label>Engine</label>
          <div className="clab-engine-row">
            {ENGINES.map((e) => (
              <button
                key={e.id}
                className={`clab-engine-btn ${e.id === engine ? 'active' : ''}`}
                onClick={() => setEngine(e.id)}
                title={e.desc}
              >
                {e.label}
              </button>
            ))}
          </div>
        </div>
        <div className="clab-control-group">
          <label>Bars ({bars})</label>
          <input type="range" min={10} max={200} value={bars} onChange={(e) => setBars(+e.target.value)} />
        </div>
      </div>

      {/* ── Indicator Toggles ── */}
      <div className="clab-indicator-row">
        <span className="clab-indicator-label">Indicators:</span>
        {INDICATOR_PRESETS.map((ind) => {
          const key = `${ind.type}-${ind.period}`;
          const active = activeIndicators.has(key);
          return (
            <button
              key={key}
              className={`clab-indicator-btn ${active ? 'active' : ''}`}
              style={active ? { borderColor: ind.color, color: ind.color } : {}}
              onClick={() => {
                setActiveIndicators((prev) => {
                  const next = new Set(prev);
                  if (next.has(key)) next.delete(key);
                  else next.add(key);
                  return next;
                });
              }}
            >
              <span className="clab-indicator-dot" style={{ background: ind.color }} />
              {ind.label}
            </button>
          );
        })}
      </div>

      {/* ── Live Quote Display ── */}
      <div className="clab-quote">
        <span className="clab-quote-symbol">{symbol}</span>
        {quote ? (
          <>
            <span className="clab-quote-bid">B {quote.bid?.toFixed(5) ?? '—'}</span>
            <span className="clab-quote-ask">A {quote.ask?.toFixed(5) ?? '—'}</span>
            <span className="clab-quote-mid">{quote.mid?.toFixed(5) ?? '—'}</span>
            <span className="clab-quote-spread">Δ {quote.spread?.toFixed(5) ?? '—'}</span>
          </>
        ) : (
          <span className="clab-quote-wait">Waiting for MT5…</span>
        )}
      </div>

      {/* ── Chart Area ── */}
      <div className="clab-chart-area">
        <div ref={chartContainerRef} className="clab-chart-container" />
        {engine === 'lightweight' && (
          <CandlestickChart
            containerRef={chartContainerRef}
            ticks={ticks}
            intervalMs={tfMs[timeframe] ?? 5000}
            maxBars={bars}
          />
        )}
        {engine === 'canvas' && (
          <CanvasCandlestickChart
            containerRef={chartContainerRef}
            ticks={ticks}
            intervalMs={tfMs[timeframe] ?? 5000}
            maxBars={bars}
            indicators={INDICATOR_PRESETS.filter((ind) => activeIndicators.has(`${ind.type}-${ind.period}`))}
          />
        )}
        {engine === 'uplot' && (
          <div className="clab-placeholder">
            <h3>uPlot Engine</h3>
            <p>Coming soon — 150k+ datapoint performance testing</p>
          </div>
        )}

        <div className="clab-data-info">
          {tickCount > 0 ? `${tickCount} ticks · ${ticks.length > 0 ? Math.ceil((ticks[ticks.length-1].time - ticks[0].time) / 1000) : 0}s of data` : 'Waiting for MT5 quotes…'}
          {candles.length > 0 && ` · ${candles.length} MT5 candles loaded`}
        </div>
      </div>

      {/* ── Notes ── */}
      <div className="clab-notes">
        <h4>Development Roadmap</h4>
        <ol>
          <li><span className="clab-done">✓</span> Canvas 2D candlestick renderer with proper wick/body geometry + volume bars</li>
          <li><span className="clab-done">✓</span> Synthetic sub-minute candles from quote polling (bucket bid/ask into OHLC)</li>
          <li><span className="clab-done">✓</span> EMA/SMA/RSI indicators + indicator selector controls</li>
          <li>uPlot integration for 150k+ datapoint performance tests</li>
          <li>Multi-timeframe overlay (1m candles with 5s synthetic overlay)</li>
          <li><span className="clab-done">✓</span> Zoom/pan with wheel + drag (Canvas engine)</li>
          <li><span className="clab-done">✓</span> Crosshair cursor with OHLC + indicator tooltip (both engines)</li>
          <li><span className="clab-done">✓</span> Volume bars (Canvas engine)</li>
          <li>WebSocket streaming (replace HTTP polling for quotes)</li>
        </ol>
      </div>
    </div>
  );
}
