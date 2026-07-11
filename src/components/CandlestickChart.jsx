/**
 * Real-time candlestick chart using lightweight-charts + MT5 quote polling.
 * Aggregates individual quotes into OHLC buckets at configurable intervals.
 * Supports EMA/SMA indicator line overlays.
 */
import { useEffect, useRef, useMemo } from 'react';
import { createChart, CandlestickSeries, LineSeries, HistogramSeries } from 'lightweight-charts';

/**
 * Compute EMA from price data.
 */
function computeEMA(data, period, field = 'close') {
  if (!data.length || data.length < period) return [];
  const k = 2 / (period + 1);
  const result = [];
  let sum = 0;
  for (let i = 0; i < period; i++) sum += data[i][field];
  let ema = sum / period;
  result.push({ time: data[period - 1].time, value: ema });
  for (let i = period; i < data.length; i++) {
    ema = data[i][field] * k + ema * (1 - k);
    result.push({ time: data[i].time, value: ema });
  }
  return result;
}

/**
 * Compute SMA from price data.
 */
function computeSMA(data, period, field = 'close') {
  if (!data.length || data.length < period) return [];
  const result = [];
  for (let i = period - 1; i < data.length; i++) {
    let sum = 0;
    for (let j = 0; j < period; j++) sum += data[i - j][field];
    result.push({ time: data[i].time, value: sum / period });
  }
  return result;
}

/**
 * Compute MACD (12,26,9) from price data.
 * Returns { macd: [{time, value}], signal: [{time, value}], histogram: [{time, value, color}] }
 */
function computeMACD(data, fast = 12, slow = 26, signalPeriod = 9) {
  if (data.length < slow) return null;
  const emaFast = computeEMA(data, fast);
  const emaSlow = computeEMA(data, slow);
  // Align by time — use the slower (shorter) array
  const macdLine = [];
  const slowTimeMap = new Map(emaSlow.map(d => [d.time, d.value]));
  for (const f of emaFast) {
    const s = slowTimeMap.get(f.time);
    if (s !== undefined) macdLine.push({ time: f.time, value: f.value - s });
  }
  if (macdLine.length < signalPeriod) return null;
  // Signal = EMA of MACD line
  const signalLine = computeEMA(macdLine, signalPeriod, 'value');
  // Align signal with macd
  const sigMap = new Map(signalLine.map(d => [d.time, d.value]));
  const result = { macd: [], signal: [], histogram: [] };
  for (const m of macdLine) {
    const sig = sigMap.get(m.time);
    if (sig !== undefined) {
      result.macd.push(m);
      result.signal.push({ time: m.time, value: sig });
      const hist = m.value - sig;
      result.histogram.push({
        time: m.time,
        value: hist,
        color: hist >= 0 ? 'rgba(34,197,94,0.5)' : 'rgba(239,68,68,0.5)',
      });
    }
  }
  return result;
}

/**
 * Compute VWAP — cumulative (price*volume)/volume. Falls back to SMA if no volume.
 */
function computeVWAP(data) {
  if (!data.length) return [];
  let cumPV = 0, cumV = 0;
  const result = [];
  for (const d of data) {
    const typical = (d.high + d.low + d.close) / 3;
    const vol = d.volume || 1;
    cumPV += typical * vol;
    cumV += vol;
    result.push({ time: d.time, value: cumPV / cumV });
  }
  return result;
}

/**
 * Compute RSI (Wilder's smoothing).
 */
function computeRSI(data, period = 14) {
  if (data.length < period + 1) return [];
  const result = [];
  let avgGain = 0, avgLoss = 0;
  for (let i = 1; i <= period; i++) {
    const change = data[i].close - data[i - 1].close;
    if (change > 0) avgGain += change; else avgLoss -= change;
  }
  avgGain /= period; avgLoss /= period;
  const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
  result.push({ time: data[period].time, value: 100 - (100 / (1 + rs)) });
  for (let i = period + 1; i < data.length; i++) {
    const change = data[i].close - data[i - 1].close;
    avgGain = (avgGain * (period - 1) + (change > 0 ? change : 0)) / period;
    avgLoss = (avgLoss * (period - 1) + (change < 0 ? -change : 0)) / period;
    const rs2 = avgLoss === 0 ? 100 : avgGain / avgLoss;
    result.push({ time: data[i].time, value: 100 - (100 / (1 + rs2)) });
  }
  return result;
}

/**
 * Aggregate ticks into OHLC buckets.
 * Each bucket spans `intervalMs` milliseconds.
 */
