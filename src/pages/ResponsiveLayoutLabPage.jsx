import { useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import './responsive-layout-lab.css';

// ── Sample data ──
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
  { symbol: 'NVDA', score: 92, signal: 'BUY', confidence: 85, rarity: 'Exceptional', protocol: 'tech-titans-v1', riskGate: '0.85×', directives: '12/14', lastScored: '2m ago', provider: 'MT5' },
  { symbol: 'AAPL', score: 78, signal: 'BUY', confidence: 72, rarity: 'Strong', protocol: 'tech-titans-v1', riskGate: '0.92×', directives: '10/14', lastScored: '5m ago', provider: 'T212' },
  { symbol: 'MSFT', score: 65, signal: 'HOLD', confidence: 58, rarity: 'Standard', protocol: 'kitchen-sink-v1', riskGate: '0.70×', directives: '8/12', lastScored: '8m ago', provider: 'MT5' },
  { symbol: 'XAUUSD', score: 88, signal: 'BUY', confidence: 90, rarity: 'Cyclical', protocol: 'gold-hedge-v1', riskGate: '0.95×', directives: '14/16', lastScored: '1m ago', provider: 'MT5' },
  { symbol: 'TSLA', score: 42, signal: 'SELL', confidence: 35, rarity: 'Standard', protocol: 'meme-stock-v1', riskGate: '0.40×', directives: '4/10', lastScored: '12m ago', provider: 'T212' },
  { symbol: 'EURUSD', score: 55, signal: 'HOLD', confidence: 48, rarity: 'Standard', protocol: 'forex-session-v1', riskGate: '0.65×', directives: '6/10', lastScored: '15m ago', provider: 'MT5' },
  { symbol: 'SPY', score: 71, signal: 'BUY', confidence: 68, rarity: 'Strong', protocol: 'spy-day-v1', riskGate: '0.82×', directives: '11/14', lastScored: '3m ago', provider: 'T212' },
];

const BREAKPOINTS = [
  { name: '4K+', width: 2560, cols: 'all' },
  { name: 'Desktop', width: 1440, cols: 'all' },
  { name: 'Laptop', width: 1024, cols: '1-4' },
  { name: 'Tablet', width: 768, cols: '1-3' },
  { name: 'Mobile', width: 480, cols: '1-2' },
];

