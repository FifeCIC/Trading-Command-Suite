/**
 * ThemePage — /development/theme
 * ==============================
 * The single page that replaces the deleted Appearance area (owner, 2026-11-23). Requirement:
 *
 *   "I like how this card has dotted edges to make it less important … I like this row of cards …
 *    this is a table design for BUSY tables … we need to try and name our designs/styles."
 *
 * ⚠️ THIS IS A NAMED GALLERY, NOT A LIVE DATA VIEW. Every specimen is static markup using the
 * app's own vocabulary (real symbols, protocols, positions) so a pattern can be judged on its
 * SHAPE without a backend. The names below are the shared vocabulary — "Dotted Stat", "Summary
 * Strip", "Dense Table", "Spacious Table", "Toolbar", "Chip Bar", "Detail Rail", "Trade Card",
 * "Alert Card", "Priority Panel" — and a new page should reach for one of these before inventing
 * a treatment.
 *
 * ⚠️ Styles live in `theme-page.css` under `.thm-*` on purpose. Page stylesheets are global and
 * load with their own chunk, so borrowing another page's classes renders unstyled until that page
 * has been visited (the failure `scripts/validate-css-imports.cjs` exists to catch).
 */
import { useEffect, useState } from 'react';
import './theme-page.css';

const PATTERNS = [
  { id: 'dotted-stat', name: 'Dotted Stat', tag: 'derived · disabled' },
  { id: 'summary-strip', name: 'Summary Strip', tag: 'row of cards' },
  { id: 'dense-table', name: 'Dense Table', tag: 'busy' },
  { id: 'toolbar', name: 'Toolbar', tag: 'controls' },
  { id: 'spacious-table', name: 'Spacious Table', tag: 'default' },
  { id: 'meter-cell', name: 'Meter Cell', tag: 'table progress' },
  { id: 'micro-button', name: 'Micro Button', tag: 'in-table action' },
  { id: 'chip-bar', name: 'Chip Bar', tag: 'multi-row controls' },
  { id: 'colour-lists', name: 'Colour Lists', tag: 'ranked' },
  { id: 'detail-rail', name: 'Detail Rail', tag: 'sidebar' },
  { id: 'theory-box', name: 'Theory Box', tag: 'text area' },
  { id: 'status-pills', name: 'Status Pills', tag: 'in-table status' },
  { id: 'form-sections', name: 'Form Sections', tag: 'tinted form' },
  { id: 'signal-card', name: 'Signal Card', tag: 'busy card' },
  { id: 'compact-numbers', name: 'Compact Numbers', tag: 'summary' },
  { id: 'trade-card', name: 'Trade Card', tag: 'position' },
  { id: 'alert-card', name: 'Alert Card', tag: 'critical' },
  { id: 'priority-panel', name: 'Priority Panel', tag: 'list panel' },
  { id: 'input-states', name: 'Input States', tag: 'error · disabled' },
  { id: 'snapshot-cards', name: 'Snapshot Cards', tag: 'tinted row' },
];

function Section({ id, name, tag, children }) {
  return (
    <section className="thm-section" id={id}>
      <div className="thm-section-head">
        <h2 className="thm-section-name">{name}</h2>
        <span className="thm-section-tag">{tag}</span>
      </div>
      {children}
    </section>
  );
}

function Meter({ value, tone = 'accent' }) {
  return (
    <span className={`thm-meter thm-meter--${tone}`} aria-hidden="true">
      <span className="thm-meter-fill" style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
    </span>
  );
}

