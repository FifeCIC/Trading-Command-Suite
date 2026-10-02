import { useState, useEffect, useRef } from 'react';
import StickyHeader from '../components/StickyHeader';

/** Reveal-on-scroll card — uses IntersectionObserver for reliable cross-browser support */
function RevealCard({ index }) {
  const ref = useRef(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) { setVisible(true); obs.unobserve(el); }
    }, { threshold: 0.15, rootMargin: '0px 0px -40px 0px' });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);
  return (
    <div ref={ref} className="tl-scroll-reveal" style={{
      padding: '1.5rem', background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: 10,
      opacity: visible ? 1 : 0, transform: visible ? 'translateY(0)' : 'translateY(30px)',
      transition: 'opacity 0.5s ease-out, transform 0.5s ease-out',
    }}>
      <h3 style={{ margin: '0 0 0.3rem', fontSize: '1rem' }}>Section {index + 1}</h3>
      <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--ink-soft)' }}>
        This card reveals itself as you scroll down. Uses <code>IntersectionObserver</code> —
        reliable across all modern browsers. Fires when 15% visible.
      </p>
    </div>
  );
}

/**
 * ScrollLabSection — the Scroll Animations examples, rendered INSIDE Theme Lab.
 *
 * ⚠️ Was `ThemeLabScroll`, a PAGE at /development/theme-lab-scroll until 2026-10-01; the owner
 * deleted the view and asked for its examples to move here. Exported as a SECTION: no `tl-page`
 * wrapper, no `<h1>`. The progress bar below is `position: fixed` and stays that way — it was
 * viewport-wide on its own page too.
 */
export default function ScrollLabSection() {
  const [scrollPct, setScrollPct] = useState(0);

  useEffect(() => {
    const onScroll = () => {
      const h = document.documentElement;
      const pct = h.scrollTop / Math.max(1, h.scrollHeight - h.clientHeight) * 100;
      setScrollPct(pct);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <section className="tl-section" style={{ paddingBottom: '2rem' }}>
      <h2>Scroll-Driven Animations</h2>
      <p className="tl-subtitle">
        CSS + JavaScript animations tied to scroll position. Parallax, reveal-on-scroll, header shrink.
        <br /><strong>Status: ✅ Stable</strong> — Uses IntersectionObserver + scroll events. Works in all modern browsers.
        <br /><span style={{ fontSize: '0.82rem', color: 'var(--ink-soft)' }}>Used in: Strategy Builder protocol cards, Architecture Framework section reveals.</span>
      </p>

      {/* Scroll progress bar */}
      <div style={{
        position: 'fixed', top: 0, left: 0, height: 3, zIndex: 100,
        width: `${scrollPct}%`, background: 'var(--accent)',
        transition: 'width 0.1s linear',
      }} />

      {/* Reveal cards */}
      <section className="tl-section">
        <h2>Reveal on Scroll</h2>
        <p className="tl-subtitle">These cards fade and slide up as you scroll into them.</p>
        <div style={{ display: 'grid', gap: '1rem' }}>
          {Array.from({ length: 8 }, (_, i) => (
            <RevealCard key={i} index={i} />
          ))}
        </div>
      </section>

      {/* Parallax demo */}
      <section className="tl-section" style={{ marginTop: '2rem' }}>
        <h2>Header Shrink (scroll-driven)</h2>
        <StickyHeader>
          <span style={{ fontWeight: 600 }}>Scroll down to see this shrink ↑</span>
        </StickyHeader>
        <div style={{ marginTop: '1rem', display: 'grid', gap: '0.75rem' }}>
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} style={{ padding: '1rem', background: 'rgba(0,0,0,0.08)', border: '1px solid var(--line)', borderRadius: 8, fontSize: '0.85rem', color: 'var(--ink-soft)' }}>
              Scroll content row {i + 1} — the sticky header above shrinks after 80px of scroll.
            </div>
          ))}
        </div>
      </section>

      <section className="tl-section" style={{ marginTop: '2rem' }}>
        <h2>Browser Support</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: '0.5rem' }}>
          {[
            { b: 'Chrome', ok: true },
            { b: 'Edge', ok: true },
            { b: 'Safari', ok: true },
            { b: 'Firefox', ok: true },
          ].map((b) => (
            <div key={b.b} style={{ padding: '0.5rem 0.65rem', background: 'rgba(0,0,0,0.1)', border: `1px solid ${b.ok ? '#22c55e44' : '#f59e0b44'}`, borderRadius: 8, fontSize: '0.85rem' }}>
              <span style={{ color: b.ok ? '#22c55e' : '#f59e0b' }}>{b.ok ? '✅' : '⚠️'}</span> {b.b}
            </div>
          ))}
        </div>
        <p style={{ fontSize: '0.82rem', color: 'var(--ink-soft)', marginTop: '0.75rem' }}>
          Now uses <strong>IntersectionObserver</strong> + scroll events instead of CSS <code>animation-timeline: scroll()</code>.
          This provides reliable cross-browser support without experimental features.
        </p>
      </section>
    </section>
  );
}
