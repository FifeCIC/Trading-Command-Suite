import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { XTREND_SPEED_SYMBOLS, getSymbolCategory, SYMBOL_CATEGORIES } from '../data/xtrend-symbols';
import './speed-trading.css';

const SIZE_PRESETS = [100, 250, 500, 1000, 2500];
const TIMEFRAMES = ['1s', '5s', '15s', '30s', '1m'];
const SHORTCUTS = [
  { key: 'B', action: 'Buy market' },
  { key: 'S', action: 'Sell market' },
  { key: 'Shift+B', action: 'Buy 2x size' },
  { key: 'Shift+S', action: 'Sell 2x size' },
  { key: 'C', action: 'Close ALL positions' },
  { key: 'Shift+C', action: 'Close 50% of each' },
  { key: 'X', action: 'Close worst performer' },
  { key: 'Z', action: 'Reverse position' },
  { key: '1–5', action: 'Size preset ($100–$2500)' },
  { key: '[ / ]', action: 'Decrease/increase size' },
  { key: 'Space', action: 'Pause data stream' },
  { key: 'Esc', action: 'Emergency lockout (30s)' },
  { key: 'F1', action: 'Toggle shortcut overlay' },
  { key: '`', action: 'Cycle timeframe' },
  { key: 'Tab', action: 'Cycle symbol' },
];

