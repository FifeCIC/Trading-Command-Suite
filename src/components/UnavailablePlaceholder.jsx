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
      style={{
        maxWidth: 500, margin: '60px auto', textAlign: 'center',
        padding: 40, background: 'var(--bg-card)', border: '1px solid var(--border)',
        borderRadius: 12, color: 'var(--text)',
      }}
    >
      <div style={{ fontSize: '2rem', marginBottom: 12 }}>🚧</div>
      <h2 style={{ margin: '0 0 8px', fontSize: '1.2rem', color: 'var(--text-strong)' }}>
        {title || 'Not Available'}
      </h2>
      <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', lineHeight: 1.6, margin: '0 0 16px' }}>
        {message || 'This feature requires additional setup or is not yet connected to live data.'}
      </p>
      {action && actionUrl && (
        <a
          href={actionUrl}
          style={{
            display: 'inline-block', padding: '8px 18px', borderRadius: 8,
            background: 'var(--accent)', color: '#fff', textDecoration: 'none',
            fontSize: '0.82rem', fontWeight: 600,
          }}
        >
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