export default function ResponsiveLayoutLabPage() {
  const [device, setDevice] = useState('Desktop');
  const [hiddenCols, setHiddenCols] = useState(() => {
    const h = {};
    ALL_COLUMNS.filter(c => c.priority >= 4).forEach(c => { h[c.id] = true; });
    return h;
  });
  const [scrollDemo, setScrollDemo] = useState(false);

  const toggleCol = useCallback((colId) => {
    setHiddenCols(prev => ({ ...prev, [colId]: !prev[colId] }));
  }, []);

  const visibleCols = ALL_COLUMNS.filter(c => !hiddenCols[c.id]);
  const bp = BREAKPOINTS.find(b => b.name === device) || BREAKPOINTS[1];

  const deviceWidth = bp.width;

  return (
    <div className="rll-page" style={{ '--demo-width': deviceWidth + 'px' }}>
      <motion.header className="rll-header" initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}>
        <div>
          <h1>Responsive Layout Lab</h1>
          <p className="rll-subtitle">Reference patterns for tables, grids, and layouts that adapt to device sizes. Pick a device to preview.</p>
        </div>
      </motion.header>

      {/* ── Device Selector ── */}
      <motion.div className="rll-device-bar" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.05 }}>
        {BREAKPOINTS.map(b => (
          <button
            key={b.name}
            className={`rll-device-btn ${device === b.name ? 'active' : ''}`}
            onClick={() => setDevice(b.name)}
          >
            {b.name} <span className="rll-device-size">({b.width}px)</span>
          </button>
        ))}
      </motion.div>

      {/* ── Preview Frame ── */}
      <motion.div
        className="rll-preview"
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.08 }}
        style={{ maxWidth: deviceWidth }}
      >
        <div className="rll-frame-label">{device} ({deviceWidth}px) — {visibleCols.length} of {ALL_COLUMNS.length} columns visible</div>

        {/* ── Column Settings ── */}
        <div className="rll-col-settings">
          <span className="rll-col-settings-label">Toggle columns:</span>
          {ALL_COLUMNS.map(c => (
            <label key={c.id} className={`rll-col-toggle pri-${c.priority}`}>
              <input type="checkbox" checked={!hiddenCols[c.id]} onChange={() => toggleCol(c.id)} />
              <span>{c.label}</span>
            </label>
          ))}
          <button className="rll-col-reset" onClick={() => setHiddenCols({})}>Show all</button>
          <button className="rll-col-reset" onClick={() => {
            const h = {};
            ALL_COLUMNS.filter(c => c.priority >= 3).forEach(c => { h[c.id] = true; });
            setHiddenCols(h);
          }}>Compact</button>
        </div>

        {/* ── Responsive Table ── */}
        <div className="rll-table-section">
          <h3>Responsive Table <span className="rll-hint">— priority-based column hiding + horizontal scroll</span></h3>
          <div className={`rll-table-wrap ${scrollDemo ? 'rll-scroll-hint' : ''}`} onScroll={() => setScrollDemo(true)}>
            <table className="rll-table">
              <colgroup>
                {visibleCols.map(c => <col key={c.id} style={{ width: c.minWidth, minWidth: c.minWidth }} />)}
              </colgroup>
              <thead>
                <tr>
                  {visibleCols.map(c => (
                    <th key={c.id} className={`rll-th-pri-${c.priority}`}>{c.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {SAMPLE_ROWS.map((row, i) => (
                  <motion.tr key={i} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.02 * i }}>
                    {visibleCols.map(c => (
                      <td key={c.id} className={c.id === 'signal' ? `rll-signal rll-signal-${(row[c.id] || '').toLowerCase()}` : ''}>
                        {c.id === 'signal' ? (
                          <span className={`rll-signal-badge rll-sig-${(row[c.id] || '').toLowerCase()}`}>{row[c.id]}</span>
                        ) : c.id === 'score' ? (
                          <strong style={{ color: row.signal === 'BUY' ? '#22c55e' : row.signal === 'SELL' ? '#ef4444' : '#94a3b8' }}>{row[c.id]}</strong>
                        ) : row[c.id]}
                      </td>
                    ))}
                  </motion.tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="rll-scroll-indicator">← Scroll horizontally for more columns →</div>
        </div>

        {/* ── Card Grid ── */}
        <div className="rll-grid-section">
          <h3>Card Grid <span className="rll-hint">— 4→3→2→1 columns with container queries</span></h3>
          <div className="rll-card-grid">
            {SAMPLE_ROWS.map((row, i) => (
              <motion.div
                key={i}
                className="rll-card"
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.05 * i }}
              >
                <div className="rll-card-top">
                  <span className="rll-card-symbol">{row.symbol}</span>
                  <span className={`rll-card-score rll-sig-${row.signal.toLowerCase()}`}>{row.score}</span>
                </div>
                <div className="rll-card-meta">
                  <span>Conf: {row.confidence}%</span>
                  <span>{row.rarity}</span>
                </div>
                <div className="rll-card-footer">
                  <span>{row.protocol}</span>
                  <span className="rll-card-gate">Risk: {row.riskGate}</span>
                </div>
              </motion.div>
            ))}
          </div>
        </div>

        {/* ── Sidebar Layout ── */}
        <div className="rll-sidebar-section">
          <h3>Sidebar Layout <span className="rll-hint">— collapses to top on narrow screens</span></h3>
          <div className="rll-sidebar-layout">
            <aside className="rll-sidebar">
              <div className="rll-sidebar-item active">Dashboard</div>
              <div className="rll-sidebar-item">Signals</div>
              <div className="rll-sidebar-item">Risk</div>
              <div className="rll-sidebar-item">Research</div>
            </aside>
            <main className="rll-main-content">
              <p>This content area adapts based on available space. On narrow screens, the sidebar collapses to a horizontal nav bar above the content.</p>
              <div className="rll-stats-row">
                <div className="rll-stat">7 positions</div>
                <div className="rll-stat">85% BUY</div>
                <div className="rll-stat">Circuit: READY</div>
              </div>
            </main>
          </div>
        </div>

        {/* ── Breakpoint indicators ── */}
        <div className="rll-breakpoint-info">
          <h3>Active breakpoints for {device} ({deviceWidth}px)</h3>
          <div className="rll-bp-list">
            {BREAKPOINTS.map(b => (
              <span key={b.name} className={`rll-bp-tag ${b.name === device ? 'active' : ''} ${b.width <= deviceWidth ? 'rll-bp-active' : 'rll-bp-inactive'}`}>
                {b.name} ({b.width}px)
              </span>
            ))}
          </div>
          <p className="rll-hint">
            Strategy: columns with priority ≥4 hide at &lt;1024px, priority ≥3 at &lt;768px, priority ≥2 at &lt;480px.
            Users can override via column toggle settings above.
          </p>
        </div>
      </motion.div>
    </div>
  );
}
