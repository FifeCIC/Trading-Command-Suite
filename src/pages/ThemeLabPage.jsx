import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import FadeCardGroup from '../components/FadeCardGroup';
import './theme-lab.css';

const LAB_SECTIONS = [
  { id: 'theme-lab-motion', label: 'Motion Lab', desc: 'Animation library examples — enter/exit, hover, layout, gestures', icon: '◆' },
  { id: 'theme-lab-transitions', label: 'Transitions Lab', desc: 'Page-to-page crossfade via View Transitions API', icon: '⇢' },
  { id: 'theme-lab-scroll', label: 'Scroll Animations', desc: 'Scroll-driven effects — parallax, reveal, header shrink', icon: '⇣' },
  { id: 'theme-lab-popover', label: 'Popover API', desc: 'Native browser popovers — tooltips, menus, dialogs. In Development area.', icon: '◉' },
];

// ── Shade presets from the task spec ────────────────────────
const SHADE_PRESETS = [
  { label: 'Base Page', bg: '#0a0f1a', text: '#e2e8f0' },
  { label: 'Cards', bg: '#141a2e', text: '#e2e8f0' },
  { label: 'Active Cards', bg: '#1a2240', text: '#e2e8f0' },
  { label: 'Headers', bg: '#0f1525', text: '#cbd5e1' },
  { label: 'Deep Panel', bg: '#0d1321', text: '#94a3b8' },
];

const TEXT_SAMPLES = [
  { label: 'Body Text (#e2e8f0)', color: '#e2e8f0', text: 'The quick brown fox jumps over the lazy dog. Market data streams in real time.' },
  { label: 'Soft Text (#cbd5e1)', color: '#cbd5e1', text: 'Secondary information, labels, and supporting context for data tables.' },
  { label: 'Muted Text (#94a3b8)', color: '#94a3b8', text: 'Subtle hints, timestamps, and low-priority metadata throughout the interface.' },
  { label: 'Accent (#0ea5a6)', color: '#0ea5a6', text: 'Interactive elements, links, and highlighted values draw attention here.' },
  { label: 'Warning (#f59e0b)', color: '#f59e0b', text: '⚠ Alerts, warnings, and threshold-breach indicators use amber tones.' },
  { label: 'Danger (#ef4444)', color: '#ef4444', text: '❌ Errors, stops, and critical risk values use red for urgency.' },
];

const CARD_SHADES = [
  { bg: '#141a2e', border: '#1e2a45' },
  { bg: '#111827', border: '#1f2937' },
  { bg: '#0f172a', border: '#1e293b' },
  { bg: '#1a2240', border: '#2a3560' },
];

const TABLE_ROWS = [
  { symbol: 'AAPL', price: 198.32, change: +2.4, signal: 'BUY' },
  { symbol: 'TSLA', price: 227.91, change: -3.1, signal: 'SELL' },
  { symbol: 'NVDA', price: 129.14, change: +5.8, signal: 'BUY' },
  { symbol: 'MSFT', price: 462.75, change: +0.9, signal: 'HOLD' },
];

const FORM_STANDARD_CLASSES = [
  '.app-form           /* Form container - sets field gap */',
  '.app-form-row       /* Responsive row: 2-col -> 1-col on mobile */',
  '.app-field          /* Field group: label + input + hint/error */',
  '.app-field--error   /* Error state - red border + error text */',
  '.app-field--success /* Success state - green indicator */',
  '.app-field-label    /* Label - uppercase, spaced from input */',
  '.app-field-input    /* Input/select/textarea - unified sizing */',
  '.app-field-textarea /* Textarea variant - resizable vertical */',
  '.app-field-hint     /* Hint/description below field */',
  '.app-field-error    /* Error message below field */',
  '.app-form-actions   /* Button row - right-aligned, gap */',
  '.app-btn            /* Base button */',
  '.app-btn-primary    /* Primary action button */',
  '.app-btn-secondary  /* Secondary/cancel button */',
].join('\n');

const FADE_CARDS = [
  { label: 'Technical Analysis', desc: 'Price action, momentum, patterns, volume — weighted at 0.40 in group-weighted mode.', color: '#3b82f6' },
  { label: 'Sentiment & Fundamentals', desc: 'Analyst consensus, news, earnings, social — weighted at 0.35.', color: '#f59e0b' },
  { label: 'Risk & Structural', desc: 'Correlation, dilution, concentration, volatility, liquidity — multiplier on composite.', color: '#22c55e' },
  { label: 'Risk Controls', desc: 'Stop-loss triggers, drawdown limits, exposure caps — hard gates that veto trades.', color: '#ef4444' },
];

