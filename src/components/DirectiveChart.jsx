/**
 * DirectiveChart — lightweight-charts candlestick chart for directive testing.
 * Renders bar data returned from POST /api/directives/:id/test.
 * Used by DirectiveDetailPage to show the price action a directive evaluated.
 */
import { useEffect, useRef } from 'react';
import { createChart, CandlestickSeries } from 'lightweight-charts';

export default function DirectiveChart({ bars, symbol, height = 300 }) {
  const containerRef = useRef(null);
  const chartRef = useRef(null);

  useEffect(() => {
    if (!bars || bars.length === 0 || !containerRef.current) return;

    // Clean up previous chart
    if (chartRef.current) {
      chartRef.current.remove();
      chartRef.current = null;
    }

    const chart = createChart(containerRef.current, {
      height,
      layout: {
        background: { color: 'transparent' },
        textColor: 'var(--ink-soft, #94a3b8)',
      },
      grid: {
        vertLines: { color: 'var(--line, rgba(255,255,255,0.05))' },
        horzLines: { color: 'var(--line, rgba(255,255,255,0.05))' },
      },
      crosshair: { mode: 0 },
      rightPriceScale: {
        borderColor: 'var(--line, rgba(255,255,255,0.1))',
      },
      timeScale: {
        borderColor: 'var(--line, rgba(255,255,255,0.1))',
        timeVisible: true,
        secondsVisible: false,
      },
    });

    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: '#22c55e',
      downColor: '#ef4444',
      borderUpColor: '#22c55e',
      borderDownColor: '#ef4444',
      wickUpColor: '#22c55e',
      wickDownColor: '#ef4444',
    });

    candleSeries.setData(bars);
    chart.timeScale().fitContent();
    chartRef.current = chart;

    // Handle resize
    const ro = new ResizeObserver(() => {
      if (chartRef.current && containerRef.current) {
        chartRef.current.applyOptions({ width: containerRef.current.clientWidth });
      }
    });
    ro.observe(containerRef.current);

    return () => {
      ro.disconnect();
      if (chartRef.current) {
        chartRef.current.remove();
        chartRef.current = null;
      }
    };
  }, [bars, height]);

  if (!bars || bars.length === 0) {
    return <div className="dd-chart-empty">No bar data — run a test first</div>;
  }

  return (
    <div ref={containerRef} className="dd-chart-container" style={{ width: '100%', minHeight: height }} />
  );
}