export default function SpeedTradingPage() {
  const [symbol, setSymbol] = useState('EURUSD');
  const [symbolFilter, setSymbolFilter] = useState('');
  const [symbolCat, setSymbolCat] = useState('all');
  const [timeframe, setTf] = useState('1m');
  const [sizePreset, setSizePreset] = useState(2); // index into SIZE_PRESETS
  const [paused, setPaused] = useState(false);
  const [locked, setLocked] = useState(false);
  const [lockCountdown, setLockCountdown] = useState(0);
  const [overlayOpen, setOverlayOpen] = useState(false);
  const [flashKey, setFlashKey] = useState(null);
  const [lastAction, setLastAction] = useState(null);
  const [actionLog, setActionLog] = useState([]);
  const lockTimer = useRef(null);
  const pageRef = useRef(null);

  const currentSize = SIZE_PRESETS[sizePreset];
  const tfIndex = TIMEFRAMES.indexOf(timeframe);

  const addLog = useCallback((msg) => {
    setActionLog((prev) => [{ id: Date.now(), msg, time: new Date().toLocaleTimeString() }, ...prev].slice(0, 30));
  }, []);

  // ── Filtered symbols ──
  const filteredSymbols = useMemo(() => {
    let list = XTREND_SPEED_SYMBOLS;
    if (symbolCat !== 'all') {
      list = list.filter(s => getSymbolCategory(s) === symbolCat);
    }
    if (symbolFilter.trim()) {
      const q = symbolFilter.trim().toUpperCase();
      list = list.filter(s => s.toUpperCase().includes(q));
    }
    return list;
  }, [symbolCat, symbolFilter]);

  // Ensure current symbol is in filtered list
  useEffect(() => {
    if (!filteredSymbols.includes(symbol) && filteredSymbols.length > 0) {
      setSymbol(filteredSymbols[0]);
    }
  }, [filteredSymbols, symbol]);

  // ── Keyboard handler ──
  const handleKeyDown = useCallback(
    (e) => {
      if (locked) return;
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

      const key = e.key;
      const shift = e.shiftKey;
      let action = null;

      switch (true) {
        case key === 'b' && !shift:
          e.preventDefault();
          action = `BUY ${currentSize} ${symbol}`;
          break;
        case key === 's' && !shift:
          e.preventDefault();
          action = `SELL ${currentSize} ${symbol}`;
          break;
        case key === 'B' && shift:
          e.preventDefault();
          action = `BUY ${currentSize * 2} ${symbol} (2x)`;
          break;
        case key === 'S' && shift:
          e.preventDefault();
          action = `SELL ${currentSize * 2} ${symbol} (2x)`;
          break;
        case key === 'c' && !shift:
          e.preventDefault();
          action = 'CLOSE ALL positions';
          break;
        case key === 'C' && shift:
          e.preventDefault();
          action = 'CLOSE 50% of each position';
          break;
        case key === 'x':
          e.preventDefault();
          action = 'CLOSE worst performer';
          break;
        case key === 'z':
          e.preventDefault();
          action = 'REVERSE position';
          break;
        case key === ']':
          e.preventDefault();
          setSizePreset((p) => Math.min(SIZE_PRESETS.length - 1, p + 1));
          action = `Size preset → $${SIZE_PRESETS[Math.min(SIZE_PRESETS.length - 1, sizePreset + 1)]}`;
          break;
        case key === '[':
          e.preventDefault();
          setSizePreset((p) => Math.max(0, p - 1));
          action = `Size preset → $${SIZE_PRESETS[Math.max(0, sizePreset - 1)]}`;
          break;
        case key === '1': e.preventDefault(); setSizePreset(0); action = 'Size → $100'; break;
        case key === '2': e.preventDefault(); setSizePreset(1); action = 'Size → $250'; break;
        case key === '3': e.preventDefault(); setSizePreset(2); action = 'Size → $500'; break;
        case key === '4': e.preventDefault(); setSizePreset(3); action = 'Size → $1000'; break;
        case key === '5': e.preventDefault(); setSizePreset(4); action = 'Size → $2500'; break;
        case key === ' ':
          e.preventDefault();
          setPaused((p) => !p);
          action = paused ? 'RESUMED data stream' : 'PAUSED data stream';
          break;
        case key === 'Escape':
          e.preventDefault();
          setLocked(true);
          setLockCountdown(30);
          action = '🔒 EMERGENCY LOCKOUT — 30s';
          break;
        case key === 'F1':
          e.preventDefault();
          setOverlayOpen((o) => !o);
          break;
        case key === '`':
          e.preventDefault();
          setTf((t) => {
            const i = TIMEFRAMES.indexOf(t);
            return TIMEFRAMES[(i + 1) % TIMEFRAMES.length];
          });
          break;
        case key === 'Tab':
          e.preventDefault();
          setSymbol((s) => {
            const idx = filteredSymbols.indexOf(s);
            return filteredSymbols[(idx + 1) % filteredSymbols.length];
          });
          break;
        default:
          break;
      }

      if (action) {
        setFlashKey(key);
        setLastAction(action);
        addLog(action);
        setTimeout(() => setFlashKey(null), 200);
      }
    },
    [locked, symbol, currentSize, sizePreset, paused],
  );

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  // Lockout countdown
  useEffect(() => {
    if (locked && lockCountdown > 0) {
      lockTimer.current = setTimeout(() => setLockCountdown((c) => c - 1), 1000);
      return () => clearTimeout(lockTimer.current);
    }
    if (locked && lockCountdown === 0) {
      setLocked(false);
      addLog('🔓 Lockout expired — trading re-enabled');
    }
  }, [locked, lockCountdown, addLog]);

  return (
    <div className="st-page" ref={pageRef}>
      {/* Lockout overlay */}
      {locked && (
        <div className="st-lockout">
          <div className="st-lockout-box">
            <h1>🔒 LOCKED</h1>
            <p>All trading disabled — emergency lockout active</p>
            <div className="st-countdown">{lockCountdown}s</div>
          </div>
        </div>
      )}

      {/* Pause indicator */}
      {paused && !locked && (
        <div className="st-pause-banner">⏸ DATA STREAM PAUSED — no new orders accepted</div>
      )}

      {/* MT5 warning */}
      <div className="st-fallback-banner">
        ⚠ MT5 second-level data not available — using 1m minimum. Speed trade on 1m candles.
      </div>

      {/* ── Speed Controls ── */}
      <header className="st-controls">
        <div className="st-controls-left">
          <label>
            <span className="st-label">Symbol:</span>
            <select value={symbol} onChange={(e) => setSymbol(e.target.value)} className="st-select">
              <optgroup label="── Categories ──">
                <option value="">Search/filter below…</option>
              </optgroup>
              {filteredSymbols.map(s => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </label>
          <input
            type="search"
            className="st-symbol-search"
            placeholder="Filter symbols…"
            value={symbolFilter}
            onChange={e => setSymbolFilter(e.target.value)}
          />
          <div className="st-cat-row">
            <button className={`st-cat-btn ${symbolCat === 'all' ? 'active' : ''}`} onClick={() => setSymbolCat('all')}>All</button>
            {Object.entries(SYMBOL_CATEGORIES).map(([id, cat]) => (
              <button key={id} className={`st-cat-btn ${symbolCat === id ? 'active' : ''}`} onClick={() => setSymbolCat(id)} title={cat.label}>
                {cat.icon}
              </button>
            ))}
          </div>
          <span className="st-symbol-count">{filteredSymbols.length} symbols</span>
          <div className="st-tf-row">
            <span className="st-label">TF:</span>
            {TIMEFRAMES.map((tf) => (
              <button
                key={tf}
                className={`st-tf-btn ${tf === timeframe ? 'active' : ''}`}
                onClick={() => setTf(tf)}
              >
                {tf}
              </button>
            ))}
          </div>
        </div>
        <div className="st-controls-center">
          <span className="st-pos-label">Size:</span>
          <select value={sizePreset} onChange={(e) => setSizePreset(Number(e.target.value))} className="st-select st-select--sm">
            {SIZE_PRESETS.map((s, i) => <option key={s} value={i}>${s}</option>)}
          </select>
          <button
            className={`st-action-btn st-buy ${flashKey === 'b' ? 'st-flash-green' : ''}`}
            onClick={() => handleKeyDown({ key: 'b', shiftKey: false, preventDefault: () => {}, target: { tagName: 'DIV' } })}
          >
            B Buy
          </button>
          <button
            className={`st-action-btn st-sell ${flashKey === 's' ? 'st-flash-red' : ''}`}
            onClick={() => handleKeyDown({ key: 's', shiftKey: false, preventDefault: () => {}, target: { tagName: 'DIV' } })}
          >
            S Sell
          </button>
        </div>
        <div className="st-controls-right">
          <button className="st-meta-btn" onClick={() => setOverlayOpen((o) => !o)} title="Shortcuts (F1)">⌨</button>
        </div>
      </header>

      {/* ── Main Layout ── */}
      <div className="st-main">
        {/* Chart area */}
        <div className="st-chart">
          <div className="st-chart-placeholder">
            <div className="st-chart-header">
              <span>{symbol} · {timeframe}</span>
              <span className="st-chart-price">——</span>
            </div>
            <div className="st-chart-body">
              <p>📊 Chart area — connect MT5 for live candlestick data</p>
              <p className="st-chart-sub">Keyboard shortcuts active. Select symbol and timeframe above.</p>
            </div>
            <div className="st-session-markers">
              <span>🇺🇸 US Open 09:30</span>
              <span>🇪🇺 EU Open 08:00</span>
              <span>🇯🇵 JP Open 00:00</span>
            </div>
          </div>
        </div>

        {/* Order Panel */}
        <div className="st-order-panel">
          <div className="st-order-section">
            <h3>Active Position</h3>
            <p className="st-no-pos">No open position</p>
          </div>

          <div className="st-order-section">
            <h3>Quick Actions</h3>
            <div className="st-quick-actions">
              <button className="st-btn st-btn-danger" onClick={() => handleKeyDown({ key: 'c', shiftKey: false, preventDefault: () => {}, target: { tagName: 'DIV' } })}>Close All</button>
              <button className="st-btn st-btn-warn" onClick={() => handleKeyDown({ key: 'z', shiftKey: false, preventDefault: () => {}, target: { tagName: 'DIV' } })}>Reverse</button>
            </div>
          </div>

          <div className="st-order-section">
            <h3>Size Presets</h3>
            <div className="st-size-grid">
              {SIZE_PRESETS.map((s, i) => (
                <button
                  key={s}
                  className={`st-size-btn ${i === sizePreset ? 'active' : ''}`}
                  onClick={() => setSizePreset(i)}
                >
                  {i + 1}: ${s}
                </button>
              ))}
            </div>
          </div>

          <div className="st-order-section">
            <h3>Safety</h3>
            <div className="st-safety-row">
              <button
                className={`st-btn ${paused ? 'st-btn-active' : ''}`}
                onClick={() => handleKeyDown({ key: ' ', shiftKey: false, preventDefault: () => {}, target: { tagName: 'DIV' } })}
              >
                {paused ? '▶ Resume' : '⏸ Pause'}
              </button>
              <button
                className="st-btn st-btn-danger"
                onClick={() => handleKeyDown({ key: 'Escape', shiftKey: false, preventDefault: () => {}, target: { tagName: 'DIV' } })}
              >
                🔒 Lock
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* ── Action Log ── */}
      <div className="st-log">
        <div className="st-log-header">Action Log</div>
        <div className="st-log-entries">
          {actionLog.map((entry) => (
            <div key={entry.id} className="st-log-entry">
              <span className="st-log-time">{entry.time}</span>
              <span className="st-log-msg">{entry.msg}</span>
            </div>
          ))}
        </div>
      </div>

      {/* ── Keyboard Overlay ── */}
      {overlayOpen && (
        <div className="st-overlay" onClick={() => setOverlayOpen(false)}>
          <div className="st-overlay-box" onClick={(e) => e.stopPropagation()}>
            <h2>⌨ Keyboard Shortcuts</h2>
            <table className="st-shortcut-table">
              <thead><tr><th>Key</th><th>Action</th></tr></thead>
              <tbody>
                {SHORTCUTS.map((s) => (
                  <tr key={s.key}>
                    <td><kbd>{s.key}</kbd></td>
                    <td>{s.action}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <button className="st-close-overlay" onClick={() => setOverlayOpen(false)}>Close (F1)</button>
          </div>
        </div>
      )}

      {/* Last action flash */}
      {lastAction && (
        <div className="st-last-action" key={lastAction}>
          {lastAction}
        </div>
      )}
    </div>
  );
}
