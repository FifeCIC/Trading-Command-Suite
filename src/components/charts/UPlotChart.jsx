import { useEffect, useRef, useImperativeHandle, forwardRef } from 'react';
import uPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';
import './UPlotChart.css';

/**
 * UPlotChart — candlestick + volume chart using uPlot.
 * Exposes ChartAdapter methods via ref.
 */

function toUnixSec(time) {
  if (typeof time === 'number') return time > 1e12 ? Math.floor(time / 1000) : time;
  return Math.floor(new Date(time).getTime() / 1000);
}

function buildOhlcData(candles) {
  if (!candles?.length) return [[], [], [], [], [], []];
  const times = [];
  const opens = [];
  const highs = [];
  const lows = [];
  const closes = [];
  const volumes = [];
  for (const c of candles) {
    times.push(toUnixSec(c.time));
    opens.push(c.open);
    highs.push(c.high);
    lows.push(c.low);
    closes.push(c.close);
    volumes.push(c.volume ?? 0);
  }
  return [times, opens, highs, lows, closes, volumes];
}

const darkTheme = {
  bg: '#13141a',
  grid: '#1e203066',
  text: '#6b7280',
  cross: '#ffffff44',
  up: '#22c55e',
  down: '#ef4444',
  border: '#2d3040',
  wick: '#6b7280',
};

