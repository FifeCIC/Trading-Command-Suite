/**
 * CanvasCandlestickChart
 * ======================
 * Custom Canvas 2D candlestick renderer — no external charting libs.
 * Renders OHLC bars with wicks, bodies, volume bars, crosshair, indicators, and zoom/pan.
 *
 * Props:
 *   containerRef  — ref to the container div
 *   ticks         — array of { time, bid, ask, mid }
 *   intervalMs    — bucket interval in ms
 *   maxBars       — max bars to show
 *   indicators    — [{ type: 'ema'|'sma', period: number, color: string }]
 */

import { useEffect, useRef, useCallback } from 'react';

function bucketTicks(ticks, intervalMs) {
  if (!ticks.length) return [];
  const buckets = [];
  let cur = null;
  for (const t of ticks) {
    const bt = Math.floor(t.time / intervalMs) * intervalMs;
    const price = (t.bid + t.ask) / 2;
    if (!cur || cur.time !== bt) {
      if (cur) buckets.push(cur);
      cur = { time: bt, open: price, high: price, low: price, close: price };
    } else {
      cur.high = Math.max(cur.high, price);
      cur.low = Math.min(cur.low, price);
      cur.close = price;
    }
  }
  if (cur) buckets.push(cur);
  return buckets;
}

/** Compute EMA for an array of close prices */
function computeEMA(closes, period) {
  const result = new Array(closes.length).fill(null);
  if (closes.length < period) return result;
  // SMA for first value
  let sum = 0;
  for (let i = 0; i < period; i++) sum += closes[i];
  result[period - 1] = sum / period;
  const k = 2 / (period + 1);
  for (let i = period; i < closes.length; i++) {
    result[i] = closes[i] * k + result[i - 1] * (1 - k);
  }
  return result;
}

/** Compute SMA for an array of close prices */
function computeSMA(closes, period) {
  const result = new Array(closes.length).fill(null);
  if (closes.length < period) return result;
  let sum = 0;
  for (let i = 0; i < closes.length; i++) {
    sum += closes[i];
    if (i >= period) sum -= closes[i - period];
    if (i >= period - 1) result[i] = sum / period;
  }
  return result;
}

/** Compute RSI for an array of close prices */
function computeRSI(closes, period = 14) {
  const result = new Array(closes.length).fill(null);
  if (closes.length < period + 1) return result;
  let gains = 0, losses = 0;
  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff >= 0) gains += diff;
    else losses -= diff;
  }
  let avgGain = gains / period;
  let avgLoss = losses / period;
  result[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    avgGain = (avgGain * (period - 1) + (diff > 0 ? diff : 0)) / period;
    avgLoss = (avgLoss * (period - 1) + (diff < 0 ? -diff : 0)) / period;
    result[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }
  return result;
}

const COLORS = {
  bg: '#0a0d12',
  grid: 'rgba(128,128,128,0.06)',
  text: '#64748b',
  upBody: '#22c55e',
  downBody: '#ef4444',
  upWick: '#22c55e',
  downWick: '#ef4444',
  crosshair: 'rgba(255,255,255,0.15)',
  tooltipBg: '#1e293b',
  volUp: 'rgba(34,197,94,0.3)',
  volDown: 'rgba(239,68,68,0.3)',
};

const DEFAULT_INDICATORS = [
  { type: 'ema', period: 9, color: '#f59e0b' },
  { type: 'ema', period: 21, color: '#3b82f6' },
];

