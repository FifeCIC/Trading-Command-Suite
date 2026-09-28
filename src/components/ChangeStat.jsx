import './change-stat.css';

/**
 * ChangeStat — the reusable "performance CHANGE" block.
 * ======================================================
 *
 * ── WHY THIS EXISTS ───────────────────────────────────────────────────────────────────────────
 * Owner direction, 2026-09-28: *"We're at the point when we need to see not just total performance
 * but performance change."*
 *
 * A total answers "how much". It cannot answer "is this still working?" — and those are different
 * questions. A P&L of −24 looks identical whether it is a system steadily recovering from −90 or a
 * system that was +40 last week and is now decaying. Only the DELTA separates them, and until now
 * nearly every trading page in this app rendered a snapshot with no time axis.
 *
 * ── THE ONE RULE THIS COMPONENT ENFORCES ─────────────────────────────────────────────────────
 * ⚠️ `previous === null` means UNKNOWN, and it must NEVER be rendered as 0.
 *
 * `0` asserts "the prior period produced nothing" — a claim about the market. `null` says we could
 * not measure it (no history, too few trades, the window predates the data). Collapsing the two
 * turns an unmeasured change into a reassuring zero, which is the same defect class that produced
 * a fabricated 6.56% give-back in this repo on 2026-09-28. So `null` renders an explicit
 * "no comparison" state with the reason, never a number.
 *
 * ── WHY INLINE SVG AND NOT A CHART LIBRARY ───────────────────────────────────────────────────
 * The sparkline is ~15 points of polyline. `lightweight-charts` is the app's only chart library and
 * is built for interactive time series with axes and crosshairs — pulling it in for a 60×18 glyph
 * adds a canvas, a resize observer and a chart lifecycle per row. A polyline is cheaper and cannot
 * leak. Use the real library when the reader needs to interrogate the series; use this when they
 * only need its SHAPE.
 *
 * ── ACCESSIBILITY ────────────────────────────────────────────────────────────────────────────
 * Direction is never carried by colour alone: the sign (+/−) and an arrow glyph are always present,
 * so the block survives both colour-blindness and a greyscale theme. `role="img"` + `aria-label`
 * on the sparkline gives a screen reader the same statement the sighted reader gets from the shape.
 */

/** Format a number for display. Falls back to a plain fixed-2 string when no formatter is given. */
const defaultFormat = (v) => (v == null ? '—' : v.toFixed(2));

/**
 * Sparkline — a shape, not a chart. Returns null when there is nothing honest to draw.
 *
 * ⚠️ Requires 2+ finite points. One point has no shape, and drawing it as a flat line would assert
 * "no change", which is a claim the data does not support.
 */
function Sparkline({ series, width = 64, height = 18, label }) {
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
      className="change-stat__spark"
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

/**
 * @param {object} props
 * @param {string} props.label      What is being measured (a symbol, a bot, "Account").
 * @param {number|null} props.current   The recent value.
 * @param {number|null} props.previous  The prior-period value. **null = unknown, not zero.**
 * @param {number[]} [props.series]     Optional values for the sparkline.
 * @param {(v:number)=>string} [props.format] Display formatter.
 * @param {string} [props.hint]         One short line naming the window, e.g. "last 7d vs prior 7d".
 * @param {boolean} [props.invert]      True when a RISE is bad (e.g. give-back, drawdown).
 * @param {string} [props.unavailableReason] Why there is no comparison — shown when previous is null.
 */
export default function ChangeStat({
  label,
  current,
  previous,
  series,
  format = defaultFormat,
  hint,
  invert = false,
  unavailableReason,
}) {
  const hasComparison = previous != null && current != null;
  const delta = hasComparison ? current - previous : null;

  // ⚠️ `direction` is derived, and 'flat' is its own state rather than being folded into 'up'.
  // A delta of exactly 0 is information; treating it as a rise would misreport a steady system.
  let direction = 'unknown';
  if (delta != null) direction = delta > 0 ? 'up' : delta < 0 ? 'down' : 'flat';

  // `invert` exists because "up" is not universally good — more give-back or more drawdown is worse.
  const tone =
    direction === 'unknown' || direction === 'flat'
      ? 'flat'
      : (direction === 'up') !== invert
        ? 'good'
        : 'bad';

  const sign = delta == null ? '' : delta > 0 ? '+' : delta < 0 ? '−' : '';
  const arrow = direction === 'up' ? '▲' : direction === 'down' ? '▼' : '';

  return (
    <div className={`change-stat change-stat--${tone}`}>
      <div className="change-stat__label">{label}</div>

      <div className="change-stat__value">{format(current)}</div>

      {hasComparison ? (
        <div className="change-stat__delta">
          <span className="change-stat__arrow" aria-hidden="true">{arrow}</span>
          <span className="change-stat__sign">{sign}</span>
          {format(Math.abs(delta))}
        </div>
      ) : (
        // ⚠️ The whole point of this branch: an unmeasurable change says so.
        <div className="change-stat__delta change-stat__delta--unknown">
          no comparison
        </div>
      )}

      {series?.length > 1 && (
        <Sparkline
          series={series}
          label={`${label}: ${series.length} points from ${format(series[0])} to ${format(series[series.length - 1])}`}
        />
      )}

      {hint && <div className="change-stat__hint">{hint}</div>}
      {!hasComparison && unavailableReason && (
        <div className="change-stat__hint change-stat__hint--reason">{unavailableReason}</div>
      )}
    </div>
  );
}