const UPlotChart = forwardRef(function UPlotChart({ candles = [], height = 500, theme = 'dark' }, ref) {
  const containerRef = useRef(null);
  const instanceRef = useRef(null);
  const dataRef = useRef(candles);

  dataRef.current = candles;

  // ── Build & mount chart ──────────────────────────────

  useEffect(() => {
    if (!containerRef.current) return;

    const data = buildOhlcData(candles);
    const t = darkTheme;

    const opts = {
      width: containerRef.current.clientWidth,
      height,
      cursor: { show: true, drag: { x: true, y: false } },
      select: { show: false },
      legend: { show: false },
      axes: [
        { stroke: t.border, grid: { stroke: t.grid }, ticks: { stroke: t.text } },
        { stroke: t.border, grid: { stroke: t.grid }, ticks: { stroke: t.text }, side: 1, scale: 'price' },
        { stroke: t.border, grid: { stroke: t.grid }, ticks: { stroke: t.text }, side: 3, scale: 'volume', size: 80 },
      ],
      series: [
        {},
        {
          label: 'OHLC',
          stroke: t.wick,
          width: 1,
          paths: () => null,
          points: { show: false },
        },
        {},
        {},
        {},
        {
          label: 'Volume',
          stroke: 'rgba(107,114,128,0.3)',
          fill: 'rgba(107,114,128,0.1)',
          width: 1,
          scale: 'volume',
          points: { show: false },
        },
      ],
      scales: {
        price: { auto: true },
        volume: { auto: true, range: (u, min, max) => [0, max * 3] },
      },
    };

    // Custom candlestick rendering via draw hook
    const drawCandles = (u) => {
      const { ctx, data: d } = u;
      const [times, opens, highs, lows, closes] = d;
      if (!times?.length) return;

      const priceScale = u.scales.price;
      const timeScale = u.scales.time;
      const barWidth = Math.max(2, u.bbox.width / times.length * 0.6);

      for (let i = 0; i < times.length; i++) {
        const x = timeScale.valToPos(times[i], 'center');
        const yOpen = priceScale.valToPos(opens[i], 'center');
        const yHigh = priceScale.valToPos(highs[i], 'center');
        const yLow = priceScale.valToPos(lows[i], 'center');
        const yClose = priceScale.valToPos(closes[i], 'center');

        const isUp = closes[i] >= opens[i];
        const color = isUp ? t.up : t.down;

        // Wick
        ctx.strokeStyle = t.wick;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x, yHigh);
        ctx.lineTo(x, yLow);
        ctx.stroke();

        // Body
        const bodyTop = isUp ? yClose : yOpen;
        const bodyBottom = isUp ? yOpen : yClose;
        const bodyHeight = Math.max(1, bodyBottom - bodyTop);

        ctx.fillStyle = color;
        ctx.fillRect(x - barWidth / 2, bodyTop, barWidth, bodyHeight);
      }
    };

    const u = new uPlot(opts, data, containerRef.current);
    u.setSize({ width: containerRef.current.clientWidth, height });
    instanceRef.current = u;

    // Override draw for candlestick rendering
    const origDraw = u.draw;
    u.draw = function () {
      origDraw.call(this);
      drawCandles(u);
    };
    u.redraw();

    const handleResize = () => {
      if (containerRef.current) {
        u.setSize({ width: containerRef.current.clientWidth, height });
      }
    };
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      u.destroy();
      instanceRef.current = null;
    };
  }, [candles, height]);

  // ── Expose adapter API ───────────────────────────────

  useImperativeHandle(ref, () => ({
    renderCandlesticks(data) {
      if (!instanceRef.current || !data?.length) return;
      const u = instanceRef.current;
      const newData = buildOhlcData(data);
      u.setData(newData);
    },
    addMarker(marker) {
      if (!instanceRef.current) return;
      const u = instanceRef.current;
      const { ctx, scales } = u;
      const x = scales.time.valToPos(toUnixSec(marker.time), 'center');
      const y = scales.price.valToPos(marker.price, 'center');
      const color = marker.color || '#fbbf24';

      // Draw on next redraw
      const origDraw = u.draw;
      u.draw = function () {
        origDraw.call(this);
        ctx.fillStyle = color;
        ctx.font = '11px sans-serif';
        ctx.fillText(marker.text, x + 6, y - 6);

        // Arrow
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        const arrowY = marker.position === 'aboveBar' ? y - 8 : y + 8;
        ctx.moveTo(x, arrowY + (marker.position === 'aboveBar' ? 6 : -6));
        ctx.lineTo(x - 3, arrowY);
        ctx.lineTo(x + 3, arrowY);
        ctx.closePath();
        ctx.fillStyle = color;
        ctx.fill();
      };
      u.redraw();
    },
    addZone(zone) {
      if (!instanceRef.current) return;
      const u = instanceRef.current;
      const { ctx, scales } = u;
      const x1 = scales.time.valToPos(toUnixSec(zone.startTime), 'left');
      const x2 = scales.time.valToPos(toUnixSec(zone.endTime), 'right');
      const y1 = scales.price.valToPos(zone.topPrice, 'top');
      const y2 = scales.price.valToPos(zone.bottomPrice, 'bottom');

      const origDraw = u.draw;
      u.draw = function () {
        origDraw.call(this);
        ctx.fillStyle = zone.color + '1a'; // 10% opacity
        ctx.fillRect(x1, y1, x2 - x1, y2 - y1);
        if (zone.label) {
          ctx.fillStyle = zone.color;
          ctx.font = '10px sans-serif';
          ctx.fillText(zone.label, x1 + 4, y2 - 4);
        }
      };
      u.redraw();
    },
    addHorizontalLine(line) {
      if (!instanceRef.current) return;
      const u = instanceRef.current;
      const { ctx, scales } = u;
      const y = scales.price.valToPos(line.price, 'center');

      const origDraw = u.draw;
      u.draw = function () {
        origDraw.call(this);
        ctx.strokeStyle = line.color;
        ctx.lineWidth = line.width || 1;
        if (line.style === 'dashed') ctx.setLineDash([6, 4]);
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(u.bbox.width, y);
        ctx.stroke();
        ctx.setLineDash([]);
        if (line.label) {
          ctx.fillStyle = line.color;
          ctx.font = '10px sans-serif';
          ctx.fillText(line.label, u.bbox.width - 80, y - 4);
        }
      };
      u.redraw();
    },
    toggleIndicator() { /* Indicators drawn via draw hook override */ },
    setTimeframe() { /* Timeframe change handled by parent via data reload */ },
    onCrosshairMove(cb) {
      if (!instanceRef.current) return;
      const u = instanceRef.current;
      u.cursor.drag = undefined; // disable drag
      const origSetCursor = u.setCursor.bind(u);
      u.setCursor = (pos) => {
        origSetCursor(pos);
        if (pos) {
          const data = u.data;
          const idx = u.posToIdx(pos.left);
          if (idx >= 0 && data[0]?.[idx]) {
            cb({ time: String(data[0][idx]), price: data[4]?.[idx] ?? 0 });
          }
        } else {
          cb(null);
        }
      };
    },
    destroy() {
      if (instanceRef.current) {
        instanceRef.current.destroy();
        instanceRef.current = null;
      }
    },
  }), []);

  return (
    <div className="uplot-chart-container" ref={containerRef} style={{ width: '100%' }} />
  );
});

export default UPlotChart;
