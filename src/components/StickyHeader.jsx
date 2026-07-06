import { useState, useEffect } from 'react';

/**
 * StickyHeader — a scroll-driven header that shrinks when the user scrolls down.
 *
 * Sticks to the top of the viewport. Smoothly transitions between expanded and
 * shrunk states as the page scrolls past the threshold.
 *
 * Usage:
 *   <StickyHeader>
 *     <span>Live P&L: +$1,234.56</span>
 *   </StickyHeader>
 *
 * Props:
 *   - shrinkThreshold: scrollTop px to trigger shrink (default 80)
 *   - expandedPadding: CSS padding when expanded (default '1.5rem 1rem')
 *   - shrunkPadding: CSS padding when shrunk (default '0.5rem 1rem')
 *   - expandedFontSize: font-size when expanded (default '1.2rem')
 *   - shrunkFontSize: font-size when shrunk (default '0.85rem')
 *   - className: additional CSS class for the sticky container
 *   - children: content rendered inside the sticky header
 */
export default function StickyHeader({
  shrinkThreshold = 80,
  expandedPadding = '1.5rem 1rem',
  shrunkPadding = '0.5rem 1rem',
  expandedFontSize = '1.2rem',
  shrunkFontSize = '0.85rem',
  className = '',
  children,
}) {
  const [shrunk, setShrunk] = useState(false);

  useEffect(() => {
    const onScroll = () => {
      setShrunk(document.documentElement.scrollTop > shrinkThreshold);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [shrinkThreshold]);

  return (
    <div
      className={className}
      style={{
        position: 'sticky',
        top: 0,
        zIndex: 10,
        padding: shrunk ? shrunkPadding : expandedPadding,
        fontSize: shrunk ? shrunkFontSize : expandedFontSize,
        background: 'var(--panel, #1a1d2e)',
        border: '1px solid var(--line, #2d3040)',
        borderRadius: '0 0 10px 10px',
        textAlign: 'center',
        transition: 'padding 0.25s ease, font-size 0.25s ease',
      }}
    >
      {children}
    </div>
  );
}
