import { useState, useMemo } from 'react'
import './trading-strategies.css'

const STRATEGIES = [
  { name: 'Forex Mean Reversion', category: 'forex', symbols: 6, timeframes: '1h, 4h', risk: 'medium' },
  { name: 'CFD Momentum Breakout', category: 'indices', symbols: 5, timeframes: '1h, 1d', risk: 'high' },
  { name: 'VIX Regime Strategy', category: 'indices', symbols: 2, timeframes: '1d', risk: 'medium' },
  { name: 'Gold Macro Correlation', category: 'commodities', symbols: 2, timeframes: '4h, 1d', risk: 'medium' },
  { name: 'Tech Titan Momentum', category: 'stocks', symbols: 5, timeframes: '1d', risk: 'high' },
  { name: 'Crypto Scalper', category: 'crypto', symbols: 2, timeframes: '1h', risk: 'high' },
  { name: 'ETF Slow Growth', category: 'etf', symbols: 4, timeframes: '1d, 1wk', risk: 'low' },
  { name: 'Free-Tier Conviction Accumulation', category: 'multi', symbols: 5, timeframes: '1d', risk: 'medium' },
  { name: 'AI Titans', category: 'stocks', symbols: 6, timeframes: '1d', risk: 'high' },
  { name: 'Magnificent 7', category: 'stocks', symbols: 7, timeframes: '1d', risk: 'high' },
  { name: 'European Defence', category: 'stocks', symbols: 5, timeframes: '1d', risk: 'medium' },
  { name: 'Gold Complex', category: 'commodities', symbols: 4, timeframes: '4h, 1d', risk: 'medium' },
  { name: 'Crypto Majors', category: 'crypto', symbols: 4, timeframes: '1h, 4h', risk: 'high' },
  { name: 'Meme Coins', category: 'crypto', symbols: 5, timeframes: '1h', risk: 'high' },
  { name: 'Dollar Basket', category: 'forex', symbols: 6, timeframes: '4h, 1d', risk: 'low' },
  { name: 'High Volatility All', category: 'multi', symbols: 10, timeframes: '1h, 4h, 1d', risk: 'high' },
  { name: 'Kitchen Sink', category: 'multi', symbols: 15, timeframes: '1h, 4h, 1d, 1wk', risk: 'high' },
]

const CATEGORIES = [
  { id: 'all', label: 'All' },
  { id: 'stocks', label: 'Stocks' },
  { id: 'forex', label: 'Forex' },
  { id: 'crypto', label: 'Crypto' },
  { id: 'indices', label: 'Indices' },
  { id: 'commodities', label: 'Commodities' },
  { id: 'multi', label: 'Multi' },
  { id: 'etf', label: 'ETF' },
]

const CATEGORY_COLORS = {
  forex: '#3b82f6',
  indices: '#8b5cf6',
  commodities: '#f59e0b',
  stocks: '#22c55e',
  crypto: '#ef4444',
  multi: '#ec4899',
  etf: '#06b6d4',
}

const RISK_TONES = {
  low: 'ok',
  medium: 'warn',
  high: 'error',
}

export default function TradingStrategiesPage() {
  const [filter, setFilter] = useState('all')

  const filtered = useMemo(() => {
    return filter === 'all' ? STRATEGIES : STRATEGIES.filter((s) => s.category === filter)
  }, [filter])

  return (
    <main className="trading-strategies-page">
      <header className="ts-header">
        <h1>Trading Strategies</h1>
        <p className="ts-subtitle">{STRATEGIES.length} built-in strategies across 7 categories</p>
      </header>

      <div className="ts-filter-bar">
        {CATEGORIES.map((cat) => (
          <button
            key={cat.id}
            type="button"
            className={`ts-filter-btn${filter === cat.id ? ' ts-filter-btn--active' : ''}`}
            style={filter === cat.id && cat.id !== 'all' ? { background: CATEGORY_COLORS[cat.id], borderColor: CATEGORY_COLORS[cat.id], color: '#fff' } : {}}
            onClick={() => setFilter(cat.id)}
          >
            {cat.label}
          </button>
        ))}
      </div>

      <div className="ts-count">{filtered.length} strategy{filtered.length !== 1 ? 'ies' : 'y'}</div>

      <div className="ts-table-wrap">
        <table className="ts-table">
          <thead>
            <tr>
              <th>Strategy Name</th>
              <th>Category</th>
              <th>Symbols</th>
              <th>Timeframes</th>
              <th>Risk Level</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((s) => (
              <tr key={s.name}>
                <td className="ts-name">{s.name}</td>
                <td>
                  <span className="ts-cat-badge" style={{ background: `${CATEGORY_COLORS[s.category]}20`, color: CATEGORY_COLORS[s.category], borderColor: CATEGORY_COLORS[s.category] }}>
                    {s.category}
                  </span>
                </td>
                <td>{s.symbols}</td>
                <td className="ts-timeframes">{s.timeframes}</td>
                <td>
                  <span className={`ts-chip ts-chip-${RISK_TONES[s.risk]}`}>{s.risk}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {filtered.length === 0 && (
        <p className="ts-empty">No strategies match the selected filter.</p>
      )}
    </main>
  )
}