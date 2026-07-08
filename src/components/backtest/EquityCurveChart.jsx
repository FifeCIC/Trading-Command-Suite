import { useEffect, useRef, useCallback } from 'react';
import { createChart, LineSeries, AreaSeries, ColorType } from 'lightweight-charts';
import EmptyState from '../EmptyState';

/**
 * EquityCurveChart — renders a cumulative P&L equity curve with drawdown shading.
 * #103: Cumulative P&L + Drawdown Visualization
 *
 * Props:
 *   equityData - { equity: [{ time, equity, drawdownPct }], summary: {...} }
 *   symbol     - display label
 *   height     - chart height (default 300)
 */
export default function EquityCurveChart({ equityData, symbol, height = 300 }) {
  const containerRef = useRef(null);
  const chartRef = useRef(null);

  const buildChart = useCallback(() => {
    if (!containerRef.current || !equityData?.equity?.length) return;

    if (chartRef.current) {
      chartRef.current.remove();
      chartRef.current = null;
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
        scaleMargins: { top: 0.05, bottom: 0.3 },
      },
      timeScale: {
        borderColor: '#2d3040',
        timeVisible: true,
      },
      width: container.clientWidth,
      height,
    });

    chartRef.current = chart;

    // Drawdown area (fills downward from zero)
    const ddSeries = chart.addSeries(AreaSeries, {
      lineColor: 'transparent',
      topColor: 'rgba(239,68,68,0.18)',
      bottomColor: 'rgba(239,68,68,0.02)',
      priceScaleId: 'drawdown',
      lastValueVisible: false,
    });
    ddSeries.priceScale().applyOptions({
      scaleMargins: { top: 0.7, bottom: 0 },
      visible: true,
      borderColor: '#2d3040',
    });

    const ddData = equityData.equity.map((d) => ({
      time: d.time,
      value: -Math.abs(d.drawdownPct), // negative so area fills down
    }));
    ddSeries.setData(ddData);

    // Equity curve line
    const equitySeries = chart.addSeries(LineSeries, {
      color: '#22c55e',
      lineWidth: 2,
      priceScaleId: 'right',
    });
    equitySeries.setData(
      equityData.equity.map((d) => ({
        time: d.time,
        value: d.equity,
      }))
    );

    // Zero line (breakeven reference)
    if (equityData.equity.length > 0) {
      const zeroSeries = chart.addSeries(LineSeries, {
        color: 'rgba(156,163,175,0.3)',
        lineWidth: 1,
        lineStyle: 2, // dashed
        priceScaleId: 'right',
        lastValueVisible: false,
      });
      const firstTime = equityData.equity[0].time;
      const lastTime = equityData.equity[equityData.equity.length - 1].time;
      zeroSeries.setData([
        { time: firstTime, value: 0 },
        { time: lastTime, value: 0 },
      ]);
    }

    chart.timeScale().fitContent();
  }, [equityData, height]);

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
          height,
        });
      }
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [height]);

  if (!equityData?.equity?.length) {
    return (
      <EmptyState
        icon="📉"
        title="No trade data"
        description="Equity curve requires bracket trades (SL/TP > 0). Re-run backtest with SL% and TP% set."
      />
    );
  }

  const s = equityData.summary || {};

  return (
    <div className="bt-equity-wrapper">
      <div className="bt-equity-summary">
        <div className="bt-equity-stat">
          <span className="bt-equity-label">Final P&amp;L</span>
          <span className={`bt-equity-value ${(s.finalEquity ?? 0) >= 0 ? 'bt-green' : 'bt-red'}`}>
            ${(s.finalEquity ?? 0).toFixed(2)}
          </span>
        </div>
        <div className="bt-equity-stat">
          <span className="bt-equity-label">Peak Equity</span>
          <span className="bt-equity-value bt-green">${(s.peakEquity ?? 0).toFixed(2)}</span>
        </div>
        <div className="bt-equity-stat">
          <span className="bt-equity-label">Max Drawdown</span>
          <span className="bt-equity-value bt-red">−{(s.maxDrawdownPct ?? 0).toFixed(2)}%</span>
        </div>
        <div className="bt-equity-stat">
          <span className="bt-equity-label">Total Trades</span>
          <span className="bt-equity-value">{s.totalTrades ?? 0}</span>
        </div>
      </div>
      <div ref={containerRef} className="bt-equity-chart" style={{ height }} />
    </div>
  );
}
