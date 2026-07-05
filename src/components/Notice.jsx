/**
 * Notice — Reusable theme-consistent notice/alert banner.
 *
 * Usage:
 *   <Notice level="warning" icon="⚠️">
 *     This is a warning message with <strong>bold text</strong>.
 *   </Notice>
 *
 * Levels: success | warning | critical | info
 */
export default function Notice({ level = 'info', icon, children, className = '' }) {
  const defaultIcons = {
    success: '✅',
    warning: '⚠️',
    critical: '❌',
    info: 'ℹ️',
  };

  return (
    <div className={`app-notice app-notice--${level} ${className}`}>
      <span className="app-notice-icon">{icon || defaultIcons[level] || 'ℹ️'}</span>
      <div className="app-notice-body">{children}</div>
    </div>
  );
}
