/**
 * CenterPicker — Vertical wheel picker with center-highlight selection.
 *
 * - Items scroll vertically with CSS scroll-snap
 * - The vertically-centered item is the "active" value
 * - Fade gradient masks items at top/bottom edges
 * - Active item gets accent color + scale boost
 * - Arrow buttons navigate up/down
 * - Click or scroll to select
 *
 * Props:
 *   items        — Array of { id, label }
 *   value        — Currently selected item id
 *   onChange     — (id) => void
 *   visibleCount — Items visible in viewport (default 5)
 *   className    — Optional wrapper class
 */

import { useRef, useEffect, useState, useCallback } from 'react';
import './center-picker.css';

export default function CenterPicker({ items, value, onChange, visibleCount = 5, className = '' }) {
  const trackRef = useRef(null);
  const [activeIndex, setActiveIndex] = useState(() => items.findIndex(item => item.id === value));
  const [canUp, setCanUp] = useState(false);
  const [canDown, setCanDown] = useState(true);

  // Sync external value changes
  useEffect(() => {
    const idx = items.findIndex(item => item.id === value);
    if (idx !== -1 && idx !== activeIndex) {
      setActiveIndex(idx);
      scrollToIdx(idx);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, items]);

  const scrollToIdx = useCallback((index) => {
    const el = trackRef.current;
    if (!el) return;
    const h = el.clientHeight / visibleCount;
    el.scrollTo({ top: index * h, behavior: 'smooth' });
  }, [visibleCount]);

  const detectCenter = useCallback(() => {
    const el = trackRef.current;
    if (!el) return;
    const h = el.clientHeight / visibleCount;
    const centerY = el.scrollTop + el.clientHeight / 2;
    const idx = Math.round(centerY / h);
    const clamped = Math.max(0, Math.min(idx, items.length - 1));
    if (items[clamped] && items[clamped].id !== value) {
      setActiveIndex(clamped);
      onChange(items[clamped].id);
    }
  }, [items, value, onChange, visibleCount]);

  const updateBounds = useCallback(() => {
    const el = trackRef.current;
    if (!el) return;
    setCanUp(el.scrollTop > 4);
    setCanDown(el.scrollTop < el.scrollHeight - el.clientHeight - 4);
  }, []);

  useEffect(() => {
    const el = trackRef.current;
    if (!el) return;
    const onScroll = () => {
      updateBounds();
      clearTimeout(el._scrollTimer);
      el._scrollTimer = setTimeout(detectCenter, 100);
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    updateBounds();
    return () => el.removeEventListener('scroll', onScroll);
  }, [updateBounds, detectCenter]);

  // Scroll to active on mount
  useEffect(() => {
    if (activeIndex >= 0) scrollToIdx(activeIndex);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!items.length) return null;

  const ITEM_H = `${100 / visibleCount}%`;

  return (
    <div className={`cp-vertical ${className}`}>
      <button
        className="cp-v-arrow cp-v-up"
        onClick={() => scrollToIdx(Math.max(0, activeIndex - 1))}
        disabled={!canUp}
        aria-label="Scroll up"
      >▲</button>

      <div className="cp-v-viewport">
        <div className="cp-v-fade cp-v-fade-top" />
        <div className="cp-v-fade cp-v-fade-bot" />
        <div className="cp-v-indicator" />

        <div className="cp-v-track" ref={trackRef}>
          <div style={{ height: ITEM_H, flexShrink: 0, pointerEvents: 'none' }} />

          {items.map((item, i) => {
            const isActive = i === activeIndex;
            return (
              <div
                key={item.id}
                className={`cp-v-item ${isActive ? 'cp-v-active' : ''}`}
                style={{ height: ITEM_H }}
                onClick={() => { scrollToIdx(i); }}
                role="option"
                aria-selected={isActive}
              >
                <span className="cp-v-label">{item.label}</span>
              </div>
            );
          })}

          <div style={{ height: ITEM_H, flexShrink: 0, pointerEvents: 'none' }} />
        </div>
      </div>

      <button
        className="cp-v-arrow cp-v-down"
        onClick={() => scrollToIdx(Math.min(items.length - 1, activeIndex + 1))}
        disabled={!canDown}
        aria-label="Scroll down"
      >▼</button>
    </div>
  );
}