export default function ThemeLabPage() {
  const [activeBg, setActiveBg] = useState(null);
  const navigate = useNavigate();

  return (
    <div className="tl-page">
      <header className="tl-header">
        <h1>Theme Lab</h1>
        <p className="tl-subtitle">
          Sandbox for exploring UI technologies. <strong>Experimental features live here.</strong>
          Changes are not applied globally — see <code>.github/instructions/ui-standards.instructions.md</code> for what's accepted vs experimental.
        </p>
      </header>

      {/* ── Lab Sections Hub ─────────────────────────────── */}
      <section className="tl-section">
        <h2>Lab Sections</h2>
        <div className="tl-lab-grid">
          {LAB_SECTIONS.map((s) => (
            <button
              key={s.id}
              type="button"
              className="tl-lab-card"
              onClick={() => navigate(`/lab/${s.id}`)}
            >
              <span className="tl-lab-icon">{s.icon}</span>
              <div className="tl-lab-info">
                <strong>{s.label}</strong>
                <span>{s.desc}</span>
              </div>
              <span className="tl-lab-arrow">→</span>
            </button>
          ))}
        </div>
      </section>

      {/* ── Best Practices ─────────────────────────────────── */}
      <section className="tl-section">
        <h2>Dark Mode Best Practices</h2>
        <div className="tl-principles">
          <div className="tl-principle">
            <strong>Avoid pure black (#000000)</strong>
            <p>Use dark greys like #0f172a or #1a1f2e. Pure black causes eye strain at high contrast against white text.</p>
          </div>
          <div className="tl-principle">
            <strong>Reduce text contrast</strong>
            <p>Body text should not be pure white. Use #e2e8f0 or #cbd5e1. Reserve pure white for headings only.</p>
          </div>
          <div className="tl-principle">
            <strong>Desaturate accents</strong>
            <p>Bright saturated colors vibrate against dark backgrounds. Mute them slightly for readability.</p>
          </div>
          <div className="tl-principle">
            <strong>Use borders over contrast</strong>
            <p>Separate panels with subtle borders (1px solid rgba(255,255,255,0.06)) rather than relying on background contrast alone.</p>
          </div>
        </div>
      </section>

      {/* ── Panel Shading ───────────────────────────────────── */}
      <section className="tl-section">
        <h2>Panel Shading</h2>
        <p className="tl-hint">Click a shade to preview it as the content area background.</p>
        <div className="tl-shade-grid">
          {SHADE_PRESETS.map((s) => (
            <button
              key={s.label}
              type="button"
              className={`tl-shade-card ${activeBg === s.label ? 'tl-active' : ''}`}
              style={{ background: s.bg, color: s.text }}
              onClick={() => setActiveBg(activeBg === s.label ? null : s.label)}
            >
              <div className="tl-shade-swatch" style={{ background: s.bg, border: '1px solid rgba(255,255,255,0.08)' }} />
              <div className="tl-shade-info">
                <strong>{s.label}</strong>
                <code>{s.bg}</code>
              </div>
            </button>
          ))}
        </div>
      </section>

      {/* ── Text Contrast ───────────────────────────────────── */}
      <section className="tl-section">
        <h2>Text Contrast Levels</h2>
        <div className="tl-text-grid">
          {TEXT_SAMPLES.map((s) => (
            <div key={s.label} className="tl-text-card">
              <div className="tl-text-swatch" style={{ color: s.color }}>
                <p style={{ color: s.color }}>{s.text}</p>
              </div>
              <div className="tl-text-label">
                <strong>{s.label}</strong>
                <code>{s.color}</code>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ── Card Variants ───────────────────────────────────── */}
      <section className="tl-section">
        <h2>Card Background Variants</h2>
        <div className="tl-card-grid">
          {CARD_SHADES.map((c, i) => (
            <div key={i} className="tl-sample-card" style={{ background: c.bg, borderColor: c.border }}>
              <div className="tl-card-header" style={{ borderBottomColor: c.border }}>
                <h3>Card {i + 1}</h3>
                <code>{c.bg}</code>
              </div>
              <p style={{ color: '#e2e8f0' }}>This card uses a dark background with a subtle border. Cards should feel distinct from the page but not starkly separated.</p>
              <div className="tl-card-meta" style={{ color: '#94a3b8' }}>
                <span>Border: {c.border}</span>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ── Neon Border Card Variants ────────────────────────── */}
      <section className="tl-section">
        <h2>Neon Border Card Variants</h2>
        <p className="tl-hint">Glowing borders for highlighting cards — success, warning, danger, and info variants.</p>
        <div className="tl-card-grid">
          {[
            { label: 'Success Glow', bg: '#141a2e', glow: 'rgba(34,197,94,0.5)', border: 'rgba(34,197,94,0.6)', desc: 'Positive confirmation, profit targets hit, or trade wins.' },
            { label: 'Warning Glow', bg: '#141a2e', glow: 'rgba(245,158,11,0.5)', border: 'rgba(245,158,11,0.6)', desc: 'Attention needed, approaching limits, or pending actions.' },
            { label: 'Danger Glow', bg: '#141a2e', glow: 'rgba(239,68,68,0.5)', border: 'rgba(239,68,68,0.6)', desc: 'Stop-loss triggered, critical risk, or system failure.' },
            { label: 'Info Glow', bg: '#141a2e', glow: 'rgba(59,130,246,0.5)', border: 'rgba(59,130,246,0.6)', desc: 'New data available, insights ready, or informational highlight.' },
          ].map((n, i) => (
            <div
              key={i}
              className="tl-sample-card tl-neon-card"
              style={{
                background: n.bg,
                borderColor: n.border,
                boxShadow: `0 0 16px ${n.glow}, inset 0 0 8px ${n.glow.replace('0.5', '0.08')}`,
              }}
            >
              <div className="tl-card-header" style={{ borderBottomColor: n.border }}>
                <h3>{n.label}</h3>
              </div>
              <p style={{ color: '#e2e8f0', fontSize: '0.88rem' }}>{n.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── Fade-on-Hover Stack ──────────────────────────────── */}
      <section className="tl-section">
        <h2>Fade-on-Hover Card Stack</h2>
        <p className="tl-hint">
          Cards that start muted and reveal their full colour on hover — tones down busy multi-card stacks.
          Uses the shared <code>&lt;FadeCardGroup variant="hover"&gt;</code> component.
        </p>
        <FadeCardGroup cards={FADE_CARDS} variant="hover" />
      </section>

      {/* ── Fade-on-Scroll Stack ─────────────────────────────── */}
      <section className="tl-section">
        <h2>Fade-on-Scroll Card Stack</h2>
        <p className="tl-hint">
          Same component with <code>variant="scroll"</code> — cards also reveal when the group
          reaches the vertical centre of the viewport. Scroll to see the effect.
        </p>
        <FadeCardGroup cards={FADE_CARDS} variant="scroll" />
      </section>

      {/* ── Fade-on-Scroll (one at a time) ────────────────────── */}
      <section className="tl-section">
        <h2>Fade-on-Scroll — One Card at a Time</h2>
        <p className="tl-hint">
          <code>variant="scroll-each"</code> — each card lights up individually as it crosses the
          screen centre line. Only one card is highlighted at a time.
        </p>
        <FadeCardGroup cards={FADE_CARDS} variant="scroll-each" />
      </section>
      <section className="tl-section">
        <h2>Pulsing Header Card</h2>
        <p className="tl-hint">A card with a pulsing header — useful for indicating active problems or live-updating status.</p>
        <div className="tl-card-grid">
          {[
            { label: 'Critical Alert', bg: '#1a1420', border: 'rgba(239,68,68,0.4)', pulse: 'tl-pulse-red', desc: '2 positions need attention — stop-loss levels breached on TSLA and NVDA.' },
            { label: 'Live Updating', bg: '#141a20', border: 'rgba(59,130,246,0.4)', pulse: 'tl-pulse-blue', desc: 'Market data streaming — 47 symbols updating in real time.' },
            { label: 'Pending Action', bg: '#1a1a14', border: 'rgba(245,158,11,0.4)', pulse: 'tl-pulse-amber', desc: 'Earnings report due tomorrow — review positions in AAPL and MSFT.' },
          ].map((p, i) => (
            <div
              key={i}
              className="tl-sample-card"
              style={{ background: p.bg, borderColor: p.border }}
            >
              <div className={`tl-pulse-header ${p.pulse}`} style={{ borderBottomColor: p.border }}>
                <h3>{p.label}</h3>
              </div>
              <p style={{ color: '#e2e8f0', fontSize: '0.88rem' }}>{p.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── Table at Different Shades ───────────────────────── */}
      <section className="tl-section">
        <h2>Table at Different Shade Levels</h2>
        <div className="tl-table-wrap">
          <table className="ds-table">
            <thead>
              <tr>
                <th>Symbol</th>
                <th>Price</th>
                <th>Change</th>
                <th>Signal</th>
              </tr>
            </thead>
            <tbody>
              {TABLE_ROWS.map((r) => (
                <tr key={r.symbol}>
                  <td><strong>{r.symbol}</strong></td>
                  <td>${r.price.toFixed(2)}</td>
                  <td className={r.change >= 0 ? 'pf-green' : 'pf-red'}>
                    {r.change >= 0 ? '+' : ''}{r.change}%
                  </td>
                  <td>
                    <span className={`al-signal al-signal-${r.signal.toLowerCase()}`}>
                      {r.signal}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* ── Active Preview ──────────────────────────────────── */}
      {activeBg && (
        <section className="tl-section">
          <h2>Active Preview: {activeBg}</h2>
          <div className="tl-preview" style={{ background: SHADE_PRESETS.find((s) => s.label === activeBg)?.bg }}>
            <p style={{ color: SHADE_PRESETS.find((s) => s.label === activeBg)?.text }}>
              This is how content looks on {activeBg}. Body text should remain readable at this shade level.
              Cards and interactive elements should appear slightly elevated from this background.
            </p>
            <button className="pf-refresh-btn" style={{ marginTop: '0.5rem' }}>
              Sample Button
            </button>
          </div>
        </section>
      )}

      {/* ── Form Standard ──────────────────────────────────── */}
      <section className="tl-section">
        <h2>Form Standard</h2>
        <p className="tl-hint">
          Reusable form pattern for consistent spacing, field sizing, error states, and responsive layout.
          Apply <code>.app-form</code> to any form container, <code>.app-field</code> to each field group.
        </p>

        <div className="tl-form-demos">
          {/* Single-column demo */}
          <div className="tl-form-demo">
            <h3>Single Column</h3>
            <div className="app-form">
              <div className="app-field">
                <label className="app-field-label">Strategy Name</label>
                <input type="text" className="app-field-input" placeholder="e.g., Tech Dip Accumulation" defaultValue="" />
                <span className="app-field-hint">Give your strategy a descriptive name.</span>
              </div>
              <div className="app-field">
                <label className="app-field-label">Watchlist</label>
                <select className="app-field-input">
                  <option value="">— Select a watchlist —</option>
                  <option>Momentum Stocks</option>
                  <option>Primary</option>
                </select>
                <span className="app-field-hint">Symbols will come from the selected watchlist.</span>
              </div>
              <div className="app-field">
                <label className="app-field-label">Description</label>
                <textarea className="app-field-input app-field-textarea" placeholder="What does this strategy aim to do?" rows={2} />
              </div>
            </div>
          </div>

          {/* Two-column demo */}
          <div className="tl-form-demo">
            <h3>Two Column (responsive)</h3>
            <div className="app-form">
              <div className="app-form-row">
                <div className="app-field">
                  <label className="app-field-label">Min Score</label>
                  <input type="number" className="app-field-input" placeholder="25" />
                  <span className="app-field-hint">Composite score threshold (0-100).</span>
                </div>
                <div className="app-field">
                  <label className="app-field-label">Max Positions</label>
                  <input type="number" className="app-field-input" placeholder="5" />
                  <span className="app-field-hint">Maximum concurrent positions.</span>
                </div>
              </div>
              <div className="app-form-row">
                <div className="app-field">
                  <label className="app-field-label">Stop Loss %</label>
                  <input type="number" className="app-field-input" placeholder="2.0" step="0.1" />
                </div>
                <div className="app-field">
                  <label className="app-field-label">Take Profit %</label>
                  <input type="number" className="app-field-input" placeholder="5.0" step="0.1" />
                </div>
              </div>
            </div>
          </div>

          {/* Error states demo */}
          <div className="tl-form-demo">
            <h3>Error &amp; Disabled States</h3>
            <div className="app-form">
              <div className="app-field app-field--error">
                <label className="app-field-label">Ticker Symbol</label>
                <input type="text" className="app-field-input" defaultValue="INVALID!" />
                <span className="app-field-error">Symbol not found. Check the ticker and try again.</span>
              </div>
              <div className="app-field">
                <label className="app-field-label">Exchange</label>
                <select className="app-field-input" disabled>
                  <option>NASDAQ</option>
                </select>
                <span className="app-field-hint">Exchange selection is locked for this symbol.</span>
              </div>
              <div className="app-field app-field--success">
                <label className="app-field-label">Protocol</label>
                <select className="app-field-input" defaultValue="built-in">
                  <option>built-in</option>
                  <option>custom</option>
                </select>
                <span className="app-field-hint" style={{ color: '#22c55e' }}>✓ Protocol is valid and ready to use.</span>
              </div>
              <div className="app-form-actions">
                <button type="button" className="app-btn app-btn-primary">Save Strategy</button>
                <button type="button" className="app-btn app-btn-secondary">Cancel</button>
              </div>
            </div>
          </div>
        </div>

        {/* CSS snippet reference */}
        <details className="tl-code-block" style={{ marginTop: '1.5rem' }}>
          <summary>CSS Classes Reference</summary>
          <pre className="tl-pre">{FORM_STANDARD_CLASSES}</pre>
        </details>
      </section>

      {/* ── Container Queries Demo ─────────────────────────── */}
      <section className="tl-section" id="container-queries">
        <h2>⊡ Container Queries</h2>
        <p className="tl-subtitle">
          Components that respond to their <strong>own size</strong>, not the viewport. Universally supported (Chrome 105+, Safari 16+, Firefox 110+).
          Use with <code>@supports (container-type: inline-size)</code> fallback for older browsers.
        </p>

        <h3 style={{ fontSize: '0.85rem', margin: '1rem 0 0.5rem' }}>Resize Demo</h3>
        <p style={{ fontSize: '0.75rem', color: 'var(--ink-soft)' }}>Drag the bottom-right corner. Layout changes at 400px and 600px.</p>

        <div style={{
          containerType: 'inline-size', containerName: 'cq-demo',
          width: '100%', maxWidth: '700px', minWidth: '250px', resize: 'horizontal', overflow: 'auto',
          padding: '1rem', background: 'rgba(0,0,0,0.1)', border: '1px solid var(--line)', borderRadius: 10,
        }}>
          <div style={{ fontSize: '0.7rem', color: 'var(--ink-soft)', marginBottom: '0.5rem' }}>↔ Drag bottom-right corner</div>
          <div className="cq-demo-inner" style={{ display: 'grid', gap: '0.5rem' }}>
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
              }
              @container cq-demo (min-width: 601px) {
                .cq-demo-inner { grid-template-columns: 1fr 1fr 1fr; }
                .cq-card { font-size: 0.82rem; padding: 0.75rem 1rem; }
              }
            `}</style>
            {['AAPL $198.32', 'NVDA $129.14', 'TSLA $227.91', 'MSFT $462.75', 'AMD $94.12', 'SPY $548.20'].map((s) => {
              const [sym, price] = s.split(' ');
              return (
                <div key={sym} className="cq-card" style={{ background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: 8, padding: '0.5rem' }}>
                  <span className="cq-card-title" style={{ fontWeight: 600 }}>{sym}</span>
                  <span style={{ fontFamily: 'monospace', color: 'var(--accent)' }}>{price}</span>
                </div>
              );
            })}
          </div>
        </div>

        <details style={{ marginTop: '1rem' }}>
          <summary style={{ fontSize: '0.78rem', cursor: 'pointer' }}>CSS Pattern</summary>
          <pre style={{ fontSize: '0.7rem', color: 'var(--ink-soft)', background: 'rgba(0,0,0,0.2)', padding: '0.75rem', borderRadius: 8, overflow: 'auto', marginTop: '0.5rem' }}>
{`.widget-grid {
  container-type: inline-size;
  container-name: widget-grid;
}
@container widget-grid (max-width: 400px) {
  .widget-card { grid-template-columns: 1fr; font-size: 0.75rem; }
}
@container widget-grid (min-width: 601px) {
  .widget-card { grid-template-columns: 1fr 1fr 1fr; font-size: 0.85rem; }
}
@supports not (container-type: inline-size) {
  .widget-card { grid-template-columns: 1fr; }
}`}
          </pre>
        </details>
      </section>
    </div>
  );
}
