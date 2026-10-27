import { useEffect, useRef, useCallback } from 'react';
import { createChart, CandlestickSeries, LineSeries, HistogramSeries, createSeriesMarkers, ColorType } from 'lightweight-charts';
import EmptyState from '../EmptyState';
import './backtest-chart.css';

/**
 * ⚠️ MIGRATED TO lightweight-charts v5 (2026-10-22, #1134). The installed version is **5.2.0**, and
 * v5 removed the per-type helpers this file was written against:
 *
 *     chart.addLineSeries(opts)        →  chart.addSeries(LineSeries, opts)
 *     chart.addHistogramSeries(opts)   →  chart.addSeries(HistogramSeries, opts)
 *     series.setMarkers(markers)       →  createSeriesMarkers(series, markers)
 *
 * Measured 2026-10-22: `chart.addLineSeries is not a function` threw on the first run of the Backtest
 * Lab and the page-level error boundary replaced the whole view with "Something went wrong rendering
 * this view" — so a run that had SUCCEEDED and been stored appeared to produce nothing. The markers
 * call was wrapped in a `typeof` guard, which did not throw and instead rendered no markers at all.
 */

/**
 * IndicatorPane — renders a standalone indicator sub-chart
 * (RSI line with oversold/overbought bands, or MACD histogram + signal line).
 */
export function IndicatorPane({ data, type, height = 150 }) {
  const containerRef = useRef(null);
  const chartRef = useRef(null);

  useEffect(() => {
    if (!containerRef.current || !data?.indicators) return;

    if (chartRef.current) {
      chartRef.current.remove();
      chartRef.current = null;
    }

    const chart = createChart(containerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: '#13141a' },
        textColor: '#6b7280',
      },
      grid: {
        vertLines: { color: '#1e2030' },
        horzLines: { color: '#1e2030' },
      },
      crosshair: { mode: 0 },
      rightPriceScale: { borderColor: '#2d3040', scaleMargins: { top: 0.1, bottom: 0.1 } },
      timeScale: { borderColor: '#2d3040', visible: false },
      width: containerRef.current.clientWidth,
      height,
    });

    chartRef.current = chart;

    if (type === 'rsi' && data.indicators.rsi?.length) {
      const line = chart.addSeries(LineSeries, {
        color: '#a78bfa',
        lineWidth: 1.5,
      });
      const rsiData = data.indicators.rsi.filter(d => d.value > 0);
      line.setData(rsiData);

      // Oversold/overbought bands
      const overbought = chart.addSeries(LineSeries, { color: 'rgba(239,68,68,0.15)', lineWidth: 1, lastValueVisible: false });
      overbought.setData(rsiData.map(d => ({ time: d.time, value: 70 })));
      const oversold = chart.addSeries(LineSeries, { color: 'rgba(34,197,94,0.15)', lineWidth: 1, lastValueVisible: false });
      oversold.setData(rsiData.map(d => ({ time: d.time, value: 30 })));
    }

    if (type === 'macd' && data.indicators.macd?.length) {
      const histData = data.indicators.macd.map(d => ({
        time: d.time,
        value: d.histogram,
        color: d.histogram >= 0 ? 'rgba(34,197,94,0.5)' : 'rgba(239,68,68,0.5)',
      }));
      const histSeries = chart.addSeries(HistogramSeries, {});
      histSeries.setData(histData);

      const signalLine = chart.addSeries(LineSeries, { color: '#f87171', lineWidth: 1 });
      signalLine.setData(data.indicators.macd.map(d => ({ time: d.time, value: d.signal })));

      const macdLine = chart.addSeries(LineSeries, { color: '#34d399', lineWidth: 1 });
      macdLine.setData(data.indicators.macd.map(d => ({ time: d.time, value: d.macd })));
    }

    chart.timeScale().fitContent();

    return () => {
      if (chartRef.current) {
        chartRef.current.remove();
        chartRef.current = null;
      }
    };
  }, [data, type, height]);

  return <div ref={containerRef} className="bt-indicator-pane" style={{ height }} />;
}

