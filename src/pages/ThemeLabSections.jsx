import { useState } from 'react';
import FadeCardGroup from '../components/FadeCardGroup';
import './theme-lab.css';
import '../core/forms.css'; // canonical shared Form System (.ff-*)
import PageInfoPopover from '../components/PageInfoPopover';
// The three lab SECTIONS, merged 2026-10-01. This page used to be a HUB that only linked out to them
// (`LAB_SECTIONS.map` + `navigate('/development/' + id)`). The owner's instruction was "add the
// examples to the theme-lab page and delete this page", so the examples now RENDER here and the hub
// is gone. Each file exports a SECTION — no page wrapper, no <h1>.
//
// ⚠️ TRANSITIONS LAB was deleted 2026-10-01 with its examples NOT migrated: asked whether to move
// them first, the owner answered "all 21". Recover from git if that call is reversed.
// ⚠️ REMOVED 2026-10-13: MotionLabSection / ScrollLabSection / PopoverLabSection were imported and
// rendered here. They are rendered by AppearanceMotionPage instead — importing them here put the
// motion examples on every group page. If this file needs them again, guard them by group.

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

// ⚠️ `TABLE_ROWS` WAS HERE AND IS DELETED (2026-10-13, owner request). It held four INVENTED rows
// (AAPL $198.32, TSLA $227.91, …) and fed the "Table at Different Shade Levels" section, which the
// owner removed from /appearance/data-display. Deleted rather than left behind because a section
// nothing renders is the "buried ability" the repo's own rules warn about — and because fabricated
// market data is exactly what the owner ruled out for this area: *"Only use this apps own real data
// to create examples."* Real tables replaced it, fetching live rows.

const FORM_STANDARD_CLASSES = [
  '.ff-form              /* Form container — column, 1rem field gap */',
  '.ff-field             /* Field group: label + control + hint */',
  '.ff-field--error      /* Field in error (red border) */',
  '.ff-field--success    /* Field in success (green border) */',
  '.ff-label             /* Uppercase micro-label */',
  '.ff-input/.ff-select/.ff-textarea  /* Unified controls */',
  '.ff-hint              /* Hint/description below a field */',
  '.ff-error/.ff-success /* Padded status banners */',
  '.ff-row-2/.ff-row-3   /* Responsive 2/3-col grids */',
  '.ff-seg/.ff-seg-btn   /* Segmented control (few options) */',
  '.ff-bar               /* Compact filter toolbar (dense) */',
  '.ff-checkbox-label    /* Checkbox + label */',
  '.ff-actions           /* Right-aligned action row */',
  '.ff-btn/.ff-btn-primary/.ff-btn-secondary  /* Buttons */',
].join('\n');

const FADE_CARDS = [
  { label: 'Technical Analysis', desc: 'Price action, momentum, patterns, volume — weighted at 0.40 in group-weighted mode.', color: '#3b82f6' },
  { label: 'Sentiment & Fundamentals', desc: 'Analyst consensus, news, earnings, social — weighted at 0.35.', color: '#f59e0b' },
  { label: 'Risk & Structural', desc: 'Correlation, dilution, concentration, volatility, liquidity — multiplier on composite.', color: '#22c55e' },
  { label: 'Risk Controls', desc: 'Stop-loss triggers, drawdown limits, exposure caps — hard gates that veto trades.', color: '#ef4444' },
];

const GLOW_PRESETS = [
  { tone: 'accent',  label: 'Accent (default)', dot: 'var(--accent)',              desc: 'Neutral emphasis — the Protocol Trail summary card uses this teal corner glow.' },
  { tone: 'success', label: 'Positive',         dot: 'var(--notice-success-text)',  desc: 'Green glow makes a status feel healthy — wins, profit, passing checks.' },
  { tone: 'warning', label: 'Caution',          dot: 'var(--notice-warning-text)',  desc: 'Amber glow draws measured attention — pending actions, approaching limits.' },
  { tone: 'danger',  label: 'Critical',         dot: 'var(--notice-critical-text)', desc: 'Red glow signals urgency — stop-losses, breaches, failures.' },
  { tone: 'info',    label: 'Informational',    dot: 'var(--notice-info-text)',     desc: 'Blue glow for neutral updates — new data, insights, routine status.' },
];

/**
 * ThemeLabSections — the element-by-element examples, grouped, in ONE file.
 * ==========================================================================
 * ⚠️ RENDERED BY THE APPEARANCE PAGES, NOT ROUTED DIRECTLY. Each page passes the group it wants and
 * only that group's sections render. A section whose heading has no `group === '…'` guard belongs to
 * nobody and will never appear — so if you add a section here, give it exactly one group.
 *
 * ⚠️ THIS FILE IS THE SINGLE SOURCE OF THESE EXAMPLES. It was `ThemeLabPage.jsx`, one long page; the
 * Appearance area needed them as element groups instead (owner request, 2026-10-13). They were NOT
 * copied into four files — four copies drift and only one receives the next fix.
 *
 * ⚠️ The page wrapper (`tl-page`, the `tl-header`, the `<h1>`) is deliberately gone: each Appearance
 * page supplies its own heading, so leaving it here would render a second title inside every page.
 */
