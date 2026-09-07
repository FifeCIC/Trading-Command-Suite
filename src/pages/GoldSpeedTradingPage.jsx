/**
 * Gold Speed Trading Page
 * ========================
 * Focused XAUUSD scalping cockpit. Locked to XAUUSD with xau-speed-v1 protocol.
 * Gold is the ultimate fear gauge — volatile during CPI, FOMC, NFP, geopolitics.
 *
 * URL: /trading/gold-speed
 */

import { useState, useEffect, useCallback } from 'react';
import { motion } from 'motion/react';
import { useQuery } from '@tanstack/react-query';
import { apiGet } from '../core/api/client';
import { TIMEFRAME_MS, useLockout, useTickHistory, useSpeedScanner, useTickRecording, useActionLog } from '../core/hooks/useSpeedCockpit';
import SpeedChart from '../components/SpeedChart';
import SpeedDecisionPanel from '../components/SpeedDecisionPanel';
import './speed-cockpit.css';

const SYMBOL = 'XAUUSD';
const SIZE_PRESETS = [1, 5, 10];
const TIMEFRAMES = ['1s', '5s', '15s', '1m', '5m'];

export default function GoldSpeedTradingPage() {
  const [sizePreset, setSizePreset] = useState(1);
  const [timeframe, setTf] = useState('5s');
  const [paused, setPaused] = useState(false);
  const [flashKey, setFlashKey] = useState(null);
  const [chartMode, setChartMode] = useState('candles');
  const [chartSettings] = useState({
    showVolume: true, showEMA9: true, showEMA21: true, showEMA50: true,
    gridStyle: 1, upColor: '#f59e0b', downColor: '#d97706',
  });

  const { actionLog, addLog } = useActionLog(20);
  const { locked, lockCountdown, lock } = useLockout();

  // ── Live quote ──────────────────────────────────────
  const quoteQuery = useQuery({
    queryKey: ['gold-speed-quote'],
    queryFn: () => apiGet(`/api/speed/quote/${SYMBOL}`).catch(() => null),
    refetchInterval: TIMEFRAME_MS[timeframe] ?? 1000,
    staleTime: 500,
  });
  const quote = quoteQuery.data;

  // ── Tick history ────────────────────────────────────
  const { tickHistory, prevMid } = useTickHistory(quote);

  // ── Scanner ─────────────────────────────────────────
  const { scanData, scanError } = useSpeedScanner({ paused, locked, timeframe, symbols: ['XAUUSD'] });

  // ── Recording ───────────────────────────────────────
  const { isRecording, recBarCount, toggleRecording } = useTickRecording({ queryKey: ['gold-rec-active'], symbol: SYMBOL });

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
      case key === 'Escape': e.preventDefault(); lock(); action = '🔒 LOCKED 30s'; break;
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
