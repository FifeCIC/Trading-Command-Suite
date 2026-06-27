/**
 * Gold Speed Trading Page
 * ========================
 * Focused XAUUSD scalping cockpit. Locked to XAUUSD with xau-speed-v1 protocol.
 * Gold is the ultimate fear gauge — volatile during CPI, FOMC, NFP, geopolitics.
 *
 * URL: /trading/gold-speed
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { motion } from 'motion/react';
import { useQuery } from '@tanstack/react-query';
import { apiGet } from '../core/api/client';
import SpeedChart from '../components/SpeedChart';
import SpeedDecisionPanel from '../components/SpeedDecisionPanel';
import './gold-speed.css';

const SYMBOL = 'XAUUSD';
const SIZE_PRESETS = [1, 5, 10];
const TIMEFRAMES = ['1s', '5s', '15s', '1m', '5m'];

export default function GoldSpeedTradingPage() {
  const [sizePreset, setSizePreset] = useState(1);
  const [timeframe, setTf] = useState('5s');
  const [paused, setPaused] = useState(false);
  const [locked, setLocked] = useState(false);
  const [lockCountdown, setLockCountdown] = useState(0);
  const [flashKey, setFlashKey] = useState(null);
  const [actionLog, setActionLog] = useState([]);
  const [chartMode, setChartMode] = useState('candles');
  const [isRecording, setIsRecording] = useState(false);
  const [recBarCount, setRecBarCount] = useState(0);
  const [chartSettings] = useState({
    showVolume: true, showEMA9: true, showEMA21: true, showEMA50: true,
    gridStyle: 1, upColor: '#f59e0b', downColor: '#d97706',
  });

  const lockTimer = useRef(null);
  const prevMid = useRef(null);

  // ── Live quote ──────────────────────────────────────
  const tfToMs = { '1s': 1000, '5s': 5000, '15s': 15000, '1m': 60000, '5m': 300000 };
  const quoteQuery = useQuery({
    queryKey: ['gold-speed-quote'],
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

  // ── Scanner ─────────────────────────────────────────
  const [scanData, setScanData] = useState(null);
  const [scanError, setScanError] = useState(null);

  useEffect(() => {
    const doScan = async () => {
      if (paused || locked) return;
      try {
        const res = await fetch('http://localhost:3201/api/speed/scan', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ timeframe, symbols: ['XAUUSD'] }),
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

  // ── Recording ───────────────────────────────────────
  const activeRecQuery = useQuery({
    queryKey: ['gold-rec-active'],
    queryFn: () => apiGet('/api/speed/record/active').catch(() => []),
    refetchInterval: 5000,
  });
  const activeRecordings = activeRecQuery.data ?? [];

  useEffect(() => {
    const active = (Array.isArray(activeRecordings) ? activeRecordings : []).find(
      r => r.symbol === SYMBOL || r.ticker === SYMBOL
    );
    setIsRecording(!!active);
    setRecBarCount(active?.barCount ?? 0);
  }, [activeRecordings]);

  const toggleRecording = async () => {
    const endpoint = isRecording ? '/api/speed/record/stop' : '/api/speed/record/start';
    try {
      await fetch(`http://localhost:3201${endpoint}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
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
      case key === 'b': e.preventDefault(); action = `BUY $${currentSize} GOLD`; break;
      case key === 's': e.preventDefault(); action = `SELL $${currentSize} GOLD`; break;
      case key === 'c': e.preventDefault(); action = 'CLOSE ALL'; break;
      case key === ']': e.preventDefault(); setSizePreset(p => Math.min(2, p + 1)); break;
      case key === '[': e.preventDefault(); setSizePreset(p => Math.max(0, p - 1)); break;
      case key === '1': e.preventDefault(); setSizePreset(0); break;
      case key === '2': e.preventDefault(); setSizePreset(1); break;
      case key === '3': e.preventDefault(); setSizePreset(2); break;
      case key === ' ': e.preventDefault(); setPaused(p => !p); break;
      case key === 'Escape': e.preventDefault(); setLocked(true); setLockCountdown(30); action = '🔒 LOCKED 30s'; break;
      case key === '`': e.preventDefault(); setTf(t => { const i = TIMEFRAMES.indexOf(t); return TIMEFRAMES[(i + 1) % TIMEFRAMES.length]; }); break;
      default: break;
    }

    if (action) {
      setFlashKey(key);
      addLog(action);
      setTimeout(() => setFlashKey(null), 200);
    }
  }, [locked, currentSize]);

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  useEffect(() => {
    if (locked && lockCountdown > 0) {
      lockTimer.current = setTimeout(() => setLockCountdown(c => c - 1), 1000);
      return () => clearTimeout(lockTimer.current);
    }
    if (locked && lockCountdown === 0) setLocked(false);
  }, [locked, lockCountdown]);

  return (
    <div className="gold-page">
      {locked && (
        <div className="gold-lockout">
          <motion.div className="gold-lockout-box" initial={{ scale: 0.8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}>
            <h1>🔒 LOCKED</h1>
            <p>Emergency lockout — {lockCountdown}s</p>
          </motion.div>
        </div>
      )}
      {paused && !locked && <div className="gold-pause">⏸ PAUSED</div>}

      {/* ── Header ────────────────────────────────────── */}
      <header className="gold-header">
        <div className="gold-header-left">
          <h1 className="gold-title">
            🥇 Gold Speed
            <span className={`gold-live-dot ${!paused ? 'live' : ''}`} />
          </h1>
          <div className="gold-tf-row">
            {TIMEFRAMES.map(tf => (
              <button key={tf} className={`gold-tf-btn ${tf === timeframe ? 'active' : ''}`} onClick={() => setTf(tf)}>{tf}</button>
            ))}
          </div>
        </div>
        <div className="gold-header-center">
          <span className="gold-size-label">Size:</span>
          <select value={sizePreset} onChange={e => setSizePreset(Number(e.target.value))} className="gold-size-select">
            {SIZE_PRESETS.map((s, i) => <option key={s} value={i}>${s}</option>)}
          </select>
          <button className={`gold-action-btn gold-buy ${flashKey === 'b' ? 'flash' : ''}`} onClick={() => handleKeyDown({ key: 'b', preventDefault: () => {}, target: {} })}>B Buy</button>
          <button className={`gold-action-btn gold-sell ${flashKey === 's' ? 'flash' : ''}`} onClick={() => handleKeyDown({ key: 's', preventDefault: () => {}, target: {} })}>S Sell</button>
        </div>
        <div className="gold-header-right">
          <button className={`gold-meta-btn ${isRecording ? 'recording' : ''}`} onClick={toggleRecording}>
            {isRecording ? `⏺ ${recBarCount}` : '⏺ Rec'}
          </button>
          <div className="gold-chart-toggle">
            <button className={`gold-chart-btn ${chartMode === 'candles' ? 'active' : ''}`} onClick={() => setChartMode('candles')}>🕯</button>
            <button className={`gold-chart-btn ${chartMode === 'line' ? 'active' : ''}`} onClick={() => setChartMode('line')}>📈</button>
            <button className={`gold-chart-btn ${chartMode === 'minimal' ? 'active' : ''}`} onClick={() => setChartMode('minimal')}>◻</button>
          </div>
        </div>
      </header>

      {/* ── Price Strip ────────────────────────────────── */}
      <div className="gold-price-strip">
        <span className="gold-price-symbol">{SYMBOL}</span>
        <span className={`gold-price-mid ${quote?.mid != null && prevMid.current != null && quote.mid > prevMid.current ? 'up' : quote?.mid != null && prevMid.current != null && quote.mid < prevMid.current ? 'down' : ''}`}>
          {quote?.mid != null ? `$${quote.mid.toFixed(2)}` : '—'}
        </span>
        <span className="gold-price-bid">{quote?.bid != null ? quote.bid.toFixed(2) : '—'}</span>
        <span className="gold-price-ask">{quote?.ask != null ? quote.ask.toFixed(2) : '—'}</span>
        <svg className="gold-sparkline" viewBox="0 0 100 20" preserveAspectRatio="none">
          <polyline fill="none" stroke="#f59e0b" strokeWidth="1.5"
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
      <div className="gold-main">
        <div className="gold-decision">
          <SpeedDecisionPanel symbol={SYMBOL} />
        </div>
        <div className="gold-chart">
          <SpeedChart symbol={SYMBOL} timeframe={timeframe} chartMode={chartMode} scanScore={scanData} chartSettings={chartSettings} />
        </div>
      </div>

      {/* ── Scanner ────────────────────────────────────── */}
      <div className="gold-scan">
        <div className="gold-scan-header"><span>🎯 Scanner</span></div>
        <div className="gold-scan-body">
          {scanError && <div className="gold-scan-error">⚠ {scanError}</div>}
          {scanData?.scan?.slice(0, 5).map((item, i) => (
            <div key={item.symbol} className={`gold-scan-row ${item.symbol === SYMBOL ? 'active' : ''}`}>
              <span className="gold-scan-rank">#{i + 1}</span>
              <span className="gold-scan-symbol">{item.symbol}</span>
              <span className={`gold-scan-score ${item.composite >= 65 ? 'strong' : item.composite <= 35 ? 'weak' : ''}`}>{Math.round(item.composite)}</span>
              <span className={`gold-scan-signal ${item.signal?.toLowerCase()}`}>{item.signal}</span>
            </div>
          ))}
        </div>
      </div>

      {/* ── Action Log ─────────────────────────────────── */}
      <div className="gold-log">
        <div className="gold-log-header">Action Log</div>
        <div className="gold-log-entries">
          {actionLog.map(entry => (
            <div key={entry.id} className="gold-log-entry">
              <span className="gold-log-time">{entry.time}</span>
              <span className="gold-log-msg">{entry.msg}</span>
            </div>
          ))}
        </div>
      </div>

      <footer className="gold-footer">
        <span>xau-speed-v1 protocol</span>
        <span>B=Buy S=Sell C=CloseAll Space=Pause Esc=Lock 1-3=Size</span>
      </footer>
    </div>
  );
}
