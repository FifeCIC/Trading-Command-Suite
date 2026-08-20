import PageInfoPopover from '../components/PageInfoPopover';

export default function ThemeLabPopover() {
  return (
    <div className="tl-page">
      <header className="tl-header">
        <h1>Popover API
          <PageInfoPopover>
            Native browser popovers — no JS needed for show/hide. Light dismiss, focus management, anchor positioning built in.
          Status: 🧪 Experimental — Chrome/Edge only. Requires polyfill for Firefox/Safari.
          </PageInfoPopover>
        </h1>
      </header>

      <section className="tl-section">
        <h2>Basic Popover</h2>
        <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'center' }}>
          <button popovertarget="pop1" style={{ padding: '0.5rem 1rem', background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: '0.82rem' }}>
            Toggle Popover
          </button>
          <div id="pop1" popover="auto" style={{
            padding: '1rem', background: 'var(--panel)', border: '1px solid var(--accent)', borderRadius: 10,
            color: 'var(--ink)', fontSize: '0.82rem', maxWidth: 280,
          }}>
            <h3 style={{ margin: '0 0 0.4rem', fontSize: '0.9rem' }}>Native Popover</h3>
            <p style={{ margin: 0, color: 'var(--ink-soft)', fontSize: '0.75rem' }}>
              This popover uses the Popover API. Click outside to dismiss. Click the button again to toggle.
              No JavaScript required — just <code>popover="auto"</code> and <code>popoverTarget</code>.
            </p>
          </div>
          <div id="pop2" popover="auto" style={{
            padding: '1rem', background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: 10,
            color: 'var(--ink)', fontSize: '0.82rem', maxWidth: 240,
          }}>
            <p style={{ margin: 0 }}>Tooltip-style popover. Light-dismiss on outside click or Escape.</p>
          </div>
          <button popovertarget="pop2" style={{ padding: '0.5rem 1rem', background: 'rgba(255,255,255,0.06)', border: '1px solid var(--line)', borderRadius: 8, cursor: 'pointer', color: 'var(--ink)', fontSize: '0.82rem' }}>
            Tooltip
          </button>
        </div>
      </section>

      <section className="tl-section">
        <h2>Anchor Positioning</h2>
        <p className="tl-subtitle">CSS anchor positioning lets you pin a popover relative to its triggering element.</p>
        <div style={{ position: 'relative', height: 200, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <style>{`
            #anchor-btn { anchor-name: --anchor-el; }
            #anchor-pop { 
              position-anchor: --anchor-el;
              top: anchor(bottom);
              left: anchor(left);
            }
          `}</style>
          <button id="anchor-btn" popovertarget="anchor-pop" style={{
            padding: '0.5rem 1.5rem', background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: '0.9rem',
          }}>
            Anchored Popover
          </button>
          <div id="anchor-pop" popover="auto" style={{
            padding: '0.75rem', background: 'var(--panel)', border: '1px solid var(--accent)', borderRadius: 8,
            color: 'var(--ink)', fontSize: '0.78rem',
          }}>
            Anchored below the button ↑
          </div>
        </div>
      </section>

      <section className="tl-section">
        <h2>HTML Pattern</h2>
        <pre style={{ fontSize: '0.7rem', color: 'var(--ink-soft)', background: 'rgba(0,0,0,0.2)', padding: '0.75rem', borderRadius: 8, overflow: 'auto', margin: 0 }}>
{`<!-- Trigger -->
<button popoverTarget="my-popover">Open</button>

<!-- Popover (placed anywhere in DOM) -->
<div id="my-popover" popover="auto">
  Content here — light-dismiss on outside click or Escape
</div>

<!-- Manual (no light dismiss) -->
<div id="my-manual" popover="manual">
  Must be closed programmatically
</div>`}
        </pre>
      </section>

      <section className="tl-section">
        <h2>Browser Support</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: '0.5rem' }}>
          {[
            { b: 'Chrome 114+', ok: true },
            { b: 'Edge 114+', ok: true },
            { b: 'Safari 17+', ok: false, note: 'Anchor only, no popover' },
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
