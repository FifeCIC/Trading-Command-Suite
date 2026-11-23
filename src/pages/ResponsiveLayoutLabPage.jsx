/**
 * ResponsiveLayoutLabPage — /development/responsive-layout-lab
 * ===========================================================
 * Moved from the deleted Appearance area (owner, 2026-11-23) and REWRITTEN. The previous version
 * explained itself in paragraphs between every demo; the owner's verdict was:
 *
 *   "remove all the sentences which I hate … update the page with some of the designs above that
 *    I've chosen, remove paragraphs it's all too overwhelming"
 *
 * So the page is now LABELS + SPECIMENS only. The teaching lives in the artefact: pick a device,
 * toggle a column and watch the table reflow. No prose, no hint paragraphs.
 *
 * Patterns borrowed from the named gallery at `/development/theme`: "Toolbar" for the controls,
 * "Summary Strip" for the readings, "Spacious Table" for the specimen and "Chip Bar" for the
 * device selector.
 */
import { useState, useCallback } from 'react';
import { motion } from 'motion/react';
import { PageInfoSlotContent } from '../core/top-row-slot';
import './responsive-layout-lab.css';

const ALL_COLUMNS = [
  { id: 'symbol', label: 'Symbol', priority: 1, minWidth: '60px' },
  { id: 'score', label: 'Score', priority: 1, minWidth: '50px' },
  { id: 'signal', label: 'Signal', priority: 1, minWidth: '55px' },
  { id: 'confidence', label: 'Confidence', priority: 2, minWidth: '70px' },
  { id: 'rarity', label: 'Rarity', priority: 2, minWidth: '70px' },
  { id: 'protocol', label: 'Protocol', priority: 3, minWidth: '100px' },
  { id: 'riskGate', label: 'Risk Gate', priority: 3, minWidth: '70px' },
  { id: 'directives', label: 'Directives', priority: 4, minWidth: '80px' },
  { id: 'lastScored', label: 'Last Scored', priority: 4, minWidth: '90px' },
  { id: 'provider', label: 'Provider', priority: 5, minWidth: '80px' },
];

const SAMPLE_ROWS = [
  { symbol: 'NVDA', score: 92, signal: 'BUY', confidence: 85, rarity: 'Exceptional', protocol: 'tech-titans-v1', riskGate: '0.85×', directives: '12/14', lastScored: '2m', provider: 'MT5' },
  { symbol: 'AAPL', score: 78, signal: 'BUY', confidence: 72, rarity: 'Strong', protocol: 'tech-titans-v1', riskGate: '0.92×', directives: '10/14', lastScored: '5m', provider: 'T212' },
  { symbol: 'MSFT', score: 65, signal: 'HOLD', confidence: 58, rarity: 'Standard', protocol: 'kitchen-sink-v1', riskGate: '0.70×', directives: '8/12', lastScored: '8m', provider: 'MT5' },
  { symbol: 'XAUUSD', score: 88, signal: 'BUY', confidence: 90, rarity: 'Cyclical', protocol: 'gold-hedge-v1', riskGate: '0.95×', directives: '14/16', lastScored: '1m', provider: 'MT5' },
  { symbol: 'TSLA', score: 42, signal: 'SELL', confidence: 35, rarity: 'Standard', protocol: 'meme-stock-v1', riskGate: '0.40×', directives: '4/10', lastScored: '12m', provider: 'T212' },
  { symbol: 'EURUSD', score: 55, signal: 'HOLD', confidence: 48, rarity: 'Standard', protocol: 'forex-session-v1-long', riskGate: '0.65×', directives: '6/10', lastScored: '15m', provider: 'MT5' },
  { symbol: 'SPY', score: 71, signal: 'BUY', confidence: 68, rarity: 'Strong', protocol: 'spy-day-v1-long', riskGate: '0.82×', directives: '11/14', lastScored: '3m', provider: 'T212' },
];

