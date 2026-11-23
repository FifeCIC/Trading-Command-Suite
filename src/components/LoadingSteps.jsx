/**
 * LoadingSteps — progress for work whose LENGTH IS KNOWN, driven by real counts.
 *
 * ── WHY THIS REFUSES TO RENDER WITHOUT A TOTAL ───────────────────────────────────────────────────
 * Owner, 2026-11-20, on this app's backtest page: *"this approach takes up too much space with loading
 * bars that aren't actually based on something loading."* A bar that fills on a timer is a number
 * nobody measured — it looks like a measurement and is a decoration. So:
 *
 *   `total` missing / 0 / not a number  → the rail renders NOTHING and says why, in one line.
 *   `total` real                        → one segment per step, coloured only when that step is done.
 *
 * ⚠️ It never invents the count. The caller must already know how many steps there are ("5 days
 * selected", "12 files to import"). If the honest answer is "unknown", the right effect is
 * `LoadingOrbit` — not a rail with a guessed total.
 *
 * ⚠️ `aria-live="polite"`, not `assertive`: this updates on every step, and an assertive region would
 * interrupt a screen-reader user repeatedly while the page is doing exactly what it said it would.
 *
 * Props:
 *   done      steps completed so far (clamped to [0, total])
 *   total     the real number of steps — the whole point; there is no default
 *   label     what is being counted, e.g. "Days tested"; used as the rail's accessible name
 *   stepLabel optional per-step names, indexed the same as the segments
 */
import './loader-states.css';
import { stepProgress } from '../core/loading-state.js';

export default function LoadingSteps({
  done = 0,
  total,
  label = 'Working',
  stepLabel,
  className = '',
}) {
  const p = stepProgress(done, total);

  // ⚠️ THE GUARD IS THE FEATURE. No real total means no honest bar, so we say so rather than animate.
  if (!p) {
    return (
      <p className={`ldl-steps-note ${className}`.trim()} role="status">
        {label}: the number of steps is not known, so no progress bar is shown — a bar that fills on a
        timer would be a number nobody measured.
      </p>
    );
  }

  const { steps, at, currentIndex } = p;
  const current = currentIndex < 0
    ? 'Done'
    : (Array.isArray(stepLabel) ? stepLabel[currentIndex] : null) ?? `${label} — step ${currentIndex + 1}`;

  return (
    <div className={`ldl-steps ${className}`.trim()} role="status" aria-live="polite">
      <ol className="ldl-rail" aria-label={`${label}: ${at} of ${steps} complete`}>
        {Array.from({ length: steps }).map((_, i) => (
          <li
            key={i}
            className={[
              'ldl-step',
              i < at ? 'ldl-step--done' : '',
              i === at && at < steps ? 'ldl-step--active' : '',
            ].filter(Boolean).join(' ')}
            title={Array.isArray(stepLabel) ? stepLabel[i] : undefined}
          />
        ))}
      </ol>
      <span className="ldl-steps-meta">
        <span>{current}</span>
        <span className="ldl-steps-count">{at} of {steps}</span>
      </span>
    </div>
  );
}