export default function CanvasCandlestickChart({
  containerRef,
  ticks = [],
  intervalMs = 5000,
  maxBars = 100,
  indicators = DEFAULT_INDICATORS,
}) {
  const canvasRef = useRef(null);
  const rafRef = useRef(null);
  const mouseRef = useRef({ x: -1, y: -1 });
  const dragRef = useRef(null); // { startX, startPan }
  const dimsRef = useRef({ w: 0, h: 0 });
  const zoomRef = useRef(1);    // horizontal zoom multiplier
  const panRef = useRef(0);     // horizontal pan offset in pixels

  const bars = bucketTicks(ticks, intervalMs).slice(-maxBars);

  // Compute indicator lines
  const closes = bars.map(b => b.close);
  const indicatorLines = indicators.map(ind => ({
    ...ind,
    values: ind.type === 'ema' ? computeEMA(closes, ind.period) : computeSMA(closes, ind.period),
  }));
  const rsiValues = computeRSI(closes, 14);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const { w, h } = dimsRef;
    if (w === 0 || h === 0 || bars.length === 0) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // Background
    ctx.fillStyle = COLORS.bg;
    ctx.fillRect(0, 0, w, h);

    // Layout: chart (62%) + volume (12%) + RSI (18%) + time labels
    const chartH = h * 0.60;
    const chartPad = { top: 16, right: 60, bottom: 4, left: 60 };
    const volTop = chartH + 4;
    const volH = h * 0.10;
    const rsiTop = volTop + volH + 4;
    const rsiH = h * 0.16;
    const rsiPad = { top: 8, bottom: 16 };

    const plotW = w - chartPad.left - chartPad.right;
    const plotH = chartH - chartPad.top - chartPad.bottom;

    if (plotW <= 0 || plotH <= 0) return;

    // Zoom/pan-adjusted bar spacing
    const zoom = zoomRef.current;
    const barSpace = Math.max((plotW / bars.length) * zoom, 1);
    const bodyWidth = Math.max(Math.min(barSpace * 0.6, 8 * zoom), 1);

    // Price range across visible bars
    const pan = panRef.current;
    const firstIdx = Math.max(0, Math.floor(-pan / barSpace));
    const lastIdx = Math.min(bars.length - 1, Math.floor((plotW - pan) / barSpace));
    const indices = [];
    for (let i = firstIdx; i <= lastIdx; i++) {
      const x = chartPad.left + pan + i * barSpace;
      if (x + barSpace > chartPad.left && x < w - chartPad.right) indices.push(i);
    }
    if (indices.length === 0 && bars.length > 0) indices.push(bars.length - 1);

    const visibleBars = indices.map(i => bars[i]);
    const allPrices = visibleBars.flatMap(b => [b.high, b.low]);
    // Also include indicator values in price range
    for (const ind of indicatorLines) {
      for (const i of indices) {
        const v = ind.values[i];
        if (v != null) allPrices.push(v);
      }
    }
    const priceMin = allPrices.length ? Math.min(...allPrices) : 0;
    const priceMax = allPrices.length ? Math.max(...allPrices) : 1;
    const priceRange = priceMax - priceMin || 1;

    const toY = (price) => chartPad.top + ((priceMax - price) / priceRange) * plotH;
    let gap = barSpace - bodyWidth;
    if (gap < 0) gap = 0;

    // Grid lines
    ctx.strokeStyle = COLORS.grid;
    ctx.lineWidth = 1;
    const gridLines = 6;
    for (let i = 0; i <= gridLines; i++) {
      const y = chartPad.top + (plotH / gridLines) * i;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
      const price = priceMax - (priceRange / gridLines) * i;
      ctx.fillStyle = COLORS.text;
      ctx.font = '10px monospace';
      ctx.textAlign = 'right';
      ctx.fillText(price.toFixed(5), chartPad.left - 6, y + 3);
    }

    // Draw candles (visible bars only)
    for (const i of indices) {
      const b = bars[i];
      const x = chartPad.left + pan + i * barSpace + gap / 2;
      const cx = x + bodyWidth / 2;
      const isUp = b.close >= b.open;

      // Wick
      ctx.strokeStyle = isUp ? COLORS.upWick : COLORS.downWick;
      ctx.lineWidth = Math.max(1, bodyWidth > 6 ? 1.5 : 1);
      ctx.beginPath();
      ctx.moveTo(cx, toY(b.high));
      ctx.lineTo(cx, toY(b.low));
      ctx.stroke();

      // Body
      const bodyTop = toY(Math.max(b.open, b.close));
      const bodyH = Math.max(Math.abs(toY(b.open) - toY(b.close)), 1);
      ctx.fillStyle = isUp ? COLORS.upBody : COLORS.downBody;
      if (bodyWidth < 1.5) {
        ctx.fillRect(cx - 0.5, bodyTop, 1, bodyH);
      } else {
        ctx.fillRect(x, bodyTop, Math.max(bodyWidth, 1), bodyH);
      }

      // Volume bar
      const allBars = bars;
      const maxVol = Math.max(...allBars.map(b2 => Math.abs(b2.close - b2.open) || 0.00001));
      const volHeight = Math.max(((Math.abs(b.close - b.open) || 0.00001) / maxVol) * volH, 1);
      const vy = volTop + volH - volHeight;
      ctx.fillStyle = isUp ? COLORS.volUp : COLORS.volDown;
      ctx.fillRect(x, vy, Math.max(bodyWidth, 1), volHeight);
    }

    // Draw indicator lines
    for (const ind of indicatorLines) {
      ctx.strokeStyle = ind.color;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      let started = false;
      for (const i of indices) {
        const v = ind.values[i];
        if (v == null) { started = false; continue; }
        const x = chartPad.left + pan + i * barSpace + bodyWidth / 2;
        const y = toY(v);
        if (!started) { ctx.moveTo(x, y); started = true; }
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }

    // Indicator legend
    let legendY = chartPad.top + 6;
    for (const ind of indicatorLines) {
      if (indicators.length === 0) break;
      ctx.fillStyle = ind.color;
      ctx.font = 'bold 9px monospace';
      ctx.textAlign = 'left';
      ctx.fillText(`${ind.type.toUpperCase()} ${ind.period}`, chartPad.left + 4, legendY);
      legendY += 13;
    }

    // ── RSI Panel ────────────────────────────────────
    const rsiPlotH = rsiH - rsiPad.top - rsiPad.bottom;
    // RSI background
    ctx.fillStyle = 'rgba(0,0,0,0.2)';
    ctx.fillRect(0, rsiTop, w, rsiH);
    // RSI grid lines at 70 and 30
    ctx.strokeStyle = 'rgba(128,128,128,0.12)';
    ctx.lineWidth = 1;
    ctx.setLineDash([2, 4]);
    const rsi70y = rsiTop + rsiPad.top + ((100 - 70) / 100) * rsiPlotH;
    const rsi30y = rsiTop + rsiPad.top + ((100 - 30) / 100) * rsiPlotH;
    const rsi50y = rsiTop + rsiPad.top + rsiPlotH / 2;
    [rsi70y, rsi50y, rsi30y].forEach(y => {
      ctx.beginPath();
      ctx.moveTo(chartPad.left, y);
      ctx.lineTo(w - chartPad.right, y);
      ctx.stroke();
    });
    ctx.setLineDash([]);
    // RSI labels
    ctx.fillStyle = COLORS.text;
    ctx.font = '9px monospace';
    ctx.textAlign = 'right';
    ctx.fillText('70', chartPad.left - 4, rsi70y + 3);
    ctx.fillText('50', chartPad.left - 4, rsi50y + 3);
    ctx.fillText('30', chartPad.left - 4, rsi30y + 3);
    // RSI label
    ctx.textAlign = 'left';
    ctx.fillText('RSI 14', chartPad.left + 4, rsiTop + rsiPad.top + 10);
    // Draw RSI line
    ctx.strokeStyle = '#a78bfa';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    let rsiStarted = false;
    for (const i of indices) {
      const v = rsiValues[i];
      if (v == null) { rsiStarted = false; continue; }
      const x = chartPad.left + pan + i * barSpace + bodyWidth / 2;
      const y = rsiTop + rsiPad.top + ((100 - v) / 100) * rsiPlotH;
      if (!rsiStarted) { ctx.moveTo(x, y); rsiStarted = true; }
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
    // RSI area fill (gradient)
    if (rsiStarted) {
      const grad = ctx.createLinearGradient(0, rsiTop + rsiPad.top, 0, rsiTop + rsiPad.top + rsiPlotH);
      grad.addColorStop(0, 'rgba(167,139,250,0.15)');
      grad.addColorStop(1, 'rgba(167,139,250,0.0)');
      ctx.fillStyle = grad;
      ctx.lineTo(w - chartPad.right, rsiTop + rsiPad.top + rsiPlotH);
      ctx.lineTo(chartPad.left, rsiTop + rsiPad.top + rsiPlotH);
      ctx.closePath();
      ctx.fill();
    }

    // Crosshair
    const mx = mouseRef.current.x;
    const my = mouseRef.current.y;
    if (mx > chartPad.left && mx < w - chartPad.right && my > chartPad.top && my < chartH) {
      ctx.strokeStyle = COLORS.crosshair;
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(mx, chartPad.top);
      ctx.lineTo(mx, chartH);
      ctx.moveTo(chartPad.left, my);
      ctx.lineTo(w - chartPad.right, my);
      ctx.stroke();
      ctx.setLineDash([]);

      // Find nearest bar
      let nearestIdx = -1;
      let nearestDist = Infinity;
      for (const i of indices) {
        const cx = chartPad.left + pan + i * barSpace + bodyWidth / 2;
        const dist = Math.abs(mx - cx);
        if (dist < nearestDist) { nearestDist = dist; nearestIdx = i; }
      }
      if (nearestIdx >= 0) {
        const b = bars[nearestIdx];
        const tipW = 160;
        const tipX = Math.min(mx + 16, w - tipW - 8);
        const tipY = Math.max(chartPad.top + 4, my - 72);
        ctx.fillStyle = COLORS.tooltipBg;
        ctx.strokeStyle = 'rgba(255,255,255,0.1)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.roundRect(tipX, tipY, tipW, 68, 6);
        ctx.fill();
        ctx.stroke();

        ctx.fillStyle = '#e2e8f0';
        ctx.font = '11px monospace';
        ctx.textAlign = 'left';
        ctx.fillText(`O: ${b.open.toFixed(5)}`, tipX + 8, tipY + 15);
        ctx.fillText(`H: ${b.high.toFixed(5)}`, tipX + 8, tipY + 29);
        ctx.fillText(`L: ${b.low.toFixed(5)}`, tipX + 8, tipY + 43);
        ctx.fillStyle = b.close >= b.open ? '#22c55e' : '#ef4444';
        ctx.fillText(`C: ${b.close.toFixed(5)}`, tipX + 80, tipY + 29);

        // Indicator values in tooltip
        let indY = tipY + 57;
        ctx.font = '9px monospace';
        for (const ind of indicatorLines) {
          const vi = ind.values[nearestIdx];
          if (vi != null) {
            ctx.fillStyle = ind.color;
            ctx.fillText(`${ind.type.toUpperCase()}${ind.period}: ${vi.toFixed(5)}`, tipX + 8, indY);
            indY += 12;
          }
        }
        // RSI value
        const rsiV = rsiValues[nearestIdx];
        if (rsiV != null) {
          ctx.fillStyle = '#a78bfa';
          ctx.fillText(`RSI 14: ${rsiV.toFixed(1)}`, tipX + 8, indY);
          indY += 12;
        }

        ctx.fillStyle = COLORS.text;
        ctx.font = '9px monospace';
        ctx.fillText(new Date(b.time).toLocaleTimeString(), tipX + 8, indY);
      }
    }

    // Time labels (sparse)
    ctx.fillStyle = COLORS.text;
    ctx.font = '9px monospace';
    ctx.textAlign = 'center';
    const timeStep = Math.max(Math.floor(indices.length / 6), 1);
    for (let j = 0; j < indices.length; j += timeStep) {
      const i = indices[j];
      const b = bars[i];
      const x = chartPad.left + pan + i * barSpace + bodyWidth / 2;
      if (x > chartPad.left && x < w - chartPad.right) {
        ctx.fillText(
          new Date(b.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
          x,
          chartH + 14
        );
      }
    }

    // Zoom level indicator
    ctx.fillStyle = COLORS.text;
    ctx.font = '9px monospace';
    ctx.textAlign = 'right';
    ctx.fillText(`zoom: ${zoom.toFixed(1)}x`, w - chartPad.right + 4, chartH + 14);
  }, [bars, indicatorLines, rsiValues]);

  // Resize + render loop
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        dimsRef.current = { w: entry.contentRect.width, h: entry.contentRect.height };
      }
    });
    ro.observe(el);

    const render = () => {
      draw();
      rafRef.current = requestAnimationFrame(render);
    };
    render();

    return () => {
      ro.disconnect();
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [containerRef, draw]);

  // Mouse tracking + wheel zoom + drag pan
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const onMove = (e) => {
      const rect = el.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      mouseRef.current = { x: mx, y: my };

      // Drag pan
      if (dragRef.current) {
        const dx = mx - dragRef.current.startX;
        panRef.current = dragRef.current.startPan + dx;
      }
    };

    const onDown = (e) => {
      if (e.button === 0) { // left click
        dragRef.current = { startX: e.clientX - el.getBoundingClientRect().left, startPan: panRef.current };
      }
    };

    const onUp = () => {
      dragRef.current = null;
    };

    const onWheel = (e) => {
      e.preventDefault();
      const delta = -e.deltaY * 0.005;
      const newZoom = Math.max(0.2, Math.min(5, zoomRef.current + delta));
      zoomRef.current = newZoom;
      // Clamp pan
      const maxPan = Math.max(0, (bars.length * (el.clientWidth / bars.length) * newZoom) - (el.clientWidth - 120));
      panRef.current = Math.max(-maxPan, Math.min(0, panRef.current));
    };

    const onLeave = () => {
      mouseRef.current = { x: -1, y: -1 };
      dragRef.current = null;
    };

    el.addEventListener('mousemove', onMove);
    el.addEventListener('mousedown', onDown);
    el.addEventListener('mouseup', onUp);
    el.addEventListener('mouseleave', onLeave);
    el.addEventListener('wheel', onWheel, { passive: false });

    return () => {
      el.removeEventListener('mousemove', onMove);
      el.removeEventListener('mousedown', onDown);
      el.removeEventListener('mouseup', onUp);
      el.removeEventListener('mouseleave', onLeave);
      el.removeEventListener('wheel', onWheel);
    };
  }, [containerRef, bars.length]);

  return <canvas ref={canvasRef} className="clab-canvas" />;
}