export default function BacktestChart({ data, symbol, loading, showSignalsOnly = false, onCrosshairMove }) {
  const containerRef = useRef(null);
  const chartRef = useRef(null);
  const seriesRef = useRef({});
  /**
   * ⚠️ v5 markers are an OBJECT, not a series method. `createSeriesMarkers(series, markers)` returns
   * a handle that owns them; re-creating it on every build would leave the previous handle attached
   * to a removed chart. One handle per chart, reset wherever `seriesRef` is reset.
   */
  const markersRef = useRef(null);

  const buildChart = useCallback(() => {
    if (!containerRef.current || !data?.bars?.length) return;

    // Clean up previous
    if (chartRef.current) {
      chartRef.current.remove();
      chartRef.current = null;
      seriesRef.current = {};
      markersRef.current = null;
    }

    const container = containerRef.current;
    const chart = createChart(container, {
      layout: {
        background: { type: ColorType.Solid, color: '#13141a' },
        textColor: '#9ca3af',
      },
      grid: {
        vertLines: { color: '#1e2030' },
        horzLines: { color: '#1e2030' },
      },
      crosshair: {
        mode: 0,
        vertLine: { color: '#4b5563', style: 2, labelBackgroundColor: '#4b5563' },
        horzLine: { color: '#4b5563', style: 2, labelBackgroundColor: '#4b5563' },
      },
      rightPriceScale: {
        borderColor: '#2d3040',
      },
      timeScale: {
        borderColor: '#2d3040',
        timeVisible: true,
        secondsVisible: false,
      },
    });

    chartRef.current = chart;

    // Main candlestick pane
    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: '#22c55e',
      downColor: '#ef4444',
      borderUpColor: '#22c55e',
      borderDownColor: '#ef4444',
      wickUpColor: '#22c55e',
      wickDownColor: '#ef4444',
    });
    candleSeries.setData(data.bars);
    seriesRef.current.candles = candleSeries;

    // Signal markers
    if (data.signals?.length) {
      const markers = data.signals.map((s) => ({
        time: s.time,
        position: s.type === 'entry' ? 'belowBar' : 'aboveBar',
        color: s.type === 'entry' ? '#22c55e' : '#ef4444',
        shape: s.type === 'entry' ? 'arrowUp' : 'arrowDown',
        text: s.label,
        size: 2,
      }));
      // ⚠️ v5 REMOVED `series.setMarkers()`. The old code guarded it with a `typeof` check, so it did
      // not throw — it silently rendered NO markers at all, which is the "buried ability" shape:
      // a feature that exists, is called, and cannot be seen. `createSeriesMarkers` is the v5 API.
      if (markersRef.current) {
        markersRef.current.setMarkers(markers);
      } else {
        markersRef.current = createSeriesMarkers(candleSeries, markers);
      }
    }

    // Crosshair subscription
    chart.subscribeCrosshairMove((param) => {
      if (onCrosshairMove) {
        if (!param?.time) {
          onCrosshairMove(null);
          return;
        }
        const candleData = param.seriesData?.get(candleSeries);
        const timeStr = param.time
          ? (typeof param.time === 'string' ? param.time : new Date(param.time * 1000).toISOString().split('T')[0])
          : '';
        onCrosshairMove({
          time: timeStr,
          data: candleData
            ? { open: candleData.open, high: candleData.high, low: candleData.low, close: candleData.close }
            : null,
        });
      }
    });

    // EMA overlay (only if not signals-only mode)
    if (!showSignalsOnly && data.indicators?.ema9?.length) {
      const ema9Series = chart.addSeries(LineSeries, {
        color: '#60a5fa',
        lineWidth: 1,
        priceScaleId: 'right',
      });
      ema9Series.setData(data.indicators.ema9.filter(d => d.value > 0));
      seriesRef.current.ema9 = ema9Series;

      const ema21Series = chart.addSeries(LineSeries, {
        color: '#fbbf24',
        lineWidth: 1,
        priceScaleId: 'right',
      });
      ema21Series.setData(data.indicators.ema21.filter(d => d.value > 0));
      seriesRef.current.ema21 = ema21Series;
    }

    // Volume histogram (separate pane)
    if (!showSignalsOnly) {
      const volumeSeries = chart.addSeries(HistogramSeries, {
        color: '#4b5563',
        priceFormat: { type: 'volume' },
        priceScaleId: 'volume',
      });
      volumeSeries.priceScale().applyOptions({
        scaleMargins: { top: 0.85, bottom: 0 },
      });
      const volumeData = data.bars.map((b) => ({
        time: b.time,
        value: b.volume,
        color: b.close >= b.open ? 'rgba(34,197,94,0.3)' : 'rgba(239,68,68,0.3)',
      }));
      volumeSeries.setData(volumeData);
      seriesRef.current.volume = volumeSeries;
    }

    // RSI overlay — only when not signals-only
    if (!showSignalsOnly && data.indicators?.rsi?.length) {
      // ⚠️ `scaleMargins` MUST SUM TO LESS THAN 1, and this used to be `{ top: 0.95, bottom: 0.85 }`
      // — sum **1.80**. lightweight-charts 5.2.0 THROWS on it:
      //     Error: Invalid margins - sum of margins must be less than 1, given=1.7999999999999998
      // and the throw reached the page's error boundary, replacing the entire Backtest Lab with
      // "Something went wrong rendering this view" (measured 2026-10-22, #1134). MACD carried the
      // same defect at 1.90. Both are fixed to valid bands below.
      //
      // These are OVERLAYS on the price pane, not real v5 panes — a distinct `priceScaleId` only
      // gives a series its own scale, not its own space. Proper `panes()` layout is the better
      // design and is deferred to #1134's follow-up rather than invented here.
      const rsiPane = chart.addSeries(LineSeries, {
        color: '#a78bfa',
        lineWidth: 1,
        priceScaleId: 'rsi',
        scaleMargins: { top: 0.05, bottom: 0.80 },
      });
      rsiPane.setData(data.indicators.rsi.filter(d => d.value > 0));
      seriesRef.current.rsi = rsiPane;
    }

    // MACD overlay — only when not signals-only
    if (!showSignalsOnly && data.indicators?.macd?.length) {
      const macdSeries = chart.addSeries(LineSeries, {
        color: '#34d399',
        lineWidth: 1,
        priceScaleId: 'macd',
        scaleMargins: { top: 0.22, bottom: 0.63 },
      });
      macdSeries.setData(data.indicators.macd.map(d => ({ time: d.time, value: d.macd })));

      const signalSeries = chart.addSeries(LineSeries, {
        color: '#f87171',
        lineWidth: 1,
        priceScaleId: 'macd',
      });
      signalSeries.setData(data.indicators.macd.map(d => ({ time: d.time, value: d.signal })));

      const histSeries = chart.addSeries(HistogramSeries, {
        priceScaleId: 'macd',
      });
      histSeries.setData(data.indicators.macd.map(d => ({
        time: d.time,
        value: d.histogram,
        color: d.histogram >= 0 ? 'rgba(34,197,94,0.4)' : 'rgba(239,68,68,0.4)',
      })));
      seriesRef.current.macd = macdSeries;
    }

    chart.timeScale().fitContent();
  }, [data, showSignalsOnly, onCrosshairMove]);

  useEffect(() => {
    buildChart();

    return () => {
      if (chartRef.current) {
        chartRef.current.remove();
        chartRef.current = null;
      }
    };
  }, [buildChart]);

  useEffect(() => {
    const handleResize = () => {
      if (chartRef.current && containerRef.current) {
        chartRef.current.applyOptions({
          width: containerRef.current.clientWidth,
          height: containerRef.current.clientHeight,
        });
      }
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  if (loading) {
    return (
      <div className="bt-chart-container">
        <div className="bt-chart-loading">Loading chart data...</div>
      </div>
    );
  }

  if (!data?.bars?.length) {
    return (
      <div className="bt-chart-container">
        <EmptyState
          icon="📈"
          title="No chart data available"
          description={`Run a backtest or ensure market data exists for ${symbol || 'symbol'}`}
        />
      </div>
    );
  }

  return (
    <div className="bt-chart-container">
      <div ref={containerRef} className="bt-chart-canvas" />
    </div>
  );
}
