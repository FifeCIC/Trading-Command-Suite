/**
 * StatusBadge — Reusable themed status pill/chip.
 *
 * Usage:
 *   <StatusBadge status="active">Active</StatusBadge>
 *   <StatusBadge status="failed">Failed</StatusBadge>
 *
 * Variants: active | inactive | passed | failed | pending | info
 */
export default function StatusBadge({ status = 'info', children, className = '' }) {
  return (
    <span className={`app-badge app-badge--${status} ${className}`}>
      {children || status}
    </span>
  );
}
