/**
 * SpeedChart — unified lightweight-charts wrapper for the Trading Command Suite.
 *
 * Chart modes:
 *   'candles' — full OHLC + volume + EMA overlays (default)
 *   'line'    — area chart with gradient
 *   'minimal' — compact price + signal display (no chart)
 *
 * Data sources:
 *   Internal: fetches candles from MT5 bridge (default)
 *   External: receives ticks + historicalCandles via props (used by ChartsLab)
 *
 * Merged from SpeedChart + CandlestickChart (#506).
 */
import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import {
  createChart,
  ColorType,
  CandlestickSeries,
  HistogramSeries,
  LineSeries,
  CrosshairMode,
} from 'lightweight-charts';

const API_BASE = 'http://localhost:3201';

/** Map our timeframe names to MT5 bridge names */
const TF_MAP = { '1s': '1m', '5s': '1m', '15s': '1m', '30s': '1m', '1m': '1m', '5m': '5m', '15m': '15m', '1h': '1h', '1d': '1d' };

/**
 * Bucket raw ticks into OHLC candles. Shared with CandlestickChart (now merged).
 */
function bucketTicks(ticks, intervalMs) {
  if (!ticks.length) return [];
  const buckets = [];
  let currentBucket = null;
  for (const tick of ticks) {
    const bucketTime = Math.floor(tick.timestamp / intervalMs) * intervalMs;
    if (!currentBucket || currentBucket.time !== bucketTime) {
      if (currentBucket) buckets.push(currentBucket);
      currentBucket = {
        time: bucketTime / 1000, // lightweight-charts uses seconds
        open: tick.price,
        high: tick.price,
        low: tick.price,
        close: tick.price,
        volume: tick.volume || 0,
      };
    } else {
      currentBucket.high = Math.max(currentBucket.high, tick.price);
      currentBucket.low = Math.min(currentBucket.low, tick.price);
      currentBucket.close = tick.price;
      currentBucket.volume += tick.volume || 0;
    }
  }
  if (currentBucket) buckets.push(currentBucket);
  return buckets;
}