export default function ThemePage() {
  const [active, setActive] = useState(PATTERNS[0].id);

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((e) => e.isIntersecting).sort((a, b) => b.intersectionRatio - a.intersectionRatio);
        if (visible[0]) setActive(visible[0].target.id);
      },
      { rootMargin: '-15% 0px -70% 0px', threshold: [0.15, 0.5] },
    );
    PATTERNS.forEach((p) => {
      const el = document.getElementById(p.id);
      if (el) observer.observe(el);
    });
    return () => observer.disconnect();
  }, []);

  return (
    <div className="thm-page">
      <header className="thm-hero">
        <div>
          <div className="thm-hero-kicker">Design vocabulary</div>
          <div className="thm-hero-title">{PATTERNS.length} named patterns</div>
          <div className="thm-hero-meta">
            <span className="thm-pill thm-pill--ok">Named designs</span>
            <span className="thm-pill">Static mockup</span>
          </div>
        </div>
        <div className="thm-hero-numbers">
          <div className="thm-hero-figure"><span>Tables</span><strong>3</strong></div>
          <div className="thm-hero-figure"><span>Cards</span><strong>4</strong></div>
          <div className="thm-hero-figure"><span>Containers</span><strong>3</strong></div>
        </div>
      </header>

      <div className="thm-layout">
        <aside className="thm-index" aria-label="Design index">
          <div className="thm-index-head">Patterns</div>
          <nav>
            {PATTERNS.map((p, i) => (
              <a
                key={p.id}
                href={`#${p.id}`}
                className={`thm-index-item ${active === p.id ? 'is-active' : ''}`}
              >
                <span className="thm-index-num">{String(i + 1).padStart(2, '0')}</span>
                <span className="thm-index-name">{p.name}</span>
              </a>
            ))}
          </nav>
        </aside>

        <main className="thm-gallery">
          <Section id="dotted-stat" name="Dotted Stat" tag="derived · disabled">
            <div className="thm-stat-grid">
              <div className="thm-stat"><span className="thm-stat-label">Value</span><span className="thm-stat-value">£1,716.74</span></div>
              <div className="thm-stat"><span className="thm-stat-label">Cost basis</span><span className="thm-stat-value">£1,002.21</span></div>
              <div className="thm-stat thm-stat--derived"><span className="thm-stat-label">Value − cost</span><span className="thm-stat-value thm-neg">−£437.63</span></div>
              <div className="thm-stat thm-stat--disabled"><span className="thm-stat-label">Free cash</span><span className="thm-stat-value">£0.00</span></div>
            </div>
          </Section>

          <Section id="summary-strip" name="Summary Strip" tag="row of cards">
            <div className="thm-tint">
              <div className="thm-stat-grid">
                <div className="thm-stat"><span className="thm-stat-label">Across enabled accounts</span><span className="thm-stat-value">£1,716.74</span></div>
                <div className="thm-stat"><span className="thm-stat-label">Cost basis</span><span className="thm-stat-value">£1,002.21</span></div>
                <div className="thm-stat"><span className="thm-stat-label">Free cash</span><span className="thm-stat-value">£0.00</span></div>
                <div className="thm-stat thm-stat--accent"><span className="thm-stat-label">Open P&amp;L</span><span className="thm-stat-value thm-pos">+£19.59</span></div>
              </div>
            </div>
          </Section>

          <Section id="dense-table" name="Dense Table" tag="busy">
            <div className="thm-scroll">
              <table className="thm-table thm-table--dense">
                <thead>
                  <tr>
                    <th>Symbol</th><th>Move</th><th>Last</th><th>Vol</th><th>Score</th>
                    <th>Assigned</th><th>Open</th><th>Queue</th><th>Today</th><th>Last decision</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    ['NZDUSD', '+2.41%', '0.5912', '18K', '59', 'Forex Session V1', '—', '0', '3', 'HOLD'],
                    ['EURUSD', '+1.87%', '1.0841', '24K', '59', 'Forex Session V1', '1', '1', '5', 'BUY'],
                    ['EURGBP', '−1.12%', '0.8419', '11K', '108', 'Session Short', '1', '0', '2', 'STRONG_SELL'],
                    ['BTC', '−3.02%', '91,204', '6.1K', '44', '—', '—', '0', '1', 'HOLD'],
                    ['XAUUSD', '+0.64%', '2,087.4', '9.2K', '126', 'Gold Hedge V1', '1', '1', '7', 'STRONG_BUY'],
                    ['US500', '+0.31%', '5,128.8', '—', '84', 'Gap Scanner V1', '—', '0', '4', 'STRONG_BUY'],
                    ['ETH', '−2.44%', '3,041', '4.8K', '47', '—', '—', '0', '0', 'HOLD'],
                    ['SOL', '−1.88%', '142.6', '2.2K', '44', '—', '—', '0', '0', 'NO_READING'],
                  ].map((r) => (
                    <tr key={r[0]}>
                      {r.map((cell, i) => (
                        <td key={i} className={i === 0 ? 'thm-sym' : ''}>{cell}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>

          <Section id="toolbar" name="Toolbar" tag="controls">
            <div className="thm-toolbar">
              <div className="thm-toolbar-group">
                <label htmlFor="thm-search">Search</label>
                <input id="thm-search" type="search" placeholder="Symbol or name" readOnly />
              </div>
              <div className="thm-toolbar-group">
                <label htmlFor="thm-type">Type</label>
                <select id="thm-type" defaultValue="all" disabled>
                  <option value="all">All Types</option>
                </select>
              </div>
              <div className="thm-toolbar-stats">
                <span>Total <strong>484</strong></span>
                <span>Shown <strong>484</strong></span>
              </div>
            </div>
          </Section>

          <Section id="spacious-table" name="Spacious Table" tag="default">
            <div className="thm-frame">
              <table className="thm-table thm-table--spacious">
                <thead>
                  <tr>
                    <th>☆</th><th>Ticker ↕</th><th>Name ↕</th><th>Type ↕</th><th>Tags ↕</th>
                    <th>Position ↓</th><th>Quantity ↕</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    ['AUDJPY', 'Australian Dollar / Yen', 'forex', 'carry', '—', '—'],
                    ['NZDUSD', 'New Zealand Dollar / US Dollar', 'forex', 'mean-reversion', 'Long', '12,000'],
                    ['XAUUSD', 'Gold / US Dollar', 'metal', 'hedge', 'Long', '0.40'],
                    ['NVDA', 'NVIDIA Corporation', 'stock', 'tech · ai', '—', '—'],
                    ['AAPL', 'Apple Inc.', 'stock', 'tech', 'Long', '22'],
                    ['MSFT', 'Microsoft Corporation', 'stock', 'tech', '—', '—'],
                  ].map((r) => (
                    <tr key={r[0]}>
                      <td className="thm-star">☆</td>
                      <td className="thm-sym">{r[0]}</td>
                      <td>{r[1]}</td>
                      <td><span className="thm-type">{r[2]}</span></td>
                      <td className="thm-soft">{r[3]}</td>
                      <td>{r[4]}</td>
                      <td className="thm-num">{r[5]}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>

          <Section id="meter-cell" name="Meter Cell" tag="table progress">
            <div className="thm-frame">
              <table className="thm-table">
                <thead><tr><th>Symbol</th><th>Attention</th><th>Signal</th></tr></thead>
                <tbody>
                  {[['USDJPY', 100, 'BUY'], ['EURUSD', 74, 'BUY'], ['XAUUSD', 61, 'HOLD'], ['TSLA', 22, 'SELL']].map(([sym, v, sig]) => (
                    <tr key={sym}>
                      <td className="thm-sym">{sym}</td>
                      <td>
                        <span className="thm-meter-cell">
                          <span className="thm-num">{v}</span>
                          <Meter value={v} tone={v >= 70 ? 'accent' : v >= 40 ? 'warn' : 'muted'} />
                        </span>
                      </td>
                      <td><span className={`thm-badge thm-badge--${sig.toLowerCase()}`}>{sig}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>

          <Section id="micro-button" name="Micro Button" tag="in-table action">
            <div className="thm-frame">
              <table className="thm-table">
                <thead><tr><th>Symbol</th><th>Score</th><th>Action</th></tr></thead>
                <tbody>
                  {[['NVDA', 92], ['AAPL', 78], ['MSFT', 65]].map(([sym, score]) => (
                    <tr key={sym}>
                      <td className="thm-sym">{sym}</td>
                      <td className="thm-num">{score}</td>
                      <td><button type="button" className="thm-micro">➕ Watch</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>

          <Section id="chip-bar" name="Chip Bar" tag="multi-row controls">
            <div className="thm-chipbar">
              <div className="thm-chipset">
                <span className="thm-chipset-label">Horizon</span>
                <button type="button" className="thm-chip is-on">1mo</button>
                <button type="button" className="thm-chip">2mo</button>
                <button type="button" className="thm-chip">3mo</button>
              </div>
              <div className="thm-chipset">
                <span className="thm-chipset-label">Sector</span>
                <button type="button" className="thm-chip is-on">All Sectors</button>
                <button type="button" className="thm-chip">Tech</button>
                <button type="button" className="thm-chip">Energy</button>
              </div>
              <div className="thm-chipset">
                <span className="thm-chipset-label">Time window</span>
                <button type="button" className="thm-chip is-on">All</button>
                <button type="button" className="thm-chip">Today</button>
                <button type="button" className="thm-chip">Tomorrow</button>
              </div>
            </div>
          </Section>

          <Section id="colour-lists" name="Colour Lists" tag="ranked">
            <div className="thm-two-col">
              <div className="thm-list thm-list--up">
                <div className="thm-list-head">🟢 Overnight Gainers</div>
                {[['#1', 'NZDUSD', '59', 'BUY'], ['#2', 'EURUSD', '59', 'BUY'], ['#3', 'EURGBP', '108', 'STRONG_SELL']].map(([rank, sym, score, sig]) => (
                  <div className="thm-list-row" key={sym}>
                    <span className="thm-list-rank">{rank}</span>
                    <span className="thm-sym">{sym}</span>
                    <span className="thm-num">{score}</span>
                    <span className={`thm-badge thm-badge--${sig.startsWith('STRONG') ? 'strong-sell' : sig.toLowerCase()}`}>{sig}</span>
                  </div>
                ))}
              </div>
              <div className="thm-list thm-list--down">
                <div className="thm-list-head">🔴 Overnight Losers</div>
                {[['#1', 'BTC', '44', 'HOLD'], ['#2', 'ETH', '47', 'HOLD'], ['#3', 'SOL', '44', 'NO_READING']].map(([rank, sym, score, sig]) => (
                  <div className="thm-list-row" key={sym}>
                    <span className="thm-list-rank">{rank}</span>
                    <span className="thm-sym">{sym}</span>
                    <span className="thm-num">{score}</span>
                    <span className={`thm-badge thm-badge--${sig.toLowerCase().replace('_', '-')}`}>{sig}</span>
                  </div>
                ))}
              </div>
            </div>
          </Section>

          <Section id="detail-rail" name="Detail Rail" tag="sidebar">
            <div className="thm-rail-layout">
              <div className="thm-rail">
                <div className="thm-rail-item is-selected">
                  <span className="thm-rail-name">★1 Forex Session V1 (Long)</span>
                  <span className="thm-rail-meta"><span className="thm-dot thm-dot--ok" />+14 · 9 dir</span>
                </div>
                <div className="thm-rail-item">
                  <span className="thm-rail-name">Session Short</span>
                  <span className="thm-rail-meta"><span className="thm-dot thm-dot--warn" />⚠ 1 · 6 dir</span>
                </div>
                <div className="thm-rail-item">
                  <span className="thm-rail-name">Gap Scanner V1</span>
                  <span className="thm-rail-meta"><span className="thm-dot thm-dot--off" />0 · 4 dir</span>
                </div>
              </div>

              <div className="thm-detail">
                <div className="thm-detail-head">
                  <div>
                    <div className="thm-detail-title">★1 Forex Session V1 (Long)</div>
                    <div className="thm-detail-sub">forex-session-v1-long</div>
                  </div>
                  <div className="thm-detail-status">
                    <span className="thm-pill thm-pill--ok">Active</span>
                    <span className="thm-pill thm-pill--target">Target: 250</span>
                  </div>
                </div>

                <div className="thm-theory">
                  <h3>Theory</h3>
                  <div>Session-timed forex for the major pairs. Targets London and New York opens, exits on the loss of the session range.</div>
                </div>

                <div className="thm-note">
                  <div className="thm-note-head">How it affects the score</div>
                  <ul>
                    <li>Contributes to <strong>ONE side only</strong></li>
                    <li>Can only raise a composite that is already non-zero</li>
                  </ul>
                </div>

                <div className="thm-detail-section">
                  <div className="thm-detail-section-head">What it does</div>
                  <div>Hybrid scoring: continuous base (RSI 70→0pts, 30→20pts) plus a session-eligibility gate.</div>
                </div>
              </div>
            </div>
          </Section>

          <Section id="theory-box" name="Theory Box" tag="text area">
            <div className="thm-theory">
              <h3>Written intent</h3>
              <div>Session-timed forex for the major pairs. Targets London and New York opens, exits on the loss of the session range. Not a trend follower — it is looking for the range to hold.</div>
            </div>
          </Section>

          <Section id="status-pills" name="Status Pills" tag="in-table status">
            <div className="thm-frame">
              <table className="thm-table">
                <thead><tr><th>Protocol</th><th>Status</th><th>Signal</th><th>Reading</th></tr></thead>
                <tbody>
                  <tr><td className="thm-sym">forex-session-v1-long</td><td><span className="thm-status thm-status--ok"><i />Active</span></td><td><span className="thm-badge thm-badge--strong-sell">STRONG_SELL</span></td><td><span className="thm-badge thm-badge--hold">HOLD</span></td></tr>
                  <tr><td className="thm-sym">gold-hedge-v1</td><td><span className="thm-status thm-status--warn"><i />Standby</span></td><td><span className="thm-badge thm-badge--buy">BUY</span></td><td><span className="thm-badge thm-badge--no-reading">NO_READING</span></td></tr>
                  <tr><td className="thm-sym">gap-scanner-v1-long</td><td><span className="thm-status thm-status--off"><i />Off</span></td><td><span className="thm-badge thm-badge--sell">SELL</span></td><td><span className="thm-badge thm-badge--hold">HOLD</span></td></tr>
                </tbody>
              </table>
            </div>
          </Section>

          <Section id="form-sections" name="Form Sections" tag="tinted form">
            <div className="thm-tint">
              <div className="thm-form-section">
                <div className="thm-form-section-head">Protocol Details</div>
                <div className="thm-form-grid">
                  <label className="thm-field">
                    <span>Load existing protocol</span>
                    <select defaultValue="none"><option value="none">— Create new —</option></select>
                  </label>
                  <label className="thm-field">
                    <span>Name</span>
                    <input type="text" defaultValue="BTC Investor V1" readOnly />
                  </label>
                  <label className="thm-field">
                    <span>Style</span>
                    <select defaultValue="trend"><option value="trend">Trend</option></select>
                  </label>
                  <label className="thm-field">
                    <span>Direction</span>
                    <select defaultValue="long"><option value="long">Long</option></select>
                  </label>
                </div>
              </div>
            </div>
          </Section>

          <Section id="signal-card" name="Signal Card" tag="busy card">
            <div className="thm-card-row">
              <div className="thm-signal-card thm-signal-card--top">
                <div className="thm-signal-top"><span className="thm-rank">#1</span><span className="thm-sym">US500</span><span className="thm-pill thm-pill--ok">Live</span></div>
                <div className="thm-signal-name">Gap Scanner V1 (Long)</div>
                <div className="thm-signal-figures">
                  <div><span>Signal</span><strong className="thm-pos">STRONG_BUY</strong></div>
                  <div><span>Score</span><strong>84 / 250</strong></div>
                  <div><span>Progress</span><strong>34%</strong></div>
                </div>
                <Meter value={34} />
              </div>
              <div className="thm-signal-card">
                <div className="thm-signal-top"><span className="thm-rank">#2</span><span className="thm-sym">XAUUSD</span><span className="thm-pill thm-pill--muted">Queued</span></div>
                <div className="thm-signal-name">Gold Hedge V1</div>
                <div className="thm-signal-figures">
                  <div><span>Signal</span><strong className="thm-pos">BUY</strong></div>
                  <div><span>Score</span><strong>126 / 250</strong></div>
                  <div><span>Progress</span><strong>50%</strong></div>
                </div>
                <Meter value={50} />
              </div>
            </div>
          </Section>

          <Section id="compact-numbers" name="Compact Numbers" tag="summary">
            <div className="thm-numbers">
              {[['Scanned', '12', ''], ['Trending', '6', 'pos'], ['Sideways', '0', 'neg'], ['Tradeable', '6', 'accent'], ['Scan time', '149ms', '']].map(([label, value, tone]) => (
                <div className={`thm-numbers-item ${tone ? `thm-${tone}` : ''}`} key={label}>
                  <span className="thm-numbers-label">{label}</span>
                  <span className="thm-numbers-value">{value}</span>
                </div>
              ))}
            </div>
          </Section>

          <Section id="trade-card" name="Trade Card" tag="position">
            <div className="thm-trade-grid">
              <div className="thm-trade thm-trade--win">
                <div className="thm-trade-head"><span className="thm-sym">VIX</span><span className="thm-trade-venue">MT5 · 2149650 @ PepperstoneUK-Demo · GBP</span></div>
                <div className="thm-trade-figures"><strong className="thm-pos">+0.00</strong><span>(0.00%)</span><span className="thm-soft">#102307643</span></div>
              </div>
              <div className="thm-trade thm-trade--lose">
                <div className="thm-trade-head"><span className="thm-sym">EURGBP</span><span className="thm-trade-venue">MT5 · 11309743 @ MetaQuotes-Demo · GBP</span></div>
                <div className="thm-trade-figures"><strong className="thm-neg">−4.85</strong><span>(−0.04%)</span><span className="thm-soft">#152949448</span></div>
                <div className="thm-trade-actions">
                  <span className="thm-warn">⚠️ Close unavailable — routing not broker-aware</span>
                  <button type="button" className="thm-close">✕ Close</button>
                </div>
              </div>
            </div>
          </Section>

          <Section id="alert-card" name="Alert Card" tag="critical">
            <div className="thm-alert">
              <div className="thm-alert-head"><span className="thm-sym">USDCAD</span><span className="thm-alert-name">USDCAD Forex Session Bot</span><span className="thm-alert-pct thm-neg">−0.1%</span></div>
              <div className="thm-alert-figures">
                <div><span>Peak</span><strong className="thm-pos">+0.03%</strong></div>
                <div><span>Give-back</span><strong className="thm-neg">0.13%</strong></div>
                <div><span>Held</span><strong>2h 14m</strong></div>
              </div>
              <div className="thm-alert-actions"><button type="button" className="thm-btn thm-btn--danger">Exit Now</button><button type="button" className="thm-btn">Hold</button></div>
            </div>
          </Section>

          <Section id="priority-panel" name="Priority Panel" tag="list panel">
            <div className="thm-priority">
              <div className="thm-priority-head">
                <span>🎯 Priority Focus: <strong>XAUUSD</strong></span>
                <button type="button" className="thm-btn thm-btn--accent">🔄 Run Fresh Scoring</button>
              </div>
              <div className="thm-priority-body">
                <div className="thm-priority-figure"><span>Composite score</span><strong>126</strong></div>
                <div className="thm-priority-figure"><span>Signal</span><strong className="thm-pos">STRONG_BUY</strong></div>
                <div className="thm-priority-figure"><span>Directives</span><strong>14 / 16</strong></div>
                <div className="thm-priority-figure"><span>Gate</span><strong>0.95×</strong></div>
              </div>
            </div>
          </Section>

          <Section id="input-states" name="Input States" tag="error · disabled">
            <div className="thm-input-demo">
              <div className="thm-form-section">
                <div className="thm-form-section-head">Error &amp; Disabled States</div>
                <div className="thm-form-grid">
                  <label className="thm-field thm-field--error">
                    <span>Ticker Symbol</span>
                    <input type="text" defaultValue="AUDPY" readOnly aria-invalid="true" />
                    <em>Symbol not found. Check the ticker.</em>
                  </label>
                  <label className="thm-field thm-field--disabled">
                    <span>Broker route</span>
                    <input type="text" defaultValue="Not available" readOnly disabled />
                  </label>
                  <label className="thm-field">
                    <span>Quantity</span>
                    <input type="text" defaultValue="0.40" readOnly />
                  </label>
                </div>
              </div>
            </div>
          </Section>

          <Section id="snapshot-cards" name="Snapshot Cards" tag="tinted row">
            <div className="thm-tint">
              <div className="thm-snapshot-grid">
                <div className="thm-snapshot"><span className="thm-snapshot-label">Stored account snapshots</span><strong className="thm-neg">−£21.39</strong><span className="thm-snapshot-delta thm-pos">▲ +£19.59</span><span className="thm-snapshot-meta">23/11/2026, 22:14</span></div>
                <div className="thm-snapshot"><span className="thm-snapshot-label">Open exposure</span><strong>£842.10</strong><span className="thm-snapshot-delta thm-muted">3 positions</span><span className="thm-snapshot-meta">MetaQuotes-Demo</span></div>
                <div className="thm-snapshot"><span className="thm-snapshot-label">Free margin</span><strong>£1,204.55</strong><span className="thm-snapshot-delta thm-pos">▲ 12.4%</span><span className="thm-snapshot-meta">PepperstoneUK-Demo</span></div>
              </div>
            </div>
          </Section>
        </main>
      </div>
    </div>
  );
}