const BREAKPOINTS = [
  { name: '4K+', width: 2560, cols: 'all' },
  { name: 'Desktop', width: 1440, cols: 'all' },
  { name: 'Laptop', width: 1024, cols: '1-4' },
  { name: 'Tablet', width: 768, cols: '1-3' },
  { name: 'Mobile', width: 480, cols: '1-2' },
];

function Panel({ id, title, meta, children }) {
  return (
    <section className="rll-panel" id={id}>
      <div className="rll-panel-head">
        <h2>{title}</h2>
        {meta ? <span className="rll-panel-meta">{meta}</span> : null}
      </div>
      {children}
    </section>
  );
}

export default function ResponsiveLayoutLabPage() {
  const [device, setDevice] = useState('Desktop');
  const [hiddenCols, setHiddenCols] = useState(() => {
    const h = {};
    ALL_COLUMNS.filter((c) => c.priority >= 4).forEach((c) => { h[c.id] = true; });
    return h;
  });

  const toggleCol = useCallback((colId) => {
    setHiddenCols((prev) => ({ ...prev, [colId]: !prev[colId] }));
  }, []);

  const visibleCols = ALL_COLUMNS.filter((c) => !hiddenCols[c.id]);
  const bp = BREAKPOINTS.find((b) => b.name === device) || BREAKPOINTS[1];

  return (
    <div className="rll-page" style={{ '--demo-width': `${bp.width}px` }}>
      <motion.header className="rll-header" initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }}>
        <h1>
          Responsive Layout Lab
          <PageInfoSlotContent>
            Device widths, column priority and table behaviour.
          </PageInfoSlotContent>
        </h1>
      </motion.header>

      <div className="rll-summary">
        <div className="rll-summary-item"><span>Device</span><strong>{device}</strong></div>
        <div className="rll-summary-item"><span>Width</span><strong>{bp.width}px</strong></div>
        <div className="rll-summary-item"><span>Columns</span><strong>{visibleCols.length} / {ALL_COLUMNS.length}</strong></div>
        <div className="rll-summary-item"><span>Breakpoint</span><strong>{bp.cols}</strong></div>
        <div className="rll-summary-item"><span>Rows</span><strong>{SAMPLE_ROWS.length}</strong></div>
      </div>

      <div className="rll-device-bar" role="group" aria-label="Device width">
        {BREAKPOINTS.map((b) => (
          <button
            key={b.name}
            type="button"
            className={`rll-device-btn ${device === b.name ? 'active' : ''}`}
            onClick={() => setDevice(b.name)}
          >
            {b.name} <span className="rll-device-size">{b.width}px</span>
          </button>
        ))}
      </div>

      <motion.div
        className="rll-preview"
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.05 }}
        style={{ maxWidth: bp.width }}
      >
        <div className="rll-preview-rail">
          <span className="rll-frame-label">{device} · {bp.width}px</span>
          <div className="rll-col-settings">
            <span className="rll-col-settings-label">Columns</span>
            {ALL_COLUMNS.map((c) => (
              <label key={c.id} className={`rll-col-toggle pri-${c.priority}`}>
                <input type="checkbox" checked={!hiddenCols[c.id]} onChange={() => toggleCol(c.id)} />
                <span>{c.label}</span>
              </label>
            ))}
            <button type="button" className="rll-col-reset" onClick={() => setHiddenCols({})}>All</button>
            <button
              type="button"
              className="rll-col-reset"
              onClick={() => {
                const h = {};
                ALL_COLUMNS.filter((c) => c.priority >= 3).forEach((c) => { h[c.id] = true; });
                setHiddenCols(h);
              }}
            >
              Compact
            </button>
          </div>
        </div>

        <Panel title="Responsive Table" meta="priority-based column hiding">
          <div className="rll-table-wrap">
            <table className="rll-table">
              <colgroup>
                {visibleCols.map((c) => <col key={c.id} style={{ width: c.minWidth, minWidth: c.minWidth }} />)}
              </colgroup>
              <thead>
                <tr>
                  {visibleCols.map((c) => <th key={c.id} className={`rll-th-pri-${c.priority}`}>{c.label}</th>)}
                </tr>
              </thead>
              <tbody>
                {SAMPLE_ROWS.map((row) => (
                  <tr key={row.symbol}>
                    {visibleCols.map((c) => (
                      <td key={c.id} className={c.id === 'signal' ? 'rll-signal' : ''}>
                        {c.id === 'signal'
                          ? <span className={`rll-signal-badge rll-sig-${row[c.id].toLowerCase()}`}>{row[c.id]}</span>
                          : c.id === 'score'
                            ? <strong className={`rll-sig-${row.signal.toLowerCase()}`}>{row[c.id]}</strong>
                            : row[c.id]}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>

        <Panel title="Card Grid" meta="4 → 3 → 2 → 1 columns">
          <div className="rll-card-grid">
            {SAMPLE_ROWS.map((row) => (
              <div className="rll-card" key={row.symbol}>
                <div className="rll-card-top">
                  <span className="rll-card-symbol">{row.symbol}</span>
                  <span className={`rll-card-score rll-sig-${row.signal.toLowerCase()}`}>{row.score}</span>
                </div>
                <div className="rll-card-meta">
                  <span>Conf {row.confidence}%</span>
                  <span>{row.rarity}</span>
                </div>
                <div className="rll-card-footer">
                  <span>{row.protocol}</span>
                  <span className="rll-card-gate">{row.riskGate}</span>
                </div>
              </div>
            ))}
          </div>
        </Panel>

        <Panel title="Sidebar Layout" meta="collapses to top">
          <div className="rll-sidebar-layout">
            <aside className="rll-sidebar">
              <div className="rll-sidebar-item active">Dashboard</div>
              <div className="rll-sidebar-item">Signals</div>
              <div className="rll-sidebar-item">Risk</div>
              <div className="rll-sidebar-item">Research</div>
            </aside>
            <div className="rll-main-content">
              <div className="rll-stats-row">
                <div className="rll-stat"><span>Positions</span><strong>7</strong></div>
                <div className="rll-stat"><span>Buy share</span><strong>85%</strong></div>
                <div className="rll-stat"><span>Circuit</span><strong>READY</strong></div>
              </div>
              <div className="rll-fill-content">
                <div className="rll-fill-card">NVDA <strong>92</strong> <span className="rll-sig-buy">BUY</span></div>
                <div className="rll-fill-card">AAPL <strong>78</strong> <span className="rll-sig-buy">BUY</span></div>
                <div className="rll-fill-card">XAUUSD <strong>88</strong> <span className="rll-sig-buy">BUY</span></div>
                <div className="rll-fill-card">MSFT <strong>65</strong> <span className="rll-sig-hold">HOLD</span></div>
                <div className="rll-fill-card">TSLA <strong>42</strong> <span className="rll-sig-sell">SELL</span></div>
              </div>
            </div>
          </div>
        </Panel>

        <Panel title="Breakpoints" meta={`active for ${bp.width}px`}>
          <div className="rll-bp-list">
            {BREAKPOINTS.map((b) => (
              <span
                key={b.name}
                className={`rll-bp-tag ${b.name === device ? 'active' : ''} ${b.width <= bp.width ? 'rll-bp-active' : 'rll-bp-inactive'}`}
              >
                {b.name} {b.width}px
              </span>
            ))}
          </div>
        </Panel>

        <Panel title="Content Width" meta="fill vs fixed">
          <div className="rll-width-demos">
            <div className="rll-width-demo">
              <div className="rll-width-demo-label">Full-width fill <code>width: 100%</code></div>
              <div className="rll-fill-container">
                <div className="rll-fill-bar">
                  <span className="rll-fill-bar-label">📊 Dashboard</span>
                  <div className="rll-fill-metrics">
                    <span className="rll-fill-metric">7 positions</span>
                    <span className="rll-fill-metric">+$1,240</span>
                    <span className="rll-fill-metric">85% BUY</span>
                  </div>
                </div>
                <div className="rll-fill-content">
                  <div className="rll-fill-card">NVDA <strong>92</strong> <span className="rll-sig-buy">BUY</span></div>
                  <div className="rll-fill-card">AAPL <strong>78</strong> <span className="rll-sig-buy">BUY</span></div>
                  <div className="rll-fill-card">XAUUSD <strong>88</strong> <span className="rll-sig-buy">BUY</span></div>
                </div>
              </div>
            </div>

            <div className="rll-width-demo">
              <div className="rll-width-demo-label">Fixed width <code>max-width: 640px</code></div>
              <div className="rll-fixed-container">
                <div className="rll-fixed-panel">
                  <h3>Strategy Settings</h3>
                  <div className="rll-fixed-field">
                    <label htmlFor="rll-fixed-name">Protocol name</label>
                    <input id="rll-fixed-name" type="text" defaultValue="tech-titans-v1" readOnly />
                  </div>
                  <div className="rll-fixed-field">
                    <label htmlFor="rll-fixed-size">Max position size</label>
                    <input id="rll-fixed-size" type="text" defaultValue="$5,000" readOnly />
                  </div>
                  <div className="rll-fixed-field">
                    <label htmlFor="rll-fixed-sl">Stop-loss (%)</label>
                    <input id="rll-fixed-sl" type="text" defaultValue="2.5%" readOnly />
                  </div>
                  <div className="rll-fixed-field">
                    <label htmlFor="rll-fixed-note">Description</label>
                    <textarea id="rll-fixed-note" defaultValue="Tech Titans v1 — mega-cap tech on accumulation signals." readOnly rows={3} />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </Panel>

        <Panel title="Fluid vs Stepped" meta="who decides the column count">
          <div className="rll-fluid-demos">
            <div className="rll-fluid-demo">
              <div className="rll-fluid-demo-label">Browser decides <code>auto-fill minmax(140px, 1fr)</code></div>
              <div className="rll-fluid-body">
                <div className="rll-tiles rll-tiles--stepped">
                  <div className="rll-tile"><span className="rll-tile-label">All accounts</span><span className="rll-tile-value">£10,125.44</span></div>
                  <div className="rll-tile"><span className="rll-tile-label">Cost basis</span><span className="rll-tile-value">£11,835.92</span></div>
                  <div className="rll-tile"><span className="rll-tile-label">Free cash</span><span className="rll-tile-value">£0.00</span></div>
                  <div className="rll-tile"><span className="rll-tile-label">Total value</span><span className="rll-tile-value">£8,682.86</span></div>
                  <div className="rll-tile"><span className="rll-tile-label">P&amp;L open</span><span className="rll-tile-value">−£1,299.35</span></div>
                  <div className="rll-tile"><span className="rll-tile-label">Positions</span><span className="rll-tile-value">18</span></div>
                </div>
              </div>
            </div>

            <div className="rll-fluid-demo">
              <div className="rll-fluid-demo-label">Designer decides <code>@container</code></div>
              <div className="rll-fluid-body">
                <div className="rll-tiles rll-tiles--fluid">
                  <div className="rll-tile"><span className="rll-tile-label">All accounts</span><span className="rll-tile-value">£10,125.44</span></div>
                  <div className="rll-tile"><span className="rll-tile-label">Cost basis</span><span className="rll-tile-value">£11,835.92</span></div>
                  <div className="rll-tile"><span className="rll-tile-label">Free cash</span><span className="rll-tile-value">£0.00</span></div>
                  <div className="rll-tile"><span className="rll-tile-label">Total value</span><span className="rll-tile-value">£8,682.86</span></div>
                  <div className="rll-tile"><span className="rll-tile-label">P&amp;L open</span><span className="rll-tile-value">−£1,299.35</span></div>
                  <div className="rll-tile"><span className="rll-tile-label">Positions</span><span className="rll-tile-value">18</span></div>
                </div>
              </div>
            </div>
          </div>
        </Panel>
      </motion.div>
    </div>
  );
}
