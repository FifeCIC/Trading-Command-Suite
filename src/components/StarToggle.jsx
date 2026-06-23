import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';

/**
 * Reusable StarToggle component.
 *
 * Usage:
 *   <StarToggle itemType="symbol" itemId={symbol.id} />
 *   <StarToggle itemType="strategy" itemId={strategy.id} size={20} />
 *
 * Props:
 *   - itemType: "symbol" | "protocol" | "strategy" | "watchlist"
 *   - itemId: the unique ID of the item
 *   - size: icon size in px (default 18)
 *   - className: additional CSS class
 */
export default function StarToggle({ itemType, itemId, size = 18, className = '' }) {
  const [starred, setStarred] = React.useState(false);
  const [loading, setLoading] = React.useState(false);
  const [animKey, setAnimKey] = React.useState(0);

  // Fetch current state from API on mount
  React.useEffect(() => {
    let cancelled = false;
    fetch(`/api/stars?type=${itemType}`)
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        const ids = data?.byType?.[itemType] || [];
        setStarred(ids.includes(itemId));
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [itemType, itemId]);

  const handleToggle = async (e) => {
    e.stopPropagation();
    e.preventDefault();
    if (loading) return;

    setLoading(true);
    // Optimistic update
    const prev = starred;
    setStarred(!starred);
    setAnimKey((k) => k + 1);

    try {
      const res = await fetch('/api/stars/toggle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ itemType, itemId }),
      });
      if (!res.ok) throw new Error('Toggle failed');
      const data = await res.json();
      setStarred(data.starred);
    } catch {
      // Rollback
      setStarred(prev);
    } finally {
      setLoading(false);
    }
  };

  return (
    <button
      onClick={handleToggle}
      className={`star-toggle ${className}`}
      disabled={loading}
      title={starred ? 'Unstar' : 'Star'}
      style={{
        background: 'none',
        border: 'none',
        cursor: 'pointer',
        padding: 0,
        fontSize: size,
        lineHeight: 1,
        opacity: loading ? 0.5 : 1,
        transition: 'opacity 0.15s',
      }}
    >
      <AnimatePresence mode="wait">
        <motion.span
          key={animKey}
          initial={{ scale: 0.6, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.6, opacity: 0 }}
          transition={{ duration: 0.2 }}
          style={{ display: 'inline-block' }}
        >
          {starred ? '⭐' : '☆'}
        </motion.span>
      </AnimatePresence>
    </button>
  );
}
