import { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import './research-overview.css';

const MOCK_SIGNALS = [
  { symbol: 'NVDA', direction: 'BUY', score: 87, change: '+3.2', protocol: 'Momentum Breakout', time: '2m ago' },
  { symbol: 'TSLA', direction: 'SELL', score: 72, change: '-5.1', protocol: 'Mean Reversion', time: '8m ago' },
  { symbol: 'AAPL', direction: 'BUY', score: 81, change: '+1.7', protocol: 'Trend Following', time: '12m ago' },
  { symbol: 'AMD', direction: 'BUY', score: 76, change: '+4.5', protocol: 'Sector Rotation', time: '15m ago' },
  { symbol: 'META', direction: 'SELL', score: 68, change: '-2.8', protocol: 'Volatility Squeeze', time: '22m ago' },
  { symbol: 'MSFT', direction: 'BUY', score: 79, change: '+0.9', protocol: 'Earnings Whisper', time: '31m ago' },
  { symbol: 'SPY', direction: 'BUY', score: 73, change: '+1.2', protocol: 'Macro Alignment', time: '38m ago' },
  { symbol: 'EURUSD', direction: 'SELL', score: 65, change: '-1.4', protocol: 'Carry Trade', time: '45m ago' },
];

const PROTOCOL_HEALTH = [
  { name: 'Trend Following', status: 'healthy', uptime: 99.7, lastRun: '3m ago', signals: 42 },
  { name: 'Mean Reversion', status: 'healthy', uptime: 99.2, lastRun: '8m ago', signals: 31 },
  { name: 'Momentum Breakout', status: 'degraded', uptime: 94.5, lastRun: '15m ago', signals: 18 },
  { name: 'Earnings Whisper', status: 'healthy', uptime: 98.9, lastRun: '1m ago', signals: 27 },
  { name: 'Volatility Squeeze', status: 'down', uptime: 87.3, lastRun: '2h ago', signals: 5 },
  { name: 'Sector Rotation', status: 'healthy', uptime: 99.9, lastRun: '4m ago', signals: 22 },
];

function generateSparkline(length = 12) {
  return Array.from({ length }, () => Math.round((40 + Math.random() * 60) * 10) / 10);
}

export default function ResearchOverviewPage() {
  const [activeTab, setActiveTab] = useState('signals');

  const buyCount = MOCK_SIGNALS.filter(s => s.direction === 'BUY').length;
  const sellCount = MOCK_SIGNALS.filter(s => s.direction === 'SELL').length;
  const avgScore = Math.round(MOCK_SIGNALS.reduce((a, s) => a + s.score, 0) / MOCK_SIGNALS.length);

  return (
    <div className="ro-page">
      <header className="ro-header">
        <div>
          <h1>Research Overview</h1>
          <p className="ro-subtitle">Signal dashboard — top signals, changes, and protocol health</p>
        </div>
        <div className="ro-tabs">
          <button className={activeTab === 'signals' ? 'active' : ''} onClick={() => setActiveTab('signals')}>Signals</button>
          <button className={activeTab === 'protocols' ? 'active' : ''} onClick={() => setActiveTab('protocols')}>Protocol Health</button>
        </div>
      </header>

      {/* Summary cards */}
      <div className="ro-summary-grid">
        <motion.div className="ro-summary-card" whileHover={{ y: -2 }}>
          <span className="ro-summary-label">Total Signals</span>
          <span className="ro-summary-value">{MOCK_SIGNALS.length}</span>
        </motion.div>
        <motion.div className="ro-summary-card" whileHover={{ y: -2 }}>
          <span className="ro-summary-label">Buy / Sell</span>
          <span className="ro-summary-value">
            <span className="ro-buy">{buyCount}</span> / <span className="ro-sell">{sellCount}</span>
          </span>
        </motion.div>
        <motion.div className="ro-summary-card" whileHover={{ y: -2 }}>
          <span className="ro-summary-label">Avg Score</span>
          <span className="ro-summary-value">{avgScore}</span>
        </motion.div>
        <motion.div className="ro-summary-card" whileHover={{ y: -2 }}>
          <span className="ro-summary-label">Protocols Online</span>
          <span className="ro-summary-value">
            {PROTOCOL_HEALTH.filter(p => p.status !== 'down').length}/{PROTOCOL_HEALTH.length}
          </span>
        </motion.div>
      </div>

      <AnimatePresence mode="wait">
        {activeTab === 'signals' ? (
          <motion.div key="signals" className="ro-table-wrap" initial={{ opacity: 0, x: -12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 12 }}>
            <table className="ro-table">
              <thead>
                <tr>
                  <th>Symbol</th>
                  <th>Direction</th>
                  <th>Score</th>
                  <th>Change</th>
                  <th>Protocol</th>
                  <th>Time</th>
                  <th>Trend</th>
                </tr>
              </thead>
              <tbody>
                {MOCK_SIGNALS.map(s => {
                  const spark = generateSparkline();
                  const linePts = spark.map((p, i) => `${(i / (spark.length - 1)) * 100},${100 - p}`).join(' ');
                  return (
                    <tr key={s.symbol + s.time} className="ro-row">
                      <td className="ro-symbol">{s.symbol}</td>
                      <td>
                        <span className={`ro-dir ${s.direction === 'BUY' ? 'buy' : 'sell'}`}>{s.direction}</span>
                      </td>
                      <td className="ro-score">{s.score}</td>
                      <td className={s.change.startsWith('+') ? 'ro-up' : 'ro-down'}>{s.change}%</td>
                      <td className="ro-protocol">{s.protocol}</td>
                      <td className="ro-time">{s.time}</td>
                      <td className="ro-spark-cell">
                        <svg width="72" height="20" viewBox="0 0 72 20">
                          <polyline fill="none" stroke={s.direction === 'BUY' ? '#22c55e' : '#ef4444'} strokeWidth="1.2" points={linePts} />
                        </svg>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </motion.div>
        ) : (
          <motion.div key="protocols" className="ro-protocol-grid" initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -12 }}>
            {PROTOCOL_HEALTH.map(p => (
              <motion.div key={p.name} className="ro-protocol-card" whileHover={{ y: -2 }}>
                <div className="ro-protocol-header">
                  <span className="ro-protocol-name">{p.name}</span>
                  <span className={`ro-status-badge ${p.status}`}>
                    {p.status === 'healthy' ? '●' : p.status === 'degraded' ? '◐' : '○'} {p.status}
                  </span>
                </div>
                <div className="ro-protocol-metrics">
                  <div>
                    <span className="ro-metric-label">Uptime</span>
                    <span className="ro-metric-value">{p.uptime}%</span>
                  </div>
                  <div>
                    <span className="ro-metric-label">Last Run</span>
                    <span className="ro-metric-value">{p.lastRun}</span>
                  </div>
                  <div>
                    <span className="ro-metric-label">Signals</span>
                    <span className="ro-metric-value">{p.signals}</span>
                  </div>
                </div>
                <div className="ro-health-bar-wrap">
                  <div className={`ro-health-bar ${p.status}`} style={{ width: `${p.uptime}%` }} />
                </div>
              </motion.div>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
