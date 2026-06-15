import { useState, useEffect } from 'react';
import './TradingStrategiesPage.css';

const BUILT_IN = [
  { id: 'forex-mean-reversion', name: 'Forex Mean Reversion', category: 'forex', symbols: 6, timeframes: ['1h','4h'], risk: 'medium' },
  { id: 'cfd-momentum-breakout', name: 'CFD Momentum Breakout', category: 'indices', symbols: 5, timeframes: ['1h','1d'], risk: 'high' },
  { id: 'vix-regime', name: 'VIX Regime Strategy', category: 'indices', symbols: 2, timeframes: ['1d'], risk: 'medium' },
  { id: 'gold-macro', name: 'Gold Macro Correlation', category: 'commodities', symbols: 2, timeframes: ['4h','1d'], risk: 'medium' },
  { id: 'tech-titan-momentum', name: 'Tech Titan Momentum', category: 'stocks', symbols: 5, timeframes: ['1d'], risk: 'high' },
  { id: 'crypto-scalper', name: 'Crypto Scalper', category: 'crypto', symbols: 2, timeframes: ['1h'], risk: 'high' },
  { id: 'etf-slow-growth', name: 'ETF Slow Growth', category: 'etf', symbols: 4, timeframes: ['1d','1wk'], risk: 'low' },
  { id: 'free-tier-conviction', name: 'Free-Tier Conviction Accumulation', category: 'multi', symbols: 5, timeframes: ['1d'], risk: 'medium' },
  { id: 'ai-titans', name: 'AI Titans', category: 'stocks', symbols: 6, timeframes: ['1d'], risk: 'high' },
  { id: 'magnificent-7', name: 'Magnificent 7', category: 'stocks', symbols: 7, timeframes: ['1d'], risk: 'medium' },
  { id: 'european-defence', name: 'European Defence', category: 'stocks', symbols: 4, timeframes: ['1d'], risk: 'medium' },
  { id: 'gold-complex', name: 'Gold Complex', category: 'commodities', symbols: 4, timeframes: ['4h','1d'], risk: 'medium' },
  { id: 'crypto-majors', name: 'Crypto Majors', category: 'crypto', symbols: 4, timeframes: ['1h'], risk: 'high' },
  { id: 'meme-coins', name: 'Meme Coins', category: 'crypto', symbols: 2, timeframes: ['15m','1h'], risk: 'high' },
  { id: 'dollar-basket', name: 'Dollar Basket', category: 'forex', symbols: 6, timeframes: ['1h','4h'], risk: 'medium' },
  { id: 'high-vol-all', name: 'High Volatility All', category: 'multi', symbols: 7, timeframes: ['5m','15m'], risk: 'high' },
  { id: 'kitchen-sink', name: 'Kitchen Sink', category: 'multi', symbols: 14, timeframes: ['1h'], risk: 'high' },
];

const CAT_COLORS = { forex: '#3b82f6', indices: '#8b5cf6', commodities: '#f59e0b', stocks: '#22c55e', crypto: '#ef4444', etf: '#06b6d4', multi: '#ec4899' };

export default function TradingStrategiesPage() {
  const [filter, setFilter] = useState('all');

  const filtered = filter === 'all' ? BUILT_IN : BUILT_IN.filter(s => s.category === filter);
  const categories = ['all', ...new Set(BUILT_IN.map(s => s.category))];

  return (
    <div className="ts-page">
      <div className="ts-header">
        <h2>Trading Strategies</h2>
        <p className="ts-sub">Pre-built strategies with symbols pre-selected. Click a strategy to view details or clone it.</p>
      </div>

      <div className="ts-filters">
        {categories.map(c => (
          <button key={c} className={`ts-filter-btn ${filter === c ? 'active' : ''}`}
            style={c !== 'all' ? { borderColor: CAT_COLORS[c] } : {}}
            onClick={() => setFilter(c)}>
            {c === 'all' ? 'All' : c.charAt(0).toUpperCase() + c.slice(1)}
          </button>
        ))}
      </div>

      <div className="ts-table-wrap">
        <table className="ts-table">
          <thead>
            <tr>
              <th>Strategy</th>
              <th>Category</th>
              <th>Symbols</th>
              <th>Timeframes</th>
              <th>Risk</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(s => (
              <tr key={s.id} className="ts-row">
                <td><strong>{s.name}</strong></td>
                <td><span className="ts-cat" style={{ color: CAT_COLORS[s.category] }}>{s.category}</span></td>
                <td>{s.symbols}</td>
                <td>{s.timeframes.join(', ')}</td>
                <td><span className={`ts-risk ts-risk-${s.risk}`}>{s.risk}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="ts-note">These strategies are built-in and stored in the database. They can be duplicated, modified, and used for scoring and backtesting.</p>
    </div>
  );
}
