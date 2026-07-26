/**
 * UnavailablePlaceholder — shown when a page has no real data yet.
 * Never shows mock/demo data. Clear about what's missing and what to do.
 */
import { motion } from 'motion/react';

export default function UnavailablePlaceholder({ title, message, action, actionUrl }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="unavailable-placeholder"
    >
      <div className="unavailable-icon">🚧</div>
      <h2 className="unavailable-title">
        {title || 'Not Available'}
      </h2>
      <p className="unavailable-message">
        {message || 'This feature requires additional setup or is not yet connected to live data.'}
      </p>
      {action && actionUrl && (
        <a href={actionUrl} className="unavailable-action">
          {action}
        </a>
      )}
      <div style={{
        marginTop: 16, padding: '8px 12px', background: 'rgba(239,68,68,0.08)',
        borderRadius: 6, fontSize: '0.7rem', color: '#ef4444',
        border: '1px solid rgba(239,68,68,0.15)',
      }}>
        ⚠ No mock or demo data is used in this application.
      </div>
    </motion.div>
  );
}
