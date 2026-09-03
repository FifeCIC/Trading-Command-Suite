/**
 * SignalBadge — the ONE component that renders a trading signal.
 * ===============================================================
 * Consumes a view model from buildScoreDisplay(). It never re-derives
 * BUY/HOLD/SELL, tone, or tradeability state itself.
 *
 * Usage:
 *   const vm = buildScoreDisplay(raw);
 *   <SignalBadge display={vm} />
 */
import './signal-badge.css';

export default function SignalBadge({ display, className = '', arrowOnly = false }) {
  if (!display || display.state === 'unscored') {
    return (
      <span className={`signal-badge signal-badge--muted ${className}`} title="No score produced.">
        —
      </span>
    );
  }

  if (display.frozen) {
    return (
      <span
        className={`signal-badge signal-badge--paused ${className}`}
        title={display.frozenTitle || 'Frozen at last close — not a live tradable signal.'}
      >
        <span className="signal-badge-arrow" aria-hidden="true">
          <svg width="9" height="9" viewBox="0 0 9 9" fill="currentColor" focusable="false">
            <rect x="1" y="0.5" width="2.5" height="8" rx="1" />
            <rect x="5.5" y="0.5" width="2.5" height="8" rx="1" />
          </svg>
        </span>
        PAUSED
      </span>
    );
  }

  if (!display.signal) {
    return <span className={`signal-badge signal-badge--neutral ${className}`}>—</span>;
  }

  return (
    <span
      className={`signal-badge signal-badge--${display.tone} ${className}`}
      title={arrowOnly ? display.signal || '' : undefined}
    >
      <span className="signal-badge-arrow" aria-hidden="true">{display.arrow}</span>
      {!arrowOnly && display.signal}
    </span>
  );
}
