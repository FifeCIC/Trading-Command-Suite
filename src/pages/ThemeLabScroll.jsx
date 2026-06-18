export default function ThemeLabScroll() {
  return (
    <div className="tl-page" style={{ paddingBottom: '4rem' }}>
      <header className="tl-header">
        <h1>Scroll-Driven Animations</h1>
        <p className="tl-subtitle">
          CSS animations tied to scroll position. Parallax, reveal-on-scroll, header shrink.
          <br /><strong>Status: 🧪 Experimental</strong> — Chrome/Edge only. Must degrade gracefully on Firefox/Safari.
        </p>
      </header>

      {/* Scroll progress bar */}
      <div style={{
        position: 'fixed', top: 0, left: 0, height: 3, zIndex: 100,
        background: 'var(--accent)',
        animation: 'scroll-progress linear',
        animationTimeline: 'scroll()',
      }}>
        <style>{`@keyframes scroll-progress { from { width: 0%; } to { width: 100%; } }`}</style>
      </div>

      {/* Reveal cards */}
      <section className="tl-section">
        <h2>Reveal on Scroll</h2>
        <p className="tl-subtitle">These cards fade and slide up as you scroll into them.</p>
        <div style={{ display: 'grid', gap: '1rem' }}>
          {Array.from({ length: 8 }, (_, i) => (
            <div key={i} className="tl-scroll-reveal" style={{
              padding: '1.5rem', background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: 10,
              viewTimelineName: `--reveal-${i}`,
              animation: 'reveal 0.6s ease-out both',
              animationTimeline: `--reveal-${i}`,
              animationRange: 'entry 20% cover 40%',
            }}>
              <style>{`
                @keyframes reveal {
                  from { opacity: 0; transform: translateY(30px); }
                  to { opacity: 1; transform: translateY(0); }
                }
              `}</style>
              <h3 style={{ margin: '0 0 0.3rem', fontSize: '1rem' }}>Section {i + 1}</h3>
              <p style={{ margin: 0, fontSize: '0.78rem', color: 'var(--ink-soft)' }}>
                This card reveals itself as you scroll down. It uses <code>animation-timeline: view()</code> —
                no JavaScript required. The animation plays between "entry 20%" and "cover 40%" of the viewport.
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* Parallax demo */}
      <section className="tl-section" style={{ marginTop: '2rem' }}>
        <h2>Header Shrink (scroll-driven)</h2>
        <div style={{
          position: 'sticky', top: 0, zIndex: 10, padding: '1.5rem 1rem',
          background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: '0 0 10px 10px',
          textAlign: 'center',
          animation: 'header-shrink linear',
          animationTimeline: 'scroll()',
          animationRange: '0px 200px',
        }}>
          <style>{`
            @keyframes header-shrink {
              from { padding: 1.5rem 1rem; font-size: 1.2rem; }
              to { padding: 0.5rem 1rem; font-size: 0.85rem; }
            }
          `}</style>
          <span style={{ fontWeight: 600 }}>Scroll down to see this shrink ↑</span>
        </div>
        <div style={{ marginTop: '1rem', display: 'grid', gap: '0.75rem' }}>
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} style={{ padding: '1rem', background: 'rgba(0,0,0,0.08)', border: '1px solid var(--line)', borderRadius: 8, fontSize: '0.78rem', color: 'var(--ink-soft)' }}>
              Scroll content row {i + 1} — the sticky header above should shrink as you scroll.
            </div>
          ))}
        </div>
      </section>

      <section className="tl-section" style={{ marginTop: '2rem' }}>
        <h2>Browser Support</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: '0.5rem' }}>
          {[
            { b: 'Chrome 115+', ok: true },
            { b: 'Edge 115+', ok: true },
            { b: 'Safari', ok: false, note: 'Partial in TP' },
            { b: 'Firefox', ok: false, note: 'Not yet supported' },
          ].map((b) => (
            <div key={b.b} style={{ padding: '0.5rem 0.65rem', background: 'rgba(0,0,0,0.1)', border: `1px solid ${b.ok ? '#22c55e44' : '#f59e0b44'}`, borderRadius: 8, fontSize: '0.78rem' }}>
              <span style={{ color: b.ok ? '#22c55e' : '#f59e0b' }}>{b.ok ? '✅' : '⚠️'}</span> {b.b}
              {b.note && <div style={{ fontSize: '0.68rem', color: 'var(--ink-soft)' }}>{b.note}</div>}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