function bucketTicks(ticks, intervalMs) {
  if (!ticks.length) return [];
  const buckets = [];
  let currentBucket = null;

  for (const tick of ticks) {
    const bucketTime = Math.floor(tick.time / intervalMs) * intervalMs;
    const price = (tick.bid + tick.ask) / 2;

    if (!currentBucket || currentBucket.time !== bucketTime) {
      if (currentBucket) buckets.push(currentBucket);
      currentBucket = {
        time: bucketTime / 1000, // lightweight-charts uses seconds
        open: price,
        high: price,
        low: price,
        close: price,
      };
    } else {
      currentBucket.high = Math.max(currentBucket.high, price);
      currentBucket.low = Math.min(currentBucket.low, price);
      currentBucket.close = price;
    }
  }
  if (currentBucket) buckets.push(currentBucket);
  return buckets;
}

const CHART_COLORS = {
  upColor: '#22c55e',
  downColor: '#ef4444',
  borderUpColor: '#22c55e',
  borderDownColor: '#ef4444',
  wickUpColor: '#22c55e',
  wickDownColor: '#ef4444',
};

export default function CandlestickChart({
  containerRef,
  ticks = [],
  historicalCandles = null,
  intervalMs = 5000,
  maxBars = 100,
  indicators = [],
}) {
  const chartRef = useRef(null);
  const seriesRef = useRef(null);
  const indicatorSeriesRef = useRef({});
  const lastBucketTimeRef = useRef(null);

  // Build completed candles + current building candle
  const { completedCandles, currentCandle } = useMemo(() => {
    const all = bucketTicks(ticks, intervalMs);
    if (all.length === 0) return { completedCandles: [], currentCandle: null };

    // The last bucket is "in progress" — still building
    const completed = all.slice(0, -1).slice(-maxBars);
    const current = all[all.length - 1];

    return { completedCandles: completed, currentCandle: current };
  }, [ticks, intervalMs, maxBars]);

  // Initialize chart
  useEffect(() => {
    if (!containerRef.current) return;
    if (chartRef.current) return;

    const chart = createChart(containerRef.current, {
      width: containerRef.current.clientWidth,
      height: containerRef.current.clientHeight || 600,
      layout: {
        background: { color: 'transparent' },
        textColor: '#94a3b8',
      },
      grid: {
        vertLines: { color: 'rgba(128,128,128,0.06)' },
        horzLines: { color: 'rgba(128,128,128,0.06)' },
      },
      crosshair: {
        mode: 1,
        vertLine: { color: 'rgba(255,255,255,0.12)', style: 2, width: 1, labelBackgroundColor: '#1e293b' },
        horzLine: { color: 'rgba(255,255,255,0.12)', style: 2, width: 1, labelBackgroundColor: '#1e293b' },
      },
      rightPriceScale: { borderColor: 'rgba(128,128,128,0.15)' },
      timeScale: {
        borderColor: 'rgba(128,128,128,0.15)',
        timeVisible: true,
        secondsVisible: true,
        barSpacing: 10,
      },
      handleScroll: { vertTouchDrag: false },
    });

    const series = chart.addSeries(CandlestickSeries, CHART_COLORS);
    chartRef.current = chart;
    seriesRef.current = series;

    // Resize handler
    const ro = new ResizeObserver(() => {
      if (containerRef.current) {
        chart.resize(containerRef.current.clientWidth, containerRef.current.clientHeight || 600);
      }
    });
    ro.observe(containerRef.current);

    return () => {
      ro.disconnect();
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
    };
  }, [containerRef]);

  // Push completed candles or historical data
  useEffect(() => {
    const series = seriesRef.current;
    const chart = chartRef.current;
    if (!series || !chart) return;

    // Prefer live ticks; fall back to historical candles
    if (completedCandles.length > 0) {
      const lastTime = lastBucketTimeRef.current;
      const newCandles = lastTime
        ? completedCandles.filter(c => c.time > lastTime)
        : completedCandles;

      if (newCandles.length > 0 || !lastTime) {
        if (!lastTime) series.setData(completedCandles);
        else newCandles.forEach(c => series.update(c));
        lastBucketTimeRef.current = completedCandles[completedCandles.length - 1]?.time ?? lastTime;
        chart.timeScale().scrollToPosition(0, false);
      }
    } else if (historicalCandles && historicalCandles.length > 0) {
      series.setData(historicalCandles.slice(-maxBars));
      chart.timeScale().fitContent();
      lastBucketTimeRef.current = null; // reset so live ticks take over when available
    }
  }, [completedCandles, historicalCandles, maxBars]);

  // Update the current (building) candle in real-time
  useEffect(() => {
    const series = seriesRef.current;
    if (!series || !currentCandle) return;
    series.update(currentCandle);
  }, [currentCandle]);

  // Handle resize
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || !containerRef.current) return;
    chart.resize(containerRef.current.clientWidth, containerRef.current.clientHeight || 600);
  }, [containerRef]);

  // ── Indicator lines & oscillators ──
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;

    // Use live tick buckets or historical candles
    const tickBuckets = bucketTicks(ticks, intervalMs);
    const completed = tickBuckets.length > 1
      ? tickBuckets.slice(0, -1)
      : (historicalCandles || []);
    if (completed.length < 2) return;
    const currentRef = indicatorSeriesRef.current;

    // Separate overlays (price scale) from oscillators (own scale)
    const overlays = indicators.filter(i => i.type === 'ema' || i.type === 'sma' || i.type === 'vwap');
    const oscillators = indicators.filter(i => i.type === 'macd' || i.type === 'rsi');

    const activeKeys = new Set(indicators.map(i => `${i.type}-${i.period}`));

    // Remove stale series
    for (const [key, series] of Object.entries(currentRef)) {
      if (!activeKeys.has(key)) {
        try { chart.removeSeries(series); } catch {}
        delete currentRef[key];
      }
    }

    // Ensure oscillator price scale exists
    let oscScale = currentRef['__oscScale'];
    if (oscillators.length > 0 && !oscScale) {
      oscScale = { id: 'oscillator' };
      currentRef['__oscScale'] = oscScale;
    }

    // ── Overlays (EMA/SMA/VWAP) on price scale ──
    for (const ind of overlays) {
      const key = `${ind.type}-${ind.period}`;
      let data;
      if (ind.type === 'ema') data = computeEMA(completed, ind.period);
      else if (ind.type === 'sma') data = computeSMA(completed, ind.period);
      else if (ind.type === 'vwap') data = computeVWAP(completed);
      if (!data || !data.length) continue;

      let lineSeries = currentRef[key];
      if (!lineSeries) {
        lineSeries = chart.addSeries(LineSeries, {
          color: ind.color, lineWidth: 1,
          priceLineVisible: false, lastValueVisible: true,
        });
        currentRef[key] = lineSeries;
      }
      lineSeries.applyOptions({ color: ind.color });
      lineSeries.setData(data);
    }

    // ── MACD oscillator ──
    for (const ind of oscillators) {
      const key = `${ind.type}-${ind.period}`;
      if (ind.type === 'macd') {
        const macdData = computeMACD(completed);
        if (!macdData) continue;

        // MACD histogram
        let histKey = key + '-hist';
        let histSeries = currentRef[histKey];
        if (!histSeries) {
          histSeries = chart.addSeries(HistogramSeries, {
            priceScaleId: 'oscillator',
            priceLineVisible: false,
          });
          currentRef[histKey] = histSeries;
        }
        histSeries.setData(macdData.histogram);

        // MACD line
        let lineKey = key + '-line';
        let lineSeries = currentRef[lineKey];
        if (!lineSeries) {
          lineSeries = chart.addSeries(LineSeries, {
            color: '#3b82f6', lineWidth: 1,
            priceScaleId: 'oscillator',
            priceLineVisible: false, lastValueVisible: true,
          });
          currentRef[lineKey] = lineSeries;
        }
        lineSeries.setData(macdData.macd);

        // Signal line
        let sigKey = key + '-sig';
        let sigSeries = currentRef[sigKey];
        if (!sigSeries) {
          sigSeries = chart.addSeries(LineSeries, {
            color: '#f59e0b', lineWidth: 1,
            priceScaleId: 'oscillator',
            priceLineVisible: false, lastValueVisible: true,
          });
          currentRef[sigKey] = sigSeries;
        }
        sigSeries.setData(macdData.signal);
      }

      if (ind.type === 'rsi') {
        const rsiData = computeRSI(completed, ind.period || 14);
        if (!rsiData.length) continue;

        let lineKey = key + '-line';
        let lineSeries = currentRef[lineKey];
        if (!lineSeries) {
          lineSeries = chart.addSeries(LineSeries, {
            color: ind.color, lineWidth: 1.5,
            priceScaleId: 'oscillator',
            priceLineVisible: false, lastValueVisible: true,
          });
          currentRef[lineKey] = lineSeries;
        }
        lineSeries.setData(rsiData);
      }
    }

    // Clean up oscillator scale if no oscillators active
    if (oscillators.length === 0 && currentRef['__oscScale']) {
      delete currentRef['__oscScale'];
    }
  }, [ticks, intervalMs, indicators]);

  return null; // Rendered via lightweight-charts into the container div
}