export default function SpeedChart({
  symbol,
  timeframe,
  chartMode,
  scanScore,
  chartSettings,
  // External data mode (from CandlestickChart merge)
  containerRef: externalContainerRef,
  ticks,
  historicalCandles = null,
  intervalMs = 5000,
  maxBars = 100,
}) {
  const internalContainerRef = useRef(null);
  const containerRef = externalContainerRef || internalContainerRef;
  const chartRef = useRef(null);
  const candleSeriesRef = useRef(null);
  const volumeSeriesRef = useRef(null);
  const emaSeriesRefs = useRef([]);
  const [bars, setBars] = useState([]);
  const [lastPrice, setLastPrice] = useState(null);
  const [dataError, setDataError] = useState(null);
  const [hoverInfo, setHoverInfo] = useState(null);

  // ── External data mode (from CandlestickChart merge #506) ──
  const useExternalData = ticks !== undefined;

  // When in external mode, bucket ticks into candles
  const extCandles = useMemo(() => {
    if (!useExternalData || !ticks?.length) return null;
    const all = bucketTicks(ticks, intervalMs);
    if (all.length === 0) return { completed: [], current: null };

    // Prepend historical candles if provided
    let completed = historicalCandles
      ? [...historicalCandles.slice(-maxBars), ...all.slice(0, -1)].slice(-maxBars)
      : all.slice(0, -1).slice(-maxBars);
    const current = all[all.length - 1];

    // Convert to SpeedChart bar format.
    // Guard against invalid candle timestamps (would make toISOString throw
    // "Invalid time value" and crash the chart).
    const allBars = [...completed, current]
      .filter(c => Number.isFinite(Number(c?.time)))
      .map(c => ({
        timestamp: new Date(Number(c.time) * 1000).toISOString(),
        open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume || 0,
      }));
    return { allBars, completed, current };
  }, [ticks, intervalMs, maxBars, historicalCandles, useExternalData]);

  // ── Fetch candles (internal mode only) ──
  const fetchBars = useCallback(async () => {
    if (useExternalData) return; // skip fetch in external mode
    const mt5tf = TF_MAP[timeframe] || '1m';
    try {
      const res = await fetch(`${API_BASE}/api/trading/mt5/candles?symbol=${encodeURIComponent(symbol)}&timeframe=${mt5tf}&limit=300`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (data.bars && data.bars.length > 0) {
        setBars(data.bars);
        const last = data.bars[data.bars.length - 1];
        setLastPrice({ bid: last.close, ask: last.close, timestamp: last.timestamp });
        setDataError(null);
      } else {
        setBars([]);
        setDataError('No data for this symbol');
      }
    } catch (e) {
      setDataError(e.message);
    }
  }, [symbol, timeframe]);

  useEffect(() => {
    if (chartMode === 'minimal') return;
    if (useExternalData) return; // external mode — chart updated by extCandles memo
    fetchBars();
    const timer = setInterval(fetchBars, 3000);
    return () => clearInterval(timer);
  }, [fetchBars, chartMode, useExternalData]);

  // ── Compute chart data from bars (internal) or extCandles (external) ──
  const chartData = useMemo(() => {
    if (useExternalData) {
      if (!extCandles?.allBars?.length) return null;
      // Also set last price from external data
      const last = extCandles.allBars[extCandles.allBars.length - 1];
      if (last && !lastPrice) setLastPrice({ bid: last.close, ask: last.close, timestamp: last.timestamp });
      return extCandles.allBars.map(b => ({
        time: Math.floor(new Date(b.timestamp).getTime() / 1000),
        open: b.open, high: b.high, low: b.low, close: b.close, volume: b.volume || 0,
      }));
    }
    if (bars.length === 0) return null;
    return bars.map((b) => ({
      time: Math.floor(new Date(b.timestamp).getTime() / 1000),
      open: b.open,
      high: b.high,
      low: b.low,
      close: b.close,
      volume: b.volume || 0,
    }));
  }, [bars]);

  const emaData = useMemo(() => {
    if (!chartData || chartData.length < 50) return { ema9: [], ema21: [], ema50: [] };
    const calcEMA = (data, period) => {
      const k = 2 / (period + 1);
      const result = [];
      let prev = data.slice(0, period).reduce((s, d) => s + d.close, 0) / period;
      for (let i = period; i < data.length; i++) {
        const ema = data[i].close * k + prev * (1 - k);
        result.push({ time: data[i].time, value: ema });
        prev = ema;
      }
      return result;
    };
    return {
      ema9: calcEMA(chartData, 9),
      ema21: calcEMA(chartData, 21),
      ema50: calcEMA(chartData, 50),
    };
  }, [chartData]);

  const volumeData = useMemo(() => {
    if (!chartData) return [];
    return chartData.map((d) => ({
      time: d.time,
      value: d.volume,
      color: d.close >= d.open ? '#22c55e33' : '#ef444433',
    }));
  }, [chartData]);

  // ── Create/destroy chart (only on chartMode change, NOT timeframe) ──
  useEffect(() => {
    if (chartMode === 'minimal' || !containerRef.current) return;

    const chart = createChart(containerRef.current, {
      width: containerRef.current.clientWidth,
      height: containerRef.current.clientHeight,
      layout: {
        background: { type: ColorType.Solid, color: '#0a0e17' },
        textColor: '#94a3b8',
      },
      grid: {
        vertLines: { color: '#1e293b', style: chartSettings.gridStyle },
        horzLines: { color: '#1e293b', style: chartSettings.gridStyle },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { color: '#475569', style: 2, labelBackgroundColor: '#1e293b' },
        horzLine: { color: '#475569', style: 2, labelBackgroundColor: '#1e293b' },
      },
      rightPriceScale: {
        borderColor: '#334155',
        autoScale: true,
        scaleMargins: { top: 0.05, bottom: 0.25 },
      },
      timeScale: {
        borderColor: '#334155',
        timeVisible: true,
        rightOffset: 3,
        barSpacing: 8,
      },
      handleScroll: { vertTouchDrag: false },
    });

    // Subscribe to crosshair move for hover tooltip
    chart.subscribeCrosshairMove((param) => {
      if (!param.time || !param.seriesData || param.point === undefined) {
        setHoverInfo(null);
        return;
      }
      const candleData = param.seriesData.get(candleSeriesRef.current);
      if (candleData) {
        setHoverInfo({
          time: param.time,
          open: candleData.open,
          high: candleData.high,
          low: candleData.low,
          close: candleData.close,
          x: param.point.x,
          y: param.point.y,
        });
      }
    });

    chartRef.current = chart;

    const handleResize = () => {
      if (containerRef.current) {
        chart.applyOptions({ width: containerRef.current.clientWidth, height: containerRef.current.clientHeight });
      }
    };
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      chart.remove();
      chartRef.current = null;
      candleSeriesRef.current = null;
      volumeSeriesRef.current = null;
      emaSeriesRefs.current = [];
    };
  }, [chartMode]); // NOT timeframe — chart survives TF switches

  // ── Live grid style updates ──
  useEffect(() => {
    if (!chartRef.current) return;
    chartRef.current.applyOptions({
      grid: {
        vertLines: { color: '#1e293b', style: chartSettings.gridStyle },
        horzLines: { color: '#1e293b', style: chartSettings.gridStyle },
      },
    });
  }, [chartSettings.gridStyle]);

  // ── Update series when data, mode, or settings change ──
  useEffect(() => {
    if (!chartRef.current || chartMode === 'minimal' || !chartData || chartData.length === 0) return;
    const chart = chartRef.current;

    // Clean up old series
    [candleSeriesRef, volumeSeriesRef, ...emaSeriesRefs.current.map(() => ({ current: null }))].forEach(ref => {
      if (ref.current) {
        try { chart.removeSeries(ref.current); } catch {}
        ref.current = null;
      }
    });
    emaSeriesRefs.current = [];

    if (chartMode === 'candles') {
      const candleSeries = chart.addSeries(CandlestickSeries, {
        upColor: chartSettings.upColor,
        downColor: chartSettings.downColor,
        borderUpColor: chartSettings.upColor,
        borderDownColor: chartSettings.downColor,
        wickUpColor: chartSettings.upColor,
        wickDownColor: chartSettings.downColor,
        priceFormat: { type: 'price', precision: symbol.includes('JPY') ? 3 : 5, minMove: symbol.includes('JPY') ? 0.001 : 0.00001 },
      });
      candleSeries.setData(chartData);
      candleSeriesRef.current = candleSeries;

      // Volume
      if (chartSettings.showVolume) {
        const volSeries = chart.addSeries(HistogramSeries, { priceFormat: { type: 'volume' }, priceScaleId: '' });
        volSeries.priceScale().applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
        volSeries.setData(volumeData);
        volumeSeriesRef.current = volSeries;
      }

      // EMAs
      if (chartSettings.showEMA9 && emaData.ema9.length > 0) {
        const ema9 = chart.addSeries(LineSeries, { color: '#f59e0b', lineWidth: 1, priceLineVisible: false, lastValueVisible: false });
        ema9.setData(emaData.ema9);
        emaSeriesRefs.current.push(ema9);
      }
      if (chartSettings.showEMA21 && emaData.ema21.length > 0) {
        const ema21 = chart.addSeries(LineSeries, { color: '#8b5cf6', lineWidth: 1, priceLineVisible: false, lastValueVisible: false });
        ema21.setData(emaData.ema21);
        emaSeriesRefs.current.push(ema21);
      }
      if (chartSettings.showEMA50 && emaData.ema50.length > 0) {
        const ema50 = chart.addSeries(LineSeries, { color: '#3b82f6', lineWidth: 1, priceLineVisible: false, lastValueVisible: false });
        ema50.setData(emaData.ema50);
        emaSeriesRefs.current.push(ema50);
      }
    } else {
      // Line mode
      const lineSeries = chart.addSeries(LineSeries, {
        color: '#0ea5a6', lineWidth: 2, priceLineVisible: false, lastValueVisible: true,
        priceFormat: { type: 'price', precision: symbol.includes('JPY') ? 3 : 5, minMove: symbol.includes('JPY') ? 0.001 : 0.00001 },
      });
      lineSeries.setData(chartData.map((d) => ({ time: d.time, value: d.close })));
      candleSeriesRef.current = lineSeries;
    }

    chart.timeScale().fitContent();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chartData, chartMode, symbol, chartSettings]);

  // ── Score info ──
  const scoreInfo = scanScore?.scan?.find(s => s.symbol === symbol);

  // ── Minimal mode ──
  if (chartMode === 'minimal') {
    return (
      <div className="st-chart-minimal">
        <div className="st-chart-minimal-price">
          {lastPrice ? `$${lastPrice.bid.toFixed(symbol.includes('JPY') ? 3 : symbol.includes('XAU') ? 2 : 5)}` : '——'}
        </div>
        {scoreInfo && (
          <div className={`st-chart-minimal-signal ${scoreInfo.signal === 'BUY' ? 'buy' : scoreInfo.signal === 'SELL' ? 'sell' : ''}`}>
            {scoreInfo.signal} {Math.round(scoreInfo.composite)}
          </div>
        )}
      </div>
    );
  }

  // ── Legend ──
  const legend = chartMode === 'candles' && bars.length > 0 ? (
    <div className="st-chart-legend">
      <span className="st-chart-legend-item" style={{ color: '#f59e0b' }}>EMA 9</span>
      <span className="st-chart-legend-item" style={{ color: '#8b5cf6' }}>EMA 21</span>
      <span className="st-chart-legend-item" style={{ color: '#3b82f6' }}>EMA 50</span>
      <span className="st-chart-legend-sep">|</span>
      <span className="st-chart-legend-symbol">{symbol}</span>
      <span className="st-chart-legend-tf">{timeframe}</span>
    </div>
  ) : null;

  // ── Offline / empty state ──
  const showOffline = dataError && bars.length === 0;

  return (
    <div className="st-chart-container">
      {showOffline ? (
        <div className="st-chart-offline">
          <div className="st-chart-offline-icon">📡</div>
          <h3>MT5 Bridge Offline</h3>
          <p>The live chart requires the MT5 bridge (port 5000) to be running.</p>
          <div className="st-chart-offline-hint">
            <span>Start the stack: <code>pwsh -File scripts\tcs-launch.ps1</code></span>
          </div>
          <div className="st-chart-offline-fallback">
            <span className="st-chart-offline-badge">Fallback</span>
            <span>Showing price stream & scoring data without candles</span>
          </div>
          {lastPrice && (
            <div className="st-chart-offline-price">
              <span className="st-chart-offline-bid">${lastPrice.bid?.toFixed(symbol.includes('JPY') ? 3 : symbol.includes('XAU') ? 2 : 5) || '—'}</span>
            </div>
          )}
        </div>
      ) : (
        <>
          {dataError && (
            <div className="st-chart-error">MT5: {dataError}</div>
          )}
          {legend}
          <div ref={containerRef} className="st-chart-canvas" />
          {!bars.length && !dataError && (
            <div className="st-chart-loading">Loading {symbol} {timeframe}…</div>
          )}
        </>
      )}
      {/* Hover tooltip */}
      {hoverInfo && chartMode === 'candles' && (
        <div className="st-chart-tooltip" style={{ left: hoverInfo.x + 12, top: hoverInfo.y - 60 }}>
          <div className="st-chart-tooltip-row"><span>O</span><span>{hoverInfo.open.toFixed(symbol.includes('JPY') ? 3 : 5)}</span></div>
          <div className="st-chart-tooltip-row"><span>H</span><span>{hoverInfo.high.toFixed(symbol.includes('JPY') ? 3 : 5)}</span></div>
          <div className="st-chart-tooltip-row"><span>L</span><span>{hoverInfo.low.toFixed(symbol.includes('JPY') ? 3 : 5)}</span></div>
          <div className="st-chart-tooltip-row"><span>C</span><span>{hoverInfo.close.toFixed(symbol.includes('JPY') ? 3 : 5)}</span></div>
        </div>
      )}
      {/* Score overlay */}
      {scoreInfo && bars.length > 0 && (
        <div className={`st-chart-score-overlay ${scoreInfo.composite >= 65 ? 'strong' : scoreInfo.composite >= 50 ? 'neutral' : 'weak'}`}>
          {scoreInfo.signal} {Math.round(scoreInfo.composite)} · {scoreInfo.protocol?.replace('-v1', '')}
        </div>
      )}
    </div>
  );
}
