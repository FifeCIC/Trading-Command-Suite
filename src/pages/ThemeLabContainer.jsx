export default function ThemeLabContainer() {
  return (
    <div className="tl-page">
      <header className="tl-header">
        <h1>Container Queries</h1>
        <p className="tl-subtitle">
          Components that respond to their <strong>own size</strong>, not the viewport. Ideal for DetachableWidgets.
          <br /><strong>Status: 🧪 Experimental</strong> — test on target browsers before promoting.
        </p>
      </header>

      <section className="tl-section">
        <h2>Demo: Resize Me</h2>
        <p className="tl-subtitle">Drag the resize handle on the card below. The layout inside changes at 400px and 600px breakpoints.</p>

        <div style={{
          containerType: 'inline-size', containerName: 'cq-demo',
          width: '100%', maxWidth: '700px', minWidth: '250px', resize: 'horizontal', overflow: 'auto',
          padding: '1rem', background: 'rgba(0,0,0,0.1)', border: '1px solid var(--line)', borderRadius: 10,
        }}>
          <div style={{ fontSize: '0.7rem', color: 'var(--ink-soft)', marginBottom: '0.5rem' }}>↔ Drag bottom-right corner to resize</div>
          <div className="cq-demo-inner" style={{
            display: 'grid', gap: '0.5rem',
          }}>
            <style>{`
              @container cq-demo (max-width: 400px) {
                .cq-demo-inner { grid-template-columns: 1fr; }
                .cq-card { font-size: 0.72rem; padding: 0.4rem 0.5rem; }
                .cq-card .cq-card-title { font-size: 0.75rem; }
                .cq-card .cq-card-meta { display: none; }
              }
              @container cq-demo (min-width: 401px) and (max-width: 600px) {
                .cq-demo-inner { grid-template-columns: 1fr 1fr; }
                .cq-card { font-size: 0.78rem; padding: 0.6rem 0.75rem; }
                .cq-card .cq-card-title { font-size: 0.82rem; }
                .cq-card .cq-card-meta { display: block; font-size: 0.65rem; }
              }
              @container cq-demo (min-width: 601px) {
                .cq-demo-inner { grid-template-columns: 1fr 1fr 1fr; }
                .cq-card { font-size: 0.82rem; padding: 0.75rem 1rem; }
                .cq-card .cq-card-title { font-size: 0.88rem; }
                .cq-card .cq-card-meta { display: block; font-size: 0.68rem; }
              }
            `}</style>
            {['AAPL $198.32', 'NVDA $129.14', 'TSLA $227.91', 'MSFT $462.75', 'AMD $94.12', 'SPY $548.20'].map((s) => {
              const [sym, price] = s.split(' ');
              return (
                <div key={sym} className="cq-card" style={{
                  background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: 8, display: 'flex', flexDirection: 'column', gap: '0.15rem',
                }}>
                  <span className="cq-card-title" style={{ fontWeight: 600 }}>{sym}</span>
                  <span style={{ fontFamily: 'monospace', color: 'var(--accent)' }}>{price}</span>
                  <span className="cq-card-meta" style={{ color: 'var(--ink-soft)' }}>Vol: {Math.floor(Math.random() * 9e6).toLocaleString()}</span>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      <section className="tl-section">
        <h2>CSS Pattern</h2>
        <pre style={{ fontSize: '0.7rem', color: 'var(--ink-soft)', background: 'rgba(0,0,0,0.2)', padding: '0.75rem', borderRadius: 8, overflow: 'auto', margin: 0 }}>
{`/* 1. Define a containment context */
.widget-grid {
  container-type: inline-size;
  container-name: widget-grid;
}

/* 2. Query the container, not the viewport */
@container widget-grid (max-width: 400px) {
  .widget-card { grid-template-columns: 1fr; font-size: 0.75rem; }
}
@container widget-grid (min-width: 601px) {
  .widget-card { grid-template-columns: 1fr 1fr 1fr; font-size: 0.85rem; }
}`}
        </pre>
      </section>
    </div>
  );
}
