import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import './theme-lab.css';

const LAB_SECTIONS = [
  { id: 'theme-lab-motion', label: 'Motion Lab', desc: 'Animation library examples — enter/exit, hover, layout, gestures', icon: '◆' },
  { id: 'theme-lab-transitions', label: 'Transitions Lab', desc: 'Page-to-page crossfade via View Transitions API', icon: '⇢' },
  { id: 'theme-lab-scroll', label: 'Scroll Animations', desc: 'Scroll-driven effects — parallax, reveal, header shrink', icon: '⇣' },
  { id: 'theme-lab-container', label: 'Container Queries', desc: 'Responsive components based on their own size, not viewport. In Development area.', icon: '⊡' },
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
              onClick={() => navigate(s.id === 'theme-lab-container' || s.id === 'theme-lab-popover' ? `/builder/${s.id}` : `/lab/${s.id}`)}
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

      {/* ── Pulsing Header Card ──────────────────────────────── */}
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
    </div>
  );
}
