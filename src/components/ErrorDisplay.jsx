/**
 * ErrorDisplay
 * ============
 * Reusable error display component with severity levels, retry button,
 * and optional stack trace in dev mode.
 *
 * Severity levels:
 *   warning  — Yellow/amber, non-critical issue
 *   error    — Red, operation failed (default)
 *   critical — Dark red, severe/system-level failure
 *
 * Usage:
 *   <ErrorDisplay message="Failed to load data." onRetry={() => refetch()} />
 *   <ErrorDisplay severity="warning" message="Rate limit approaching." />
 *   <ErrorDisplay severity="critical" message="Backend unreachable." error={err} />
 */

import './error-boundary.css'

export default function ErrorDisplay({
  message = 'An unexpected error occurred.',
  severity = 'error',
  onRetry,
  error,
  className = '',
}) {
  const showStack = import.meta.env.DEV && error?.stack

  return (
    <div className={`ed-wrap ed--${severity} ${className}`} role="alert">
      <div className="ed-icon">
        {severity === 'critical' ? '⛔' : severity === 'warning' ? '⚠️' : '❌'}
      </div>
      <div className="ed-body">
        <p className="ed-message">{message}</p>
        {onRetry && (
          <button type="button" className="ed-retry-btn" onClick={onRetry}>
            Retry
          </button>
        )}
        {showStack && (
          <details className="ed-stack">
            <summary>Stack trace (dev only)</summary>
            <pre>{error.stack}</pre>
          </details>
        )}
      </div>
    </div>
  )
}
