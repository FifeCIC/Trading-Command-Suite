/**
 * LoadingOrbit — "something is happening, and there is no shape to draw".
 *
 * ── WHEN THIS IS THE RIGHT ANSWER ───────────────────────────────────────────────────────────────
 * The wait has no layout to predict: a button that is mid-flight, a refresh, one value awaited inside
 * a panel that is already drawn. Where the shape IS known, use `LoadingSkeleton` instead — it holds the
 * final layout so nothing jumps when the data lands.
 *
 * ⚠️ A SPINNER IS NOT A PAGE. Three seconds of an unexplained ring on an otherwise empty screen is
 * what made `/lab/movers-strategy-backtest` read as broken on 2026-11-23. Pair it with a label, and
 * never use it in place of content whose shape you could have drawn.
 *
 * ⚠️ THE LABEL IS NOT OPTIONAL IN PRACTICE. An animation is invisible to a screen reader, to
 * `prefers-reduced-motion` and to a screenshot; the `role="status"` text is what survives all three.
 * `label` therefore defaults to "Loading…" rather than to nothing.
 *
 * Props:
 *   label      visible and announced text (default "Loading…")
 *   size       'md' (40px, for a panel) | 'sm' (16px, inline beside text)
 *   onAccent   the surface behind it is `--accent` filled, so the arc inverts to stay visible
 *   className  layout only — the caller owns where it sits
 */
import './loader-states.css';

export default function LoadingOrbit({
  label = 'Loading…',
  size = 'md',
  onAccent = false,
  className = '',
}) {
  const cls = [
    'ldl-orbit',
    size === 'sm' ? 'ldl-orbit--sm' : '',
    onAccent ? 'ldl-orbit--on-accent' : '',
  ].filter(Boolean).join(' ');

  return (
    <span className={`ldl-orbit-row ${className}`.trim()} role="status">
      <span className={cls} aria-hidden="true" />
      <span>{label}</span>
    </span>
  );
}
