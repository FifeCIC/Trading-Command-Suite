import { useEffect, useRef, useCallback } from 'react';
import { createChart, CandlestickSeries, ColorType } from 'lightweight-charts';
import EmptyState from '../EmptyState';
import './BacktestChart.css';

function timeToDate(time) {
  return typeof time === 'string' ? time : new Date(time * 1000).toISOString().split('T')[0];
}

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
      const line = chart.addLineSeries({
        color: '#a78bfa',
        lineWidth: 1.5,
      });
      const rsiData = data.indicators.rsi.filter(d => d.value > 0);
      line.setData(rsiData);

      // Oversold/overbought bands
      const overbought = chart.addLineSeries({ color: 'rgba(239,68,68,0.15)', lineWidth: 1, lastValueVisible: false });
      overbought.setData(rsiData.map(d => ({ time: d.time, value: 70 })));
      const oversold = chart.addLineSeries({ color: 'rgba(34,197,94,0.15)', lineWidth: 1, lastValueVisible: false });
      oversold.setData(rsiData.map(d => ({ time: d.time, value: 30 })));
    }

    if (type === 'macd' && data.indicators.macd?.length) {
      const histData = data.indicators.macd.map(d => ({
        time: d.time,
        value: d.histogram,
        color: d.histogram >= 0 ? 'rgba(34,197,94,0.5)' : 'rgba(239,68,68,0.5)',
      }));
      const histSeries = chart.addHistogramSeries({});
      histSeries.setData(histData);

      const signalLine = chart.addLineSeries({ color: '#f87171', lineWidth: 1 });
      signalLine.setData(data.indicators.macd.map(d => ({ time: d.time, value: d.signal })));

      const macdLine = chart.addLineSeries({ color: '#34d399', lineWidth: 1 });
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

  const buildChart = useCallback(() => {
    if (!containerRef.current || !data?.bars?.length) return;

    // Clean up previous
    if (chartRef.current) {
      chartRef.current.remove();
      chartRef.current = null;
      seriesRef.current = {};
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
      if (typeof candleSeries.setMarkers === 'function') {
        candleSeries.setMarkers(markers);
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
      const ema9Series = chart.addLineSeries({
        color: '#60a5fa',
        lineWidth: 1,
        priceScaleId: 'right',
      });
      ema9Series.setData(data.indicators.ema9.filter(d => d.value > 0));
      seriesRef.current.ema9 = ema9Series;

      const ema21Series = chart.addLineSeries({
        color: '#fbbf24',
        lineWidth: 1,
        priceScaleId: 'right',
      });
      ema21Series.setData(data.indicators.ema21.filter(d => d.value > 0));
      seriesRef.current.ema21 = ema21Series;
    }

    // Volume histogram (separate pane)
    if (!showSignalsOnly) {
      const volumeSeries = chart.addHistogramSeries({
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

    // RSI pane (separate pane) — only when not signals-only
    if (!showSignalsOnly && data.indicators?.rsi?.length) {
      const rsiPane = chart.addLineSeries({
        color: '#a78bfa',
        lineWidth: 1,
        priceScaleId: 'rsi',
      });
      rsiPane.priceScale().applyOptions({
        scaleMargins: { top: 0.95, bottom: 0.85 },
      });
      rsiPane.setData(data.indicators.rsi.filter(d => d.value > 0));
      seriesRef.current.rsi = rsiPane;
    }

    // MACD pane — only when not signals-only
    if (!showSignalsOnly && data.indicators?.macd?.length) {
      const macdSeries = chart.addLineSeries({
        color: '#34d399',
        lineWidth: 1,
        priceScaleId: 'macd',
      });
      macdSeries.priceScale().applyOptions({
        scaleMargins: { top: 0.95, bottom: 0.95 },
      });
      macdSeries.setData(data.indicators.macd.map(d => ({ time: d.time, value: d.macd })));

      const signalSeries = chart.addLineSeries({
        color: '#f87171',
        lineWidth: 1,
        priceScaleId: 'macd',
      });
      signalSeries.setData(data.indicators.macd.map(d => ({ time: d.time, value: d.signal })));

      const histSeries = chart.addHistogramSeries({
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
