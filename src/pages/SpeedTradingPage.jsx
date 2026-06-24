import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { useQuery } from '@tanstack/react-query';
import { apiGet } from '../core/api/client';
import { XTREND_SPEED_SYMBOLS, getSymbolCategory, SYMBOL_CATEGORIES } from '../data/xtrend-symbols';
import { getProtocolsForSymbol } from '../data/speed-protocols';
import SpeedChart from '../components/SpeedChart';
import './speed-trading.css';

const SIZE_PRESETS = [1, 5, 10];
// tick = poll MT5 quote (bid/ask) at that interval; 1m+ = MT5 candles
const TIMEFRAMES = ['1s', '5s', '15s', '1m', '5m'];
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
  { key: '?', action: '1s–15s = quote poll; 1m–5m = MT5 candles' },
];

export default function SpeedTradingPage() {
  const [symbol, setSymbol] = useState(() => {
    try { return localStorage.getItem('st-symbol') || 'EURUSD'; } catch { return 'EURUSD'; }
  });
  const [symbolFilter, setSymbolFilter] = useState('');
  const [symbolCat, setSymbolCat] = useState('all');
  const [timeframe, setTf] = useState('1s');
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

  // ── Speed-trading symbols from DB (tagged with "speed-trading") ──
  const speedSymbolsQuery = useQuery({
    queryKey: ['speed-trading-symbols'],
    queryFn: () => apiGet('/api/symbols?tag=speed-trading').catch(() => ({ symbols: [] })),
    staleTime: 120_000,
    select: (data) => {
      const syms = data?.symbols ?? [];
      return syms.map((s) => s.ticker.toUpperCase());
    },
  });
  const speedTradingSymbols = speedSymbolsQuery.data ?? [];

  // ── Tick Recorder state ────────────────────────────
  const [isRecording, setIsRecording] = useState(false);
  const [recBarCount, setRecBarCount] = useState(0);
  const recordingRef = useRef(false);

  // Poll active recordings to sync UI state
  const activeRecQuery = useQuery({
    queryKey: ['speed-recording-active'],
    queryFn: () => apiGet('/api/speed/record/active').catch(() => ({ recordings: [] })),
    refetchInterval: 3000,
    staleTime: 2000,
  });
  const activeRecordings = activeRecQuery.data?.recordings ?? [];

  // Sync isRecording with actual backend state
  useEffect(() => {
    const active = activeRecordings.find((r) => r.ticker === symbol.toUpperCase());
    if (active) {
      setIsRecording(true);
      setRecBarCount(active.barCount);
      recordingRef.current = true;
    } else {
      setIsRecording(false);
      setRecBarCount(0);
      recordingRef.current = false;
    }
  }, [activeRecordings, symbol]);

  const toggleRecording = async () => {
    const endpoint = isRecording ? '/api/speed/record/stop' : '/api/speed/record/start';
    try {
      await fetch(`http://localhost:3201${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbol }),
      });
      activeRecQuery.refetch();
    } catch { /* silent */ }
  };

  // ── Live quote polling ─────────────────────────────
  const tfToMs = { '1s': 1000, '5s': 5000, '15s': 15000, '1m': 60000, '5m': 300000 };
  const quoteQuery = useQuery({
    queryKey: ['speed-quote', symbol],
    queryFn: () => apiGet(`/api/speed/quote/${symbol}`).catch(() => null),
    refetchInterval: tfToMs[timeframe] ?? 1000,
    staleTime: 500,
    enabled: !!symbol,
  });
  const quote = quoteQuery.data;

  // ── Tick history (last 20 mid prices for sparkline) ──
  const [tickHistory, setTickHistory] = useState([]);
  const prevMid = useRef(null);
  useEffect(() => {
    if (quote?.mid != null) {
      setTickHistory((prev) => {
        const next = [...prev, { mid: quote.mid, t: Date.now() }];
        return next.slice(-30);
      });
      prevMid.current = quote.mid;
    }
  }, [quote?.mid]);

  // Persist selected symbol across page refreshes
  useEffect(() => {
    try { localStorage.setItem('st-symbol', symbol); } catch {}
  }, [symbol]);

  // ── Best Opportunities Scanner ──
  const [scanData, setScanData] = useState(null);
  const [scanLoading, setScanLoading] = useState(false);
  const [scanError, setScanError] = useState(null);
  const [scanExpanded, setScanExpanded] = useState(true);
  const [chartMode, setChartMode] = useState('candles'); // 'candles' | 'line' | 'minimal'
  const [chartSettingsOpen, setChartSettingsOpen] = useState(false);
  const [chartSettings, setChartSettings] = useState({
    showVolume: true, showEMA9: true, showEMA21: true, showEMA50: false,
    gridStyle: 1, upColor: '#22c55e', downColor: '#ef4444',
  });
  const scanTimer = useRef(null);

  // ── Protocol directive panel ──
  const [protocolDetail, setProtocolDetail] = useState(null);
  const protocolsForSymbol = useMemo(() => getProtocolsForSymbol(symbol), [symbol]);
  const activeProtocol = protocolsForSymbol[0]; // Tick Scalp style preferred over Day Trade/Monitor

  // Fetch protocol details when symbol or protocol changes
  useEffect(() => {
    if (!activeProtocol) { setProtocolDetail(null); return; }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('http://localhost:3201/api/scoring/gated/protocols');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        const proto = (data.protocols || []).find(p => p.id === activeProtocol.id);
        if (!cancelled) setProtocolDetail(proto || null);
      } catch {
        if (!cancelled) setProtocolDetail(null);
      }
    })();
    return () => { cancelled = true; };
  }, [symbol, activeProtocol?.id]);

  const currentSize = SIZE_PRESETS[sizePreset];
  const tfIndex = TIMEFRAMES.indexOf(timeframe);

  const addLog = useCallback((msg) => {
    setActionLog((prev) => [{ id: Date.now(), msg, time: new Date().toLocaleTimeString() }, ...prev].slice(0, 30));
  }, []);

  // ── Filtered symbols: from DB tag "speed-trading" ──
  const filteredSymbols = useMemo(() => {
    let list = speedTradingSymbols.length > 0 ? speedTradingSymbols : [];

    if (symbolCat !== 'all') {
      list = list.filter((s) => getSymbolCategory(s) === symbolCat);
    }
    if (symbolFilter.trim()) {
      const q = symbolFilter.trim().toUpperCase();
      list = list.filter((s) => s.toUpperCase().includes(q));
    }
    return list;
  }, [speedTradingSymbols, symbolCat, symbolFilter]);

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
          body: JSON.stringify({ timeframe: timeframe }),
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

      {/* MT5 sub-minute warning — only when relevant */}
      {(timeframe === '1s' || timeframe === '5s' || timeframe === '15s' || timeframe === '30s') && (
        <div className="st-fallback-banner">
          ⚠ MT5 minimum is 1m candles — displaying {timeframe} chart using 1m data.
        </div>
      )}

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
            {/* Recording toggle */}
            <button
              className={`st-cat-btn st-rec-btn ${isRecording ? 'recording' : ''}`}
              onClick={toggleRecording}
              title={isRecording ? `Recording ${recBarCount} 5s bars — click to stop` : 'Start recording 5s candles'}
            >
              {isRecording ? '⏺' : '⏺'} {isRecording ? recBarCount : 'Rec'}
            </button>
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
          <div className="st-chart-toggle">
            <button className={`st-chart-mode-btn ${chartMode === 'candles' ? 'active' : ''}`} onClick={() => setChartMode('candles')} title="Candlestick chart">🕯</button>
            <button className={`st-chart-mode-btn ${chartMode === 'line' ? 'active' : ''}`} onClick={() => setChartMode('line')} title="Line chart">📈</button>
            <button className={`st-chart-mode-btn ${chartMode === 'minimal' ? 'active' : ''}`} onClick={() => setChartMode('minimal')} title="Minimal (no chart)">◻</button>
          </div>
          <button className="st-meta-btn" onClick={() => setChartSettingsOpen(o => !o)} title="Chart settings">⚙</button>
          <button className="st-meta-btn" onClick={() => setOverlayOpen((o) => !o)} title="Shortcuts (F1)">⌨</button>
        </div>
      </header>

      {/* ── Main Layout ── */}
      <div className="st-main">
        {/* ── Protocol Directives Panel ── */}
        <div className="st-directives">
          {protocolDetail ? (
            <>
              <div className="st-dir-header">
                <div className="st-dir-protocol-name">{protocolDetail.name}</div>
                <div className="st-dir-protocol-style">{protocolDetail.tradingStyle || activeProtocol?.style}</div>
                {protocolDetail.groups && (
                  <div className="st-dir-risk-info">
                    Risk gate: {protocolDetail.groups.filter(g => g.isRiskGate).map(g => `${Math.round(g.minMultiplier * 100)}–${Math.round(g.maxMultiplier * 100)}%`).join(', ')}
                  </div>
                )}
              </div>
              <div className="st-dir-groups">
                {protocolDetail.groups && protocolDetail.groups.map(group => (
                  <div key={group.id} className={`st-dir-group ${group.isRiskGate ? 'risk' : ''}`}>
                    <div className="st-dir-group-name">
                      {group.name}
                      {group.isRiskGate && <span className="st-dir-gate-tag">GATE</span>}
                    </div>
                    <div className="st-dir-group-weight">{Math.round(group.weight * 100)}% weight</div>
                    <ul className="st-dir-list">
                      {group.directives.map(d => (
                        <li key={d.id} className={`st-dir-item ${d.maxScore !== 100 ? 'variable' : ''}`}>
                          <code className="st-dir-id">{d.id}</code>
                          {d.maxScore !== 100 && <span className="st-dir-max">{d.maxScore}</span>}
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div className="st-dir-empty">
              <p>Select a symbol to see its protocol directives</p>
            </div>
          )}
        </div>

        {/* ── Live Price Ticker ── */}
        <div className="st-price-strip">
          <span className="st-price-symbol">{symbol}</span>
          <span className={`st-price-mid ${quote?.mid != null && prevMid.current != null && quote.mid > prevMid.current ? 'up' : quote?.mid != null && prevMid.current != null && quote.mid < prevMid.current ? 'down' : ''}`}>
            {quote?.mid != null ? quote.mid.toFixed(5) : '—'}
          </span>
          <span className="st-price-bid">{quote?.bid != null ? quote.bid.toFixed(5) : '—'}</span>
          <span className="st-price-ask">{quote?.ask != null ? quote.ask.toFixed(5) : '—'}</span>
          {quote?.spread != null && <span className="st-price-spread">{quote.spread.toFixed(5)}</span>}
          {/* Mini sparkline from tick history */}
          <svg className="st-sparkline" viewBox="0 0 100 20" preserveAspectRatio="none">
            <polyline
              fill="none"
              stroke="var(--accent)"
              strokeWidth="1.5"
              points={(() => {
                if (tickHistory.length < 2) return '';
                const mids = tickHistory.map(t => t.mid);
                const min = Math.min(...mids);
                const max = Math.max(...mids);
                const range = max - min || 1;
                return tickHistory.map((t, i) => {
                  const x = (i / (tickHistory.length - 1)) * 100;
                  const y = 20 - ((t.mid - min) / range) * 18;
                  return `${x},${y}`;
                }).join(' ');
              })()}
            />
          </svg>
        </div>

        {/* Chart area */}
        <div className="st-chart">
          <SpeedChart symbol={symbol} timeframe={timeframe} chartMode={chartMode} scanScore={scanData} chartSettings={chartSettings} />
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

      {/* ── Chart Settings Modal ── */}
      {chartSettingsOpen && (
        <div className="st-overlay" onClick={() => setChartSettingsOpen(false)}>
          <div className="st-overlay-box" onClick={e => e.stopPropagation()} style={{ maxWidth: 340 }}>
            <h2 style={{ marginBottom: 12 }}>⚙ Chart Settings</h2>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, fontSize: '0.78rem' }}>
              {/* Indicators */}
              <div style={{ fontWeight: 700, color: '#94a3b8', fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Indicators</div>
              <label className="st-chart-setting"><span>Volume histogram</span><input type="checkbox" checked={chartSettings.showVolume} onChange={e => setChartSettings(s => ({ ...s, showVolume: e.target.checked }))} /></label>
              <label className="st-chart-setting"><span>EMA 9</span><input type="checkbox" checked={chartSettings.showEMA9} onChange={e => setChartSettings(s => ({ ...s, showEMA9: e.target.checked }))} /></label>
              <label className="st-chart-setting"><span>EMA 21</span><input type="checkbox" checked={chartSettings.showEMA21} onChange={e => setChartSettings(s => ({ ...s, showEMA21: e.target.checked }))} /></label>
              <label className="st-chart-setting"><span>EMA 50</span><input type="checkbox" checked={chartSettings.showEMA50} onChange={e => setChartSettings(s => ({ ...s, showEMA50: e.target.checked }))} /></label>

              {/* Appearance */}
              <div style={{ fontWeight: 700, color: '#94a3b8', fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.5px', marginTop: 4 }}>Appearance</div>
              <div className="st-chart-setting">
                <span>Grid lines</span>
                <select value={chartSettings.gridStyle} onChange={e => setChartSettings(s => ({ ...s, gridStyle: Number(e.target.value) }))}>
                  <option value={0}>Off</option>
                  <option value={1}>Dotted</option>
                  <option value={2}>Solid</option>
                </select>
              </div>

              {/* Colors */}
              <div style={{ fontWeight: 700, color: '#94a3b8', fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.5px', marginTop: 4 }}>Colors</div>
              <div className="st-chart-setting">
                <span>Bull candle</span>
                <input type="color" value={chartSettings.upColor} onChange={e => setChartSettings(s => ({ ...s, upColor: e.target.value }))} style={{ width: 32, height: 22, border: 'none', borderRadius: 4, cursor: 'pointer' }} />
              </div>
              <div className="st-chart-setting">
                <span>Bear candle</span>
                <input type="color" value={chartSettings.downColor} onChange={e => setChartSettings(s => ({ ...s, downColor: e.target.value }))} style={{ width: 32, height: 22, border: 'none', borderRadius: 4, cursor: 'pointer' }} />
              </div>
            </div>

            <div style={{ marginTop: 14, display: 'flex', gap: 8 }}>
              <button className="st-btn" onClick={() => { setChartSettings({ showVolume: true, showEMA9: true, showEMA21: true, showEMA50: false, gridStyle: 1, upColor: '#22c55e', downColor: '#ef4444' }); }}>Reset defaults</button>
              <button className="st-btn" onClick={() => setChartSettingsOpen(false)}>Close</button>
            </div>
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
