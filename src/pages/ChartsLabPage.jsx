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
import './charts-lab.css';

const TIMEFRAMES = ['1s', '5s', '15s', '1m', '5m'];
const ENGINES = [
  { id: 'canvas', label: 'Canvas 2D', desc: 'Custom-built candle renderer' },
  { id: 'lightweight', label: 'Lightweight Charts', desc: 'TradingView free lib' },
  { id: 'uplot', label: 'uPlot', desc: '45KB, 150k+ pts at 60fps' },
];

export default function ChartsLabPage() {
  const [symbol, setSymbol] = useState('XAUUSD');
  const [timeframe, setTf] = useState('1s');
  const [engine, setEngine] = useState('canvas');
  const [bars, setBars] = useState(20);
  const canvasRef = useRef(null);

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

      {/* ── Chart Canvas ── */}
      <div className="clab-chart-area">
        <canvas ref={canvasRef} className="clab-canvas" />

        {engine !== 'canvas' && (
          <div className="clab-placeholder">
            <h3>{ENGINES.find(e => e.id === engine)?.label} — Coming Soon</h3>
            <p>Currently building the Canvas 2D engine. Other renderers will be integrated next.</p>
          </div>
        )}

        {candles.length > 0 && (
          <div className="clab-data-info">
            {candles.length} candles loaded ·{' '}
            {candles[0]?.timestamp ? new Date(candles[0].timestamp).toLocaleString() : '—'} →{' '}
            {candles[candles.length-1]?.timestamp ? new Date(candles[candles.length-1].timestamp).toLocaleString() : '—'}
          </div>
        )}
      </div>

      {/* ── Notes ── */}
      <div className="clab-notes">
        <h4>Development Roadmap</h4>
        <ol>
          <li>Canvas 2D candlestick renderer with proper wick/body geometry</li>
          <li>Synthetic sub-minute candles from quote polling (bucket bid/ask into OHLC)</li>
          <li>Web Worker for EMA/SMA/RSI calculation off main thread</li>
          <li>uPlot integration for 150k+ datapoint performance tests</li>
          <li>Multi-timeframe overlay (1m candles with 5s synthetic overlay)</li>
          <li>Zoom/pan/scroll with wheel + drag</li>
          <li>Crosshair cursor with OHLC tooltip</li>
          <li>Volume profile + time-price-opportunity zones</li>
          <li>WebSocket streaming (replace HTTP polling for quotes)</li>
        </ol>
      </div>
    </div>
  );
}
