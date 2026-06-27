/**
 * Bitcoin Speed Trading Page
 * ===========================
 * Focused BTC scalping cockpit. Locked to BTCUSD with the btc-scalp-v1 protocol.
 * Includes the SpeedDecisionPanel for multi-timeframe trend + micro S/R context.
 *
 * URL: /trading/btc-speed
 */

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { motion } from 'motion/react';
import { useQuery } from '@tanstack/react-query';
import { apiGet } from '../core/api/client';
import SpeedChart from '../components/SpeedChart';
import SpeedDecisionPanel from '../components/SpeedDecisionPanel';
import './btc-speed.css';

const SYMBOL = 'BTCUSD';
const SIZE_PRESETS = [1, 5, 10];
const TIMEFRAMES = ['1s', '5s', '15s', '1m', '5m'];

export default function BtcSpeedTradingPage() {
  const [sizePreset, setSizePreset] = useState(0);
  const [timeframe, setTf] = useState('5s');
  const [paused, setPaused] = useState(false);
  const [locked, setLocked] = useState(false);
  const [lockCountdown, setLockCountdown] = useState(0);
  const [flashKey, setFlashKey] = useState(null);
  const [lastAction, setLastAction] = useState(null);
  const [actionLog, setActionLog] = useState([]);
  const [chartMode, setChartMode] = useState('candles');
  const [chartSettings, setChartSettings] = useState({
    showVolume: true, showEMA9: true, showEMA21: true, showEMA50: false,
    gridStyle: 1, upColor: '#22c55e', downColor: '#ef4444',
  });
  const [isRecording, setIsRecording] = useState(false);
  const [recBarCount, setRecBarCount] = useState(0);

  const lockTimer = useRef(null);
  const pageRef = useRef(null);
  const prevMid = useRef(null);
  const recordingRef = useRef(false);

  // ── Live quote ──────────────────────────────────────
  const tfToMs = { '1s': 1000, '5s': 5000, '15s': 15000, '1m': 60000, '5m': 300000 };
  const quoteQuery = useQuery({
    queryKey: ['btc-speed-quote'],
    queryFn: () => apiGet(`/api/speed/quote/${SYMBOL}`).catch(() => null),
    refetchInterval: tfToMs[timeframe] ?? 1000,
    staleTime: 500,
  });
  const quote = quoteQuery.data;

  // ── Tick history ────────────────────────────────────
  const [tickHistory, setTickHistory] = useState([]);
  useEffect(() => {
    if (quote?.mid != null) {
      setTickHistory((prev) => {
        const next = [...prev, { mid: quote.mid, t: Date.now() }];
        return next.slice(-30);
      });
      prevMid.current = quote.mid;
    }
  }, [quote?.mid]);

  // ── Best Opportunities Scanner ──────────────────────
  const [scanData, setScanData] = useState(null);
  const [scanError, setScanError] = useState(null);
  const [scanExpanded, setScanExpanded] = useState(true);

  useEffect(() => {
    const doScan = async () => {
      if (paused || locked) return;
      try {
        const res = await fetch('http://localhost:3201/api/speed/scan', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ timeframe, symbols: ['BTCUSD'] }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        setScanData(await res.json());
        setScanError(null);
      } catch (e) {
        setScanError(e.message);
      }
    };
    doScan();
    const interval = setInterval(doScan, 5000);
    return () => clearInterval(interval);
  }, [paused, locked, timeframe]);

  // ── Tick Recording ──────────────────────────────────
  const activeRecQuery = useQuery({
    queryKey: ['btc-rec-active'],
    queryFn: () => apiGet('/api/speed/record/active').catch(() => []),
    refetchInterval: 5000,
  });
  const activeRecordings = activeRecQuery.data ?? [];

  useEffect(() => {
    const active = (Array.isArray(activeRecordings) ? activeRecordings : []).find(
      r => r.symbol === SYMBOL || r.ticker === SYMBOL
    );
    if (active) {
      setIsRecording(true);
      setRecBarCount(active.barCount ?? 0);
      recordingRef.current = true;
    } else {
      setIsRecording(false);
      setRecBarCount(0);
      recordingRef.current = false;
    }
  }, [activeRecordings]);

  const toggleRecording = async () => {
    const endpoint = isRecording ? '/api/speed/record/stop' : '/api/speed/record/start';
    try {
      await fetch(`http://localhost:3201${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbol: SYMBOL }),
      });
      activeRecQuery.refetch();
    } catch { /* silent */ }
  };

  // ── Logging ─────────────────────────────────────────
  const addLog = useCallback((msg) => {
    setActionLog((prev) => [{ id: Date.now(), msg, time: new Date().toLocaleTimeString() }, ...prev].slice(0, 20));
  }, []);

  const currentSize = SIZE_PRESETS[sizePreset];

  // ── Keyboard handler ────────────────────────────────
  const handleKeyDown = useCallback((e) => {
    if (locked) return;
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

    const key = e.key;
    let action = null;

    switch (true) {
      case key === 'b': e.preventDefault(); action = `BUY $${currentSize} BTC`; break;
      case key === 's': e.preventDefault(); action = `SELL $${currentSize} BTC`; break;
      case key === 'c': e.preventDefault(); action = 'CLOSE ALL'; break;
      case key === 'x': e.preventDefault(); action = 'CLOSE worst'; break;
      case key === ']': e.preventDefault(); setSizePreset(p => Math.min(2, p + 1)); break;
      case key === '[': e.preventDefault(); setSizePreset(p => Math.max(0, p - 1)); break;
      case key === '1': e.preventDefault(); setSizePreset(0); break;
      case key === '2': e.preventDefault(); setSizePreset(1); break;
      case key === '3': e.preventDefault(); setSizePreset(2); break;
      case key === ' ': e.preventDefault(); setPaused(p => !p); action = paused ? 'RESUMED' : 'PAUSED'; break;
      case key === 'Escape': e.preventDefault(); setLocked(true); setLockCountdown(30); action = '🔒 LOCKED 30s'; break;
      case key === '`': e.preventDefault(); setTf(t => { const i = TIMEFRAMES.indexOf(t); return TIMEFRAMES[(i + 1) % TIMEFRAMES.length]; }); break;
      default: break;
    }

    if (action) {
      setFlashKey(key);
      setLastAction(action);
      addLog(action);
      setTimeout(() => setFlashKey(null), 200);
    }
  }, [locked, currentSize, paused]);

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  // Lockout countdown
  useEffect(() => {
    if (locked && lockCountdown > 0) {
      lockTimer.current = setTimeout(() => setLockCountdown(c => c - 1), 1000);
      return () => clearTimeout(lockTimer.current);
    }
    if (locked && lockCountdown === 0) {
      setLocked(false);
      addLog('🔓 Lockout expired');
    }
  }, [locked, lockCountdown, addLog]);

  return (
    <div className="btc-page" ref={pageRef}>
      {/* Lockout overlay */}
      {locked && (
        <div className="btc-lockout">
          <motion.div className="btc-lockout-box" initial={{ scale: 0.8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}>
            <h1>🔒 LOCKED</h1>
            <p>Emergency lockout — {lockCountdown}s</p>
          </motion.div>
        </div>
      )}

      {paused && !locked && (
        <div className="btc-pause-banner">⏸ PAUSED — no new orders</div>
      )}

      {/* ── Header ────────────────────────────────────── */}
      <header className="btc-header">
        <div className="btc-header-left">
          <h1 className="btc-title">
            ₿ Bitcoin Speed
            <span className={`btc-live-dot ${!paused ? 'live' : ''}`} />
          </h1>
          <div className="btc-tf-row">
            {TIMEFRAMES.map(tf => (
              <button key={tf} className={`btc-tf-btn ${tf === timeframe ? 'active' : ''}`} onClick={() => setTf(tf)}>
                {tf}
              </button>
            ))}
          </div>
        </div>
        <div className="btc-header-center">
          <span className="btc-size-label">Size:</span>
          <select value={sizePreset} onChange={e => setSizePreset(Number(e.target.value))} className="btc-size-select">
            {SIZE_PRESETS.map((s, i) => <option key={s} value={i}>${s}</option>)}
          </select>
          <button className={`btc-action-btn btc-buy ${flashKey === 'b' ? 'flash' : ''}`} onClick={() => handleKeyDown({ key: 'b', preventDefault: () => {}, target: {} })}>
            B Buy
          </button>
          <button className={`btc-action-btn btc-sell ${flashKey === 's' ? 'flash' : ''}`} onClick={() => handleKeyDown({ key: 's', preventDefault: () => {}, target: {} })}>
            S Sell
          </button>
        </div>
        <div className="btc-header-right">
          <button className={`btc-meta-btn ${isRecording ? 'recording' : ''}`} onClick={toggleRecording} title={isRecording ? `Recording ${recBarCount} 5s bars` : 'Start 5s recording'}>
            {isRecording ? `⏺ ${recBarCount}` : '⏺ Rec'}
          </button>
          <div className="btc-chart-toggle">
            <button className={`btc-chart-btn ${chartMode === 'candles' ? 'active' : ''}`} onClick={() => setChartMode('candles')}>🕯</button>
            <button className={`btc-chart-btn ${chartMode === 'line' ? 'active' : ''}`} onClick={() => setChartMode('line')}>📈</button>
            <button className={`btc-chart-btn ${chartMode === 'minimal' ? 'active' : ''}`} onClick={() => setChartMode('minimal')}>◻</button>
          </div>
        </div>
      </header>

      {/* ── Price Strip ────────────────────────────────── */}
      <div className="btc-price-strip">
        <span className="btc-price-symbol">{SYMBOL}</span>
        <span className={`btc-price-mid ${quote?.mid != null && prevMid.current != null && quote.mid > prevMid.current ? 'up' : quote?.mid != null && prevMid.current != null && quote.mid < prevMid.current ? 'down' : ''}`}>
          {quote?.mid != null ? `$${quote.mid.toFixed(1)}` : '—'}
        </span>
        <span className="btc-price-bid">{quote?.bid != null ? quote.bid.toFixed(1) : '—'}</span>
        <span className="btc-price-ask">{quote?.ask != null ? quote.ask.toFixed(1) : '—'}</span>
        {quote?.spread != null && <span className="btc-price-spread">{quote.spread.toFixed(1)}</span>}

        {/* Sparkline */}
        <svg className="btc-sparkline" viewBox="0 0 100 20" preserveAspectRatio="none">
          <polyline fill="none" stroke="var(--accent)" strokeWidth="1.5"
            points={(() => {
              if (tickHistory.length < 2) return '';
              const mids = tickHistory.map(t => t.mid);
              const min = Math.min(...mids);
              const max = Math.max(...mids);
              const range = max - min || 1;
              return tickHistory.map((t, i) => `${(i / (tickHistory.length - 1)) * 100},${20 - ((t.mid - min) / range) * 18}`).join(' ');
            })()}
          />
        </svg>
      </div>

      {/* ── Decision Panel + Chart ─────────────────────── */}
      <div className="btc-main">
        <div className="btc-decision">
          <SpeedDecisionPanel symbol={SYMBOL} />
        </div>
        <div className="btc-chart">
          <SpeedChart symbol={SYMBOL} timeframe={timeframe} chartMode={chartMode} scanScore={scanData} chartSettings={chartSettings} />
        </div>
      </div>

      {/* ── Best Opportunities ─────────────────────────── */}
      <div className={`btc-scan ${scanExpanded ? 'expanded' : ''}`}>
        <div className="btc-scan-header" onClick={() => setScanExpanded(e => !e)}>
          <span>🎯 Best Opportunities</span>
          <span>{scanExpanded ? '▾' : '▸'}</span>
        </div>
        {scanExpanded && (
          <div className="btc-scan-body">
            {scanError && <div className="btc-scan-error">Scanner offline — {scanError}</div>}
            {scanData?.scan?.slice(0, 5).map((item, i) => (
              <div key={item.symbol} className={`btc-scan-row ${item.symbol === SYMBOL ? 'active' : ''}`}>
                <span className="btc-scan-rank">#{i + 1}</span>
                <span className="btc-scan-symbol">{item.symbol}</span>
                <span className={`btc-scan-score ${item.composite >= 65 ? 'strong' : item.composite <= 35 ? 'weak' : ''}`}>
                  {Math.round(item.composite)}
                </span>
                <span className={`btc-scan-signal ${item.signal?.toLowerCase()}`}>{item.signal}</span>
              </div>
            ))}
            {scanData?.scan?.length === 0 && <div className="btc-scan-empty">No signals</div>}
          </div>
        )}
      </div>

      {/* ── Action Log ─────────────────────────────────── */}
      <div className="btc-log">
        <div className="btc-log-header">Action Log</div>
        <div className="btc-log-entries">
          {actionLog.map(entry => (
            <div key={entry.id} className="btc-log-entry">
              <span className="btc-log-time">{entry.time}</span>
              <span className="btc-log-msg">{entry.msg}</span>
            </div>
          ))}
          {actionLog.length === 0 && <div className="btc-log-empty">No actions yet</div>}
        </div>
      </div>

      {/* ── Footer ──────────────────────────────────────── */}
      <footer className="btc-footer">
        <span>btc-scalp-v1 protocol</span>
        <span>Keys: B=Buy S=Sell C=CloseAll Space=Pause Esc=Lock 1-3=Size</span>
      </footer>
    </div>
  );
}
