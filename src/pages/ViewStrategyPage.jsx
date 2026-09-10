import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import './view-strategy.css';

function DirectiveBar({ name, score, max }) {
  const pct = Math.min(100, ((score || 0) / (max || 100)) * 100);
  const color = score >= 80 ? '#4ade80' : score >= 60 ? '#fbbf24' : score >= 40 ? '#f59e0b' : '#ef4444';
  return (
    <div className="vs-dir-row">
      <span className="vs-dir-name">{name}</span>
      <div className="vs-dir-bar-track">
        <div className="vs-dir-bar-fill" style={{ width: `${pct}%`, background: color }} />
      </div>
      <span className="vs-dir-score">{score}%</span>
    </div>
  );
}

export default function ViewStrategyPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [tab, setTab] = useState('overview');

  // Mock strategy data
  const strategy = {
    id: id || 'forex-mr',
    name: 'Forex Mean Reversion',
    description: 'Captures mean reversion on major forex pairs using RSI extremes and Bollinger Band confirmation.',
    category: 'Forex',
    status: 'active',
    winRate: 0.62,
    totalSignals: 147,
    avgReturn: 1.2,
    maxDrawdown: -8.4,
    sharpe: 1.4,
    directives: [
      { name: 'RSI Oversold Reversion', score: 92 },
      { name: 'MACD Bullish Crossover', score: 78 },
      { name: 'Engulfing Pattern', score: 65 },
      { name: 'Bollinger %B', score: 61 },
      { name: 'Support / Resistance', score: 45 },
    ],
    recentSignals: [
      { symbol: 'EURUSD', score: 87, signal: 'buy', time: '14:32:01', return: '+1.2%' },
      { symbol: 'GBPUSD', score: 72, signal: 'buy', time: '14:30:45', return: '+0.8%' },
      { symbol: 'AUDUSD', score: 55, signal: 'hold', time: '14:28:12', return: '—' },
      { symbol: 'USDJPY', score: 42, signal: 'sell', time: '14:25:30', return: '-0.3%' },
    ],
    symbols: [
      { symbol: 'EURUSD', signals: 38, winRate: 0.68, avgReturn: 1.5 },
      { symbol: 'GBPUSD', signals: 32, winRate: 0.62, avgReturn: 1.1 },
      { symbol: 'AUDUSD', signals: 28, winRate: 0.55, avgReturn: 0.7 },
      { symbol: 'NZDUSD', signals: 22, winRate: 0.58, avgReturn: 0.9 },
    ],
  };

  return (
    <div className="vs-page">
      <header className="vs-header">
        <button className="vs-back" onClick={() => navigate(-1)}>◄ Back</button>
        <div className="vs-title-row">
          <h1>{strategy.name}</h1>
          <span className={`vs-status vs-${strategy.status}`}>{strategy.status}</span>
        </div>
        <p>{strategy.description}</p>
      </header>

      <div className="vs-tabs">
        {['overview', 'directives', 'signals', 'symbols'].map((t) => (
          <button key={t} className={`vs-tab ${tab === t ? 'vs-active' : ''}`} onClick={() => setTab(t)}>
            {t.charAt(0).toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>

      {tab === 'overview' && (
        <div className="vs-grid-3">
          <div className="vs-stat"><span>Win Rate</span><strong>{(strategy.winRate * 100).toFixed(0)}%</strong></div>
          <div className="vs-stat"><span>Total Signals</span><strong>{strategy.totalSignals}</strong></div>
          <div className="vs-stat"><span>Avg Return</span><strong className={strategy.avgReturn >= 0 ? 'vs-profit' : 'vs-loss'}>{strategy.avgReturn >= 0 ? '+' : ''}{strategy.avgReturn}%</strong></div>
          <div className="vs-stat"><span>Max Drawdown</span><strong className="vs-loss">{strategy.maxDrawdown}%</strong></div>
          <div className="vs-stat"><span>Sharpe Ratio</span><strong>{strategy.sharpe}</strong></div>
          <div className="vs-stat"><span>Category</span><strong>{strategy.category}</strong></div>
        </div>
      )}

      {tab === 'directives' && (
        <div className="vs-directives">
          <h3>Directive Performance</h3>
          {strategy.directives.map((d) => <DirectiveBar key={d.name} {...d} max={100} />)}
        </div>
      )}

      {tab === 'signals' && (
        <div className="vs-signals">
          <h3>Recent Signals</h3>
          {strategy.recentSignals.map((s, i) => (
            <div key={i} className="vs-signal-row">
              <span className="vs-sig-symbol">{s.symbol}</span>
              <span className="vs-sig-score">{s.score}</span>
              <span className={`vs-sig-action vs-${s.signal}`}>{s.signal.toUpperCase()}</span>
              <span className="vs-sig-time">{s.time}</span>
              <span className={s.return.startsWith('+') ? 'vs-profit' : s.return === '—' ? '' : 'vs-loss'}>{s.return}</span>
            </div>
          ))}
        </div>
      )}

      {tab === 'symbols' && (
        <div className="vs-symbols">
          <h3>Symbol Performance</h3>
          {strategy.symbols.map((s, i) => (
            <div key={i} className="vs-symbol-row">
              <span className="vs-sym-name">{s.symbol}</span>
              <span>{s.signals} signals</span>
              <span>Win: {(s.winRate * 100).toFixed(0)}%</span>
              <span className={s.avgReturn >= 0 ? 'vs-profit' : 'vs-loss'}>Avg: {s.avgReturn >= 0 ? '+' : ''}{s.avgReturn}%</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
