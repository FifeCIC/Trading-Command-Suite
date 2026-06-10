/**
 * LoadingSkeleton
 * ===============
 * Reusable loading skeleton component with variants.
 * CSS-only pulse animation — zero external dependencies.
 *
 * Variants:
 *   card    — rectangular skeleton card (default)
 *   table   — skeleton table rows
 *   text    — skeleton text lines
 *   chart   — skeleton bar chart
 *
 * Usage:
 *   <LoadingSkeleton variant="card" count={4} />
 *   <LoadingSkeleton variant="table" rows={5} cols={4} />
 *   <LoadingSkeleton variant="text" lines={3} />
 */

import './loading-skeleton.css'

export default function LoadingSkeleton({ variant = 'card', count = 1, rows = 5, cols = 4, lines = 3, className = '' }) {
  if (variant === 'table') {
    return (
      <div className={`ls-table ${className}`} role="status" aria-label="Loading table">
        {Array.from({ length: rows }).map((_, r) => (
          <div key={r} className="ls-table-row">
            {Array.from({ length: cols }).map((_, c) => (
              <div key={c} className="ls-table-cell" style={{ width: c === 0 ? '30%' : c === cols - 1 ? '20%' : '50%' }} />
            ))}
          </div>
        ))}
      </div>
    )
  }

  if (variant === 'text') {
    return (
      <div className={`ls-text ${className}`} role="status" aria-label="Loading text">
        {Array.from({ length: lines }).map((_, i) => (
          <div key={i} className="ls-text-line" style={{ width: i === lines - 1 ? '60%' : '100%' }} />
        ))}
      </div>
    )
  }

  if (variant === 'chart') {
    const bars = Array.from({ length: count })
    const maxHeight = 120
    return (
      <div className={`ls-chart ${className}`} role="status" aria-label="Loading chart">
        {bars.map((_, i) => {
          const h = 30 + Math.sin(i * 1.5) * 40 + 20
          return (
            <div
              key={i}
              className="ls-chart-bar"
              style={{ height: `${h}px`, animationDelay: `${i * 0.08}s` }}
            />
          )
        })}
      </div>
    )
  }

  // Default: card variant
  return (
    <div className={`ls-card-grid ${className}`} role="status" aria-label="Loading cards">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="ls-card" style={{ animationDelay: `${i * 0.1}s` }}>
          <div className="ls-card-bar ls-card-bar--wide" />
          <div className="ls-card-bar ls-card-bar--medium" />
          <div className="ls-card-bar ls-card-bar--narrow" />
        </div>
      ))}
    </div>
  )
}
