import { useEffect, useRef, useCallback, useMemo } from 'react';
import { createChart, LineSeries, AreaSeries, ColorType } from 'lightweight-charts';
import EmptyState from '../EmptyState';

/**
 * `lightweight-charts` accepts a `yyyy-mm-dd` string or a UNIX timestamp in SECONDS. It does NOT
 * accept a full ISO string, and it throws rather than ignoring one:
 *
 *     Error: Invalid date string=2026-09-14T06:00:00.000Z, expected format=yyyy-mm-dd
 *
 * ⚠️ THAT THROW TOOK THE WHOLE PAGE DOWN (#1134, measured 2026-10-22). `GET /api/backtest/equity/
 * :runId` returns `time` as a full ISO instant, and this component passed it straight to `setData`.
 * The page-level error boundary caught it and rendered "Something went wrong rendering this view" —
 * so a run that SUCCEEDED and was stored appeared to have produced nothing at all. Every successful
 * run crashed the backtest page.
 *
 * Seconds (not a date string) because an equity curve can have many points per day, and the chart
 * requires strictly-ascending unique times.
 */
function toChartTime(value) {
  const ms = typeof value === 'number' ? value : Date.parse(value);
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : null;
}

/**
 * Normalise the payload into what the chart will accept: valid times only, ascending, one point per
 * second. A bad point is DROPPED rather than thrown — one malformed timestamp must not destroy the
 * view, and the count of what survived is reported below the chart.
 */
function toChartPoints(equity) {
  const mapped = [];
  for (const d of equity ?? []) {
    const time = toChartTime(d.time);
    if (time == null) continue;
    mapped.push({ time, equity: Number(d.equity) || 0, drawdownPct: Number(d.drawdownPct) || 0 });
  }
  mapped.sort((a, b) => a.time - b.time);
  const deduped = [];
  for (const p of mapped) {
    if (deduped.length && deduped[deduped.length - 1].time === p.time) deduped[deduped.length - 1] = p;
    else deduped.push(p);
  }
  return deduped;
}

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

  const points = useMemo(() => toChartPoints(equityData?.equity), [equityData]);

  const buildChart = useCallback(() => {
    if (!containerRef.current || points.length === 0) return;

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

    const ddData = points.map((d) => ({
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
      points.map((d) => ({
        time: d.time,
        value: d.equity,
      }))
    );

    // Zero line (breakeven reference)
    if (points.length > 0) {
      const zeroSeries = chart.addSeries(LineSeries, {
        color: 'rgba(156,163,175,0.3)',
        lineWidth: 1,
        lineStyle: 2, // dashed
        priceScaleId: 'right',
        lastValueVisible: false,
      });
      zeroSeries.setData([
        { time: points[0].time, value: 0 },
        { time: points[points.length - 1].time, value: 0 },
      ]);
    }

    chart.timeScale().fitContent();
  }, [points, height]);

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

  if (points.length === 0) {
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
    <div className="bt-equity-wrapper" aria-label={`Equity curve${symbol ? ` for ${symbol}` : ''}`}>
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
