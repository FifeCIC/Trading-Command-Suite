/**
 * EmptyState
 * ==========
 * Reusable "no data" placeholder with icon, title, description, and optional action button.
 * Use instead of raw <p>No data yet.</p> strings for consistent empty-state styling.
 *
 * Props:
 *   icon       — emoji or React node (default: 📭)
 *   title      — heading text (default: "Nothing here yet")
 *   description— body text explaining what's missing or how to populate
 *   actionLabel— text for the optional CTA button
 *   actionHref — URL for the CTA button (renders <a>)
 *   actionOnClick — function for the CTA button (renders <button>; takes precedence over actionHref)
 *   className  — extra CSS class
 *
 * Usage:
 *   <EmptyState
 *     icon="📊"
 *     title="No scores yet"
 *     description="Run the scoring pipeline to populate ranked symbols."
 *     actionLabel="Run Scoring"
 *     actionOnClick={() => runScoring()}
 *   />
 */

import { motion } from 'motion/react'

export default function EmptyState({
  icon = '📭',
  title = 'Nothing here yet',
  description = '',
  actionLabel,
  actionHref,
  actionOnClick,
  className = '',
}) {
  return (
    <motion.div
      className={`app-empty ${className}`}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      role="status"
    >
      <div className="app-empty-icon">{icon}</div>
      <h3 className="app-empty-title">{title}</h3>
      {description && <p className="app-empty-desc">{description}</p>}
      {actionLabel && (actionOnClick ? (
        <button type="button" className="app-empty-action" onClick={actionOnClick}>
          {actionLabel}
        </button>
      ) : actionHref ? (
        <a href={actionHref} className="app-empty-action">
          {actionLabel}
        </a>
      ) : null)}
    </motion.div>
  )
}
