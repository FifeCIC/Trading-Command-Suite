import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { useQuery } from '@tanstack/react-query';
import { apiGet } from '../core/api/client';
import { XTREND_SPEED_SYMBOLS, getSymbolCategory, SYMBOL_CATEGORIES } from '../data/xtrend-symbols';
import { SPEED_PROTOCOL_SYMBOLS, getProtocolsForSymbol } from '../data/speed-protocols';
import './speed-trading.css';

const SIZE_PRESETS = [1, 5, 10];
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
  { key: '1–3', action: 'Size preset ($1–$10)' },
  { key: '[ / ]', action: 'Decrease/increase size' },
  { key: 'Space', action: 'Pause data stream' },
  { key: 'Esc', action: 'Emergency lockout (30s)' },
  { key: 'F1', action: 'Toggle shortcut overlay' },
  { key: '`', action: 'Cycle timeframe' },
  { key: 'Tab', action: 'Cycle symbol' },
];

export default function SpeedTradingPage() {
  const [symbol, setSymbol] = useState('NVDA');
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

  // ── DB symbol check (for active/inactive status) ──
  const dbQuery = useQuery({
    queryKey: ['symbols'],
    queryFn: () => apiGet('/api/symbols').catch(() => ({ symbols: [] })),
    staleTime: 120_000,
    select: (data) => new Set((data?.symbols ?? []).map((s) => s.ticker.toUpperCase())),
  });
  const dbSymbols = dbQuery.data ?? new Set();

  // ── Best Opportunities Scanner ──
  const [scanData, setScanData] = useState(null);
  const [scanLoading, setScanLoading] = useState(false);
  const [scanError, setScanError] = useState(null);
  const [scanExpanded, setScanExpanded] = useState(true);
  const scanTimer = useRef(null);

  const currentSize = SIZE_PRESETS[sizePreset];
  const tfIndex = TIMEFRAMES.indexOf(timeframe);

  const addLog = useCallback((msg) => {
    setActionLog((prev) => [{ id: Date.now(), msg, time: new Date().toLocaleTimeString() }, ...prev].slice(0, 30));
  }, []);

  // ── Filtered symbols: protocol symbols only ──
  const filteredSymbols = useMemo(() => {
    // Master list = protocol-defined symbols (BTCUSD, XAUUSD, SPX500, etc.)
    let list = SPEED_PROTOCOL_SYMBOLS;

    if (symbolCat !== 'all') {
      list = list.filter((s) => getSymbolCategory(s) === symbolCat);
    }
    if (symbolFilter.trim()) {
      const q = symbolFilter.trim().toUpperCase();
      list = list.filter((s) => s.toUpperCase().includes(q));
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
        case key === '1': e.preventDefault(); setSizePreset(0); action = `Size → $${SIZE_PRESETS[0]}`; break;
        case key === '2': e.preventDefault(); setSizePreset(1); action = `Size → $${SIZE_PRESETS[1]}`; break;
        case key === '3': e.preventDefault(); setSizePreset(2); action = `Size → $${SIZE_PRESETS[2]}`; break;
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

  // ── Best Opportunities Scanner (polls every 5s) ──
  useEffect(() => {
    const doScan = async () => {
      if (paused || locked) return;
      try {
        const res = await fetch('http://localhost:3201/api/speed/scan', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ timeframe: '1m' }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        setScanData(data);
        setScanError(null);
      } catch (e) {
        setScanError(e.message);
      }
      setScanLoading(false);
    };

    setScanLoading(true);
    doScan();
    scanTimer.current = setInterval(doScan, 5000);
    return () => clearInterval(scanTimer.current);
  }, [paused, locked]);

  return (
    <div className="st-page" ref={pageRef}>
      {/* Lockout overlay */}
      {locked && (
        <div className="st-lockout">
          <motion.div className="st-lockout-box" initial={{ scale: 0.8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: 'spring', stiffness: 200, damping: 20 }}>
            <h1>🔒 LOCKED</h1>
            <p>All trading disabled — emergency lockout active</p>
            <div className="st-countdown">{lockCountdown}s</div>
          </motion.div>
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
              <span className="st-chart-price">
                {scanData?.scan?.find(s => s.symbol === symbol)
                  ? `${scanData.scan.find(s => s.symbol === symbol).signal} ${Math.round(scanData.scan.find(s => s.symbol === symbol).composite)}`
                  : '——'}
              </span>
            </div>
            <div className="st-chart-body">
              {scanData?.scan?.find(s => s.symbol === symbol) ? (
                <>
                  <p>🎯 {symbol} scored {Math.round(scanData.scan.find(s => s.symbol === symbol).composite)} via {scanData.scan.find(s => s.symbol === symbol).protocol}</p>
                  <p className="st-chart-sub">
                    Risk multiplier: {Math.round((scanData.scan.find(s => s.symbol === symbol).riskMultiplier || 1) * 100)}% · 
                    {scanData.scan.find(s => s.symbol === symbol).gated ? ' ⛔ GATED' : ' ✅ Active'}
                  </p>
                </>
              ) : (
                <>
                  <p>📊 {symbol} — no score yet. Select symbol and use keyboard shortcuts.</p>
                  <p className="st-chart-sub">Connect MT5 for live data. Scanner polls every 5s.</p>
                </>
              )}
            </div>
            <div className="st-session-markers">
              <span>🇺🇸 US Open 09:30</span>
              <span>🇪🇺 EU Open 08:00</span>
              <span>🇯🇵 JP Open 00:00</span>
              {scanData?.scanMs != null && (
                <span className="st-scan-age">Scan: {scanData.scanMs}ms</span>
              )}
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

      {/* ── Best Opportunities Scanner ── */}
      <div className={`st-scan-panel ${scanExpanded ? 'expanded' : 'collapsed'}`}>
        <div className="st-scan-header" onClick={() => setScanExpanded(e => !e)}>
          <span className="st-scan-title">
            🎯 Best Opportunities
            {scanData && <span className="st-scan-badge">{scanData.scan?.length || 0}</span>}
          </span>
          <span className="st-scan-toggle">{scanExpanded ? '▾' : '▸'}</span>
        </div>
        {scanExpanded && (
          <div className="st-scan-body">
            {scanError && (
              <div className="st-scan-error">Scanner offline — {scanError}</div>
            )}
            {scanLoading && !scanData && (
              <div className="st-scan-loading">Scanning…</div>
            )}
            {scanData && scanData.scan && scanData.scan.length > 0 ? (
              <>
                <div className="st-scan-top-row">
                  {scanData.scan.slice(0, 5).map((item, i) => (
                    <button
                      key={item.symbol}
                      className={`st-scan-card ${i === 0 ? 'top-pick' : ''} ${item.gated ? 'gated' : ''} ${item.symbol === symbol ? 'active' : ''}`}
                      onClick={() => { setSymbol(item.symbol); addLog(`🎯 Switched to ${item.symbol} (${item.signal} ${item.composite})`); }}
                      title={`${item.protocol} | Risk: ${Math.round(item.riskMultiplier * 100)}%`}
                    >
                      <div className="st-scan-rank">{i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `#${i + 1}`}</div>
                      <div className="st-scan-symbol">{item.symbol}</div>
                      <div className={`st-scan-score ${item.composite >= 65 ? 'strong' : item.composite >= 50 ? 'neutral' : 'weak'}`}>
                        {Math.round(item.composite)}
                      </div>
                      <div className={`st-scan-signal ${item.signal === 'BUY' ? 'buy' : item.signal === 'SELL' ? 'sell' : 'hold'}`}>
                        {item.signal}
                      </div>
                      {item.gated && <div className="st-scan-gated">⛔</div>}
                    </button>
                  ))}
                </div>
                {scanData.topPick && (
                  <div className="st-scan-top-label">
                    Top pick: <strong>{scanData.topPick}</strong> via {scanData.scan[0]?.protocol} · {scanData.scanMs}ms scan
                  </div>
                )}
                {scanData.skipped && scanData.skipped.length > 0 && (
                  <div className="st-scan-skipped">
                    ⚠ {scanData.skipped.length} skipped: {scanData.skipped.slice(0, 3).map(s => s.symbol).join(', ')}
                  </div>
                )}
              </>
            ) : (
              <div className="st-scan-empty">No symbols scored yet — running first scan…</div>
            )}
          </div>
        )}
      </div>

      {/* ── Action Log ── */}
      <div className="st-log">
        <div className="st-log-header">Action Log</div>
        <div className="st-log-entries">
          <AnimatePresence initial={false}>
          {actionLog.map((entry) => (
            <motion.div
              key={entry.id}
              className="st-log-entry"
              initial={{ opacity: 0, x: -10, height: 0 }}
              animate={{ opacity: 1, x: 0, height: 'auto' }}
              exit={{ opacity: 0, x: 10, height: 0 }}
              transition={{ duration: 0.2 }}
            >
              <span className="st-log-time">{entry.time}</span>
              <span className="st-log-msg">{entry.msg}</span>
            </motion.div>
          ))}
          </AnimatePresence>
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
