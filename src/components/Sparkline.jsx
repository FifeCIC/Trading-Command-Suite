/**
 * Sparkline — a shape, not a chart.
 *
 * ── EXTRACTED 2026-11-26 FROM `ChangeStat.jsx` ──────────────────────────────────────────────────
 * It lived there as a private helper, and the movers page's attempt trend needs the same glyph. A
 * second copy is the kind of duplication this repo pays for: both drift and only one gets the next
 * fix. The geometry, the 2-point floor and the `role="img"` label are unchanged — only the file moved.
 *
 * ── WHY INLINE SVG AND NOT A CHART LIBRARY ─────────────────────────────────────────────────────
 * `lightweight-charts` is the app's only chart library and is built for interactive series with axes
 * and crosshairs — pulling it in for a 60×18 glyph adds a canvas, a resize observer and a chart
 * lifecycle per row. A polyline is cheaper and cannot leak. Use the real library when the reader needs
 * to interrogate the series; use this when they only need its SHAPE.
 *
 * ── COLOUR IS THE CALLER'S ─────────────────────────────────────────────────────────────────────
 * The stroke is not set here, so each call site keeps its own meaning (`ChangeStat` colours by
 * direction; the movers panel by nothing at all). A shared colour would make a bad series look fine.
 */
import './sparkline.css';

/**
 * ⚠️ Requires 2+ finite points. One point has no shape, and drawing it as a flat line would assert
 * "no change", which is a claim the data does not support.
 *
 * @param {{ series?: number[], width?: number, height?: number, label?: string, className?: string }} props
 */
export default function Sparkline({ series, width = 64, height = 18, label, className = '' }) {
  const points = Array.isArray(series) ? series.filter((n) => Number.isFinite(n)) : [];
  if (points.length < 2) return null;

  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = max - min || 1; // a flat series is drawn mid-height, not divided by zero
  const stepX = width / (points.length - 1);

  const d = points
    .map((v, i) => `${(i * stepX).toFixed(2)},${(height - ((v - min) / span) * height).toFixed(2)}`)
    .join(' ');

  return (
    <svg
      className={`spark ${className}`.trim()}
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={label || `Trend across ${points.length} points`}
      preserveAspectRatio="none"
    >
      <polyline points={d} fill="none" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}
