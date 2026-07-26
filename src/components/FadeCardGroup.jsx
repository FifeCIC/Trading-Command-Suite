import { useEffect, useRef } from 'react';
import './fade-card-group.css';

/**
 * Shared fade-card group — reusable across Theme Lab, MetaStack Explorer, etc.
 *
 * @param {Object[]} cards — [{ label, desc, color, extra? }]
 * @param {string} variant — space-separated combination of:
 *   "hover"        — individual cards light up on mouse hover
 *   "scroll"       — the whole group lights up when it crosses screen center
 *   "scroll-each"  — each card lights up individually as it crosses screen center
 *   Examples: "hover", "scroll", "scroll-each", "hover scroll", "hover scroll-each"
 */
export default function FadeCardGroup({ cards, variant = 'hover', maxWidth }) {
  const groupRef = useRef(null);
  const variants = new Set(variant.split(/\s+/).filter(Boolean));
  const hasHover = variants.has('hover');
  const hasScrollGroup = variants.has('scroll');
  const hasScrollEach = variants.has('scroll-each');
  const isHoverOnly = hasHover && !hasScrollGroup && !hasScrollEach;

  // ── Whole-group scroll-center observer ──
  useEffect(() => {
    if (!hasScrollGroup || !groupRef.current) return;
    const el = groupRef.current;
    const obs = new IntersectionObserver(
      ([entry]) => {
        el.classList.toggle('fc-centered', entry.isIntersecting);
      },
      { rootMargin: '-46% 0px -46% 0px', threshold: 0 },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [hasScrollGroup]);

  // ── Per-card scroll-center observer ──
  useEffect(() => {
    if (!hasScrollEach || !groupRef.current) return;
    const obs = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          entry.target.classList.toggle('fc-card-centered', entry.isIntersecting);
        }
      },
      { rootMargin: '-46% 0px -46% 0px', threshold: 0 },
    );
    groupRef.current.querySelectorAll('.fc-card').forEach(el => obs.observe(el));
    return () => obs.disconnect();
  }, [hasScrollEach, cards]);

  return (
    <div
      ref={groupRef}
      className={`fc-group${hasScrollGroup ? ' fc-scroll' : ''}${isHoverOnly ? ' fc-hover-only' : ''}`}
      style={maxWidth ? { maxWidth } : undefined}
    >
      {cards.map((card, i) => (
        <div
          key={i}
          className="fc-card"
          style={{ '--fc-color': card.color }}
        >
          <div className="fc-head">
            <span className="fc-label">{card.label}</span>
          </div>
          <p className="fc-desc">{card.desc}</p>
          {card.extra && <div className="fc-extra">{card.extra}</div>}
        </div>
      ))}
    </div>
  );
}