export function ThemeLabSections({ group }) {
  const [activeBg, setActiveBg] = useState(null);

  return (
    <div className="tl-sections">

      {/* ⚠️ THE THREE LAB COMPONENTS WERE HERE AND ARE DELETED (2026-10-13). They render
          unconditionally, so while they sat in this shared library they appeared at the top of EVERY
          group page — nine motion headings above the colour swatches — and TWICE on Motion, once from
          here and once from the page itself. They belong to Motion, which renders them; a shared
          library must contain only group-guarded sections. */}

      {/* ── Best Practices ─────────────────────────────────── */}
      {group === 'colour' && (
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
      )}

      {/* ── Panel Shading ───────────────────────────────────── */}
      {group === 'colour' && (
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
      )}

      {/* ── Text Contrast ───────────────────────────────────── */}
      {group === 'colour' && (
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
      )}

      {/* ── Card Variants ───────────────────────────────────── */}
      {group === 'surfaces' && (
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
      )}

      {/* ── Neon Border Card Variants ────────────────────────── */}
      {group === 'surfaces' && (
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
      )}

      {/* ── Corner Glow Surfaces ─────────────────────────────── */}
      {group === 'surfaces' && (
<section className="tl-section">
        <h2>Corner Glow Surfaces</h2>
        <p className="tl-hint">
          A soft radial glow washing from one corner of a panel — the highlight used by the Protocol Trail
          summary card (<code>.pt-summary</code>). Intended to raise the <em>presence</em> of a status:
          green reads as positive, red as critical. Trial these in both light and dark mode before promoting.
        </p>
        <div className="tl-card-grid">
          {GLOW_PRESETS.map((g) => (
            <div key={g.tone} className={`tl-glow-card tl-glow-card--${g.tone}`}>
              <div className="tl-glow-head">
                <span className="tl-glow-dot" style={{ background: g.dot, boxShadow: `0 0 10px ${g.dot}` }} />
                <strong>{g.label}</strong>
              </div>
              <p>{g.desc}</p>
            </div>
          ))}
        </div>
      </section>
      )}

      {/* ── Fade-on-Hover Stack ──────────────────────────────── */}
      {group === 'motion' && (
<section className="tl-section">
        <h2>Fade-on-Hover Card Stack</h2>
        <p className="tl-hint">
          Cards that start muted and reveal their full colour on hover — tones down busy multi-card stacks.
          Uses the shared <code>&lt;FadeCardGroup variant="hover"&gt;</code> component.
        </p>
        <FadeCardGroup cards={FADE_CARDS} variant="hover" />
      </section>
      )}

      {/* ── Fade-on-Scroll Stack ─────────────────────────────── */}
      {group === 'motion' && (
<section className="tl-section">
        <h2>Fade-on-Scroll Card Stack</h2>
        <p className="tl-hint">
          Same component with <code>variant="scroll"</code> — cards also reveal when the group
          reaches the vertical centre of the viewport. Scroll to see the effect.
        </p>
        <FadeCardGroup cards={FADE_CARDS} variant="scroll" />
      </section>
      )}

      {/* ── Fade-on-Scroll (one at a time) ────────────────────── */}
      {group === 'motion' && (
<section className="tl-section">
        <h2>Fade-on-Scroll — One Card at a Time</h2>
        <p className="tl-hint">
          <code>variant="scroll-each"</code> — each card lights up individually as it crosses the
          screen centre line. Only one card is highlighted at a time.
        </p>
        <FadeCardGroup cards={FADE_CARDS} variant="scroll-each" />
      </section>
      )}
      {group === 'motion' && (
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
      )}

      {/* ⚠️ "Table at Different Shade Levels" WAS HERE AND IS DELETED (2026-10-13, owner request).
          It rendered four invented rows, and the owner removed it from /appearance/data-display, which
          now carries five tables built from the app's own stylesheets and live data instead. The
          SECTION is deleted, not just its render, so the `data` group does not become a guard that
          nothing satisfies — a section no page renders is a buried ability. It survives in git history
          if the shade demo is ever wanted back; bring it back with real rows, not fixtures. */}

      {/* ── Active Preview ──────────────────────────────────── */}
      {/* ⚠️ TWO CONDITIONS, IN THIS ORDER — the shade must exist before it can be previewed, and the
          section must belong to the page asking for it. An earlier pass put the group test INSIDE the
          `activeBg` test, which is an object literal in JSX and does not compile. */}
      {/* ⚠️ GROUPED WITH `colour`, NEXT TO THE SHADE PICKER THAT DRIVES IT. The picker lives in Panel
          Shading above — a preview of a shade belongs beside the control that chooses it. Put here on
          `interactive` instead, the section would have rendered nothing at all until someone visited
          another page: a group page that is empty on arrival is a buried ability, not a page. */}
      {group === 'colour' && activeBg && (
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

            {/* ⚠️ FORM SYSTEM MOVED OUT 2026-10-13 (owner request): it is now a page in the Appearance area
          (src/pages/AppearanceFormsPage.jsx). It is NOT copied — this file no longer renders it, so
          there is one implementation of the form standard and one place to fix it. */}

      {/* ── Container Queries Demo ─────────────────────────── */}
      {/* ⚠️ THIS GUARD WAS MISSING AND THE SECTION RENDERED ON EVERY PAGE. The first pass located
          sections by the literal string `<section className="tl-section">`; this one is
          `<section className="tl-section" id="container-queries">`, so it never matched and was
          never grouped. Match on the CLASS, not the whole opening tag, or a section with an id,
          a style or a data attribute is silently left behind — and it appears everywhere. */}
      {group === 'interactive' && (
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
      )}
    </div>
  );
}
