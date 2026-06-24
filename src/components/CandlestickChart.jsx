/**
 * Real-time candlestick chart using lightweight-charts + MT5 quote polling.
 * Aggregates individual quotes into OHLC buckets at configurable intervals.
 */
import { useEffect, useRef, useMemo } from 'react';
import { createChart, CandlestickSeries } from 'lightweight-charts';

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
  intervalMs = 5000,
  maxBars = 100,
}) {
  const chartRef = useRef(null);
  const seriesRef = useRef(null);
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
      height: containerRef.current.clientHeight || 420,
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
        chart.resize(containerRef.current.clientWidth, containerRef.current.clientHeight || 420);
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

  // Push completed candles as they arrive
  useEffect(() => {
    const series = seriesRef.current;
    const chart = chartRef.current;
    if (!series || !chart || completedCandles.length === 0) return;

    // Get the last candle time on the chart
    const lastTime = lastBucketTimeRef.current;

    // Find new candles since last update
    const newCandles = lastTime
      ? completedCandles.filter(c => c.time > lastTime)
      : completedCandles;

    if (newCandles.length > 0 || !lastTime) {
      // Full data set for initial load, append for updates
      if (!lastTime) {
        series.setData(completedCandles);
      } else {
        newCandles.forEach(c => series.update(c));
      }
      lastBucketTimeRef.current = completedCandles[completedCandles.length - 1]?.time ?? lastTime;

      // Scroll to the latest candle
      chart.timeScale().scrollToPosition(0, false);
    }
  }, [completedCandles]);

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
    chart.resize(containerRef.current.clientWidth, containerRef.current.clientHeight || 420);
  }, [containerRef]);

  return null; // Rendered via lightweight-charts into the container div
}
