import { useState } from 'react';

export default function ThemeLabTransitions() {
  const [slowMo, setSlowMo] = useState(false);

  function toggleSlowMo() {
    const next = !slowMo;
    setSlowMo(next);
    if (next) {
      document.documentElement.style.setProperty('--vt-old-duration', '0.8s');
      document.documentElement.style.setProperty('--vt-new-duration', '1s');
      document.documentElement.style.setProperty('--vt-new-delay', '0.2s');
    } else {
      document.documentElement.style.removeProperty('--vt-old-duration');
      document.documentElement.style.removeProperty('--vt-new-duration');
      document.documentElement.style.removeProperty('--vt-new-delay');
    }
  }

  return (
    <div className="tl-page">
      <header className="tl-header">
        <h1>Transitions Lab</h1>
        <p className="tl-subtitle">
          Native browser page-to-page crossfade. Enabled globally via <code>&lt;meta name="view-transition" content="same-origin" /&gt;</code>.
          <br /><strong>Status: ✅ Accepted</strong> — active on every page. No JS needed.
        </p>
      </header>

      <section className="tl-section">
        <h2>How It Works</h2>
        <div style={{ display: 'grid', gap: '0.75rem' }}>
          <div className="tl-demo-card" style={{ padding: '1rem', background: 'rgba(0,0,0,0.1)', border: '1px solid var(--line)', borderRadius: 10 }}>
            <h3 style={{ fontSize: '0.85rem', marginBottom: '0.4rem' }}>Meta Tag</h3>
            <pre style={{ fontSize: '0.7rem', color: 'var(--ink-soft)', background: 'rgba(0,0,0,0.2)', padding: '0.5rem', borderRadius: 6, margin: 0 }}>
{`<meta name="view-transition" content="same-origin" />`}
            </pre>
            <p style={{ fontSize: '0.75rem', color: 'var(--ink-soft)', marginTop: '0.4rem' }}>Added to <code>index.html</code>. This enables the View Transitions API for all same-origin navigations in the SPA.</p>
          </div>

          <div className="tl-demo-card" style={{ padding: '1rem', background: 'rgba(0,0,0,0.1)', border: '1px solid var(--line)', borderRadius: 10 }}>
            <h3 style={{ fontSize: '0.85rem', marginBottom: '0.4rem' }}>CSS Animation</h3>
            <pre style={{ fontSize: '0.7rem', color: 'var(--ink-soft)', background: 'rgba(0,0,0,0.2)', padding: '0.5rem', borderRadius: 6, margin: 0 }}>
{`::view-transition-old(root) {
  animation: 0.2s ease-out both fade-out;
}
::view-transition-new(root) {
  animation: 0.25s ease-out 0.05s both fade-in;
}`}
            </pre>
            <p style={{ fontSize: '0.75rem', color: 'var(--ink-soft)', marginTop: '0.4rem' }}>Defined in <code>index.css</code>. The old page fades out over 200ms, the new page fades in with a 50ms delay. Result: a smooth crossfade on every navigation.</p>
          </div>
        </div>
      </section>

      <section className="tl-section">
        <h2>Real-World Usage</h2>
        <p className="tl-subtitle">The View Transitions API is enabled globally in the Trading Command Suite. Every page-to-page navigation — sidebar clicks, quick menu jumps, breadcrumb links — triggers a smooth 200ms crossfade automatically. No per-page code required.</p>
        <div className="tl-demo-card" style={{ padding: '1rem', background: 'rgba(0,0,0,0.1)', border: '1px solid var(--line)', borderRadius: 10 }}>
          <h3 style={{ fontSize: '0.85rem', marginBottom: '0.4rem' }}>Where It's Active</h3>
          <ul style={{ fontSize: '0.78rem', color: 'var(--ink-soft)', margin: 0, paddingLeft: '1.2rem', display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
            <li>All 12 top-level areas (Trading → Settings)</li>
            <li>100+ view-to-view navigations</li>
            <li>Quick menu header jumps</li>
            <li>Footer area links</li>
            <li>External links open without transition (same-origin only)</li>
          </ul>
        </div>
      </section>

      <section className="tl-section">
        <h2>Test It</h2>
        <p className="tl-subtitle">Click any sidebar item or quick-menu button. Notice the crossfade between pages. The effect is automatic — every route change triggers it.</p>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center', marginBottom: '1rem' }}>
          <button
            onClick={toggleSlowMo}
            style={{
              padding: '0.5rem 1rem',
              fontSize: '0.82rem',
              background: slowMo ? 'rgba(245,158,11,0.2)' : 'rgba(14,165,166,0.12)',
              border: `1px solid ${slowMo ? '#f59e0b' : 'var(--accent)'}`,
              borderRadius: 6,
              color: slowMo ? '#f59e0b' : 'var(--accent)',
              cursor: 'pointer',
              fontFamily: 'inherit',
            }}
          >
            {slowMo ? '🐢 Slow-Mo ON (0.8s/1s)' : '▶ Normal Speed (0.2s/0.25s)'}
          </button>
          {slowMo && <span style={{ fontSize: '0.75rem', color: '#f59e0b' }}>Transitions slowed for observation — click test links below</span>}
        </div>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          {['analysis/support-resistance', 'research/news-intel', 'trading/portfolio-overview', 'lab/theme-lab'].map((path) => (
            <a key={path} href={`/${path}`} style={{ padding: '0.4rem 0.75rem', fontSize: '0.78rem', background: 'rgba(14,165,166,0.12)', border: '1px solid var(--accent)', borderRadius: 6, color: 'var(--accent)', textDecoration: 'none' }}>
              /{path}
            </a>
          ))}
        </div>
      </section>

      <section className="tl-section">
        <h2>Browser Support</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: '0.5rem' }}>
          {[
            { b: 'Chrome 111+', ok: true },
            { b: 'Edge 111+', ok: true },
            { b: 'Safari 18+', ok: true },
            { b: 'Firefox 130+', ok: true },
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
