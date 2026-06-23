import { useState, useMemo } from 'react'
import './trading-strategies.css'

const STRATEGIES = [
  { name: 'Forex Mean Reversion', category: 'forex', symbols: 'EURUSD, GBPUSD, USDJPY, AUDUSD, USDCAD, NZDUSD', timeframes: '1h, 4h', risk: 'medium', version: '2.1.0' },
  { name: 'CFD Momentum Breakout', category: 'indices', symbols: 'SPX500, NAS100, US30, GER40, UK100', timeframes: '1h, 1d', risk: 'high', version: '1.5.0' },
  { name: 'VIX Regime Strategy', category: 'indices', symbols: 'VIX, SPX500', timeframes: '1d', risk: 'medium', version: '1.0.0' },
  { name: 'Gold Macro Correlation', category: 'commodities', symbols: 'XAUUSD, XAGUSD', timeframes: '4h, 1d', risk: 'medium', version: '1.2.0' },
  { name: 'Tech Titan Momentum', category: 'stocks', symbols: 'NVDA, AAPL, MSFT, AMD, META', timeframes: '1d', risk: 'high', version: '2.0.0' },
  { name: 'Crypto Scalper', category: 'crypto', symbols: 'BTCUSD, ETHUSD', timeframes: '1h', risk: 'high', version: '1.1.0' },
  { name: 'ETF Slow Growth', category: 'etf', symbols: 'SPY, QQQ, IWM, DIA', timeframes: '1d, 1wk', risk: 'low', version: '1.0.0' },
  { name: 'Free-Tier Conviction Accumulation', category: 'multi', symbols: 'SPY, QQQ, NVDA, AAPL, BTCUSD', timeframes: '1d', risk: 'medium', version: '1.3.0' },
  { name: 'AI Titans', category: 'stocks', symbols: 'NVDA, MSFT, GOOGL, META, AMD, AVGO', timeframes: '1d', risk: 'high', version: '1.8.0' },
  { name: 'Magnificent 7', category: 'stocks', symbols: 'AAPL, MSFT, NVDA, GOOGL, AMZN, META, TSLA', timeframes: '1d', risk: 'high', version: '1.6.0' },
  { name: 'European Defence', category: 'stocks', symbols: 'RHI.DE, SAF.PA, BA.L, AV.L, TKA.DE', timeframes: '1d', risk: 'medium', version: '1.0.0' },
  { name: 'Gold Complex', category: 'commodities', symbols: 'XAUUSD, XAGUSD, GDX, GLD', timeframes: '4h, 1d', risk: 'medium', version: '1.0.0' },
  { name: 'Crypto Majors', category: 'crypto', symbols: 'BTCUSD, ETHUSD, SOLUSD, XRPUSD', timeframes: '1h, 4h', risk: 'high', version: '1.4.0' },
  { name: 'Meme Coins', category: 'crypto', symbols: 'DOGEUSD, SHIBUSD, PEPEUSD, BONKUSD, WIFUSD', timeframes: '1h', risk: 'high', version: '0.9.0' },
  { name: 'Dollar Basket', category: 'forex', symbols: 'EURUSD, GBPUSD, USDJPY, AUDUSD, USDCAD, USDCHF', timeframes: '4h, 1d', risk: 'low', version: '1.0.0' },
  { name: 'High Volatility All', category: 'multi', symbols: 'TSLA, NVDA, BTCUSD, MSTR, SMCI, PLTR, COIN, MARA, RIOT, RKLB', timeframes: '1h, 4h, 1d', risk: 'high', version: '1.0.0' },
  { name: 'Kitchen Sink', category: 'multi', symbols: '15 symbols across all markets', timeframes: '1h, 4h, 1d, 1wk', risk: 'high', version: '2.2.0' },
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

const RISK_TONES = { low: 'ok', medium: 'warn', high: 'error' }

export default function TradingStrategiesPage() {
  const [filter, setFilter] = useState('all')
  const [nameSearch, setNameSearch] = useState('')
  const [symbolSearch, setSymbolSearch] = useState('')

  const filtered = useMemo(() => {
    let list = filter === 'all' ? STRATEGIES : STRATEGIES.filter((s) => s.category === filter)
    if (nameSearch.trim()) {
      const q = nameSearch.trim().toLowerCase()
      list = list.filter((s) => s.name.toLowerCase().includes(q))
    }
    if (symbolSearch.trim()) {
      const q = symbolSearch.trim().toUpperCase()
      list = list.filter((s) => s.symbols.toUpperCase().includes(q))
    }
    return list
  }, [filter, nameSearch, symbolSearch])

  return (
    <main className="trading-strategies-page">
      <header className="ts-header">
        <h1>Trading Strategies</h1>
        <p className="ts-subtitle">{STRATEGIES.length} built-in strategies across 7 categories. P&amp;L and live status will populate when strategies are executed.</p>
      </header>

      <div className="ts-filter-bar">
        {CATEGORIES.map((cat) => (
          <button key={cat.id} type="button"
            className={`ts-filter-btn${filter === cat.id ? ' ts-filter-btn--active' : ''}`}
            style={filter === cat.id && cat.id !== 'all' ? { background: CATEGORY_COLORS[cat.id], borderColor: CATEGORY_COLORS[cat.id], color: '#fff' } : {}}
            onClick={() => setFilter(cat.id)}>{cat.label}</button>
        ))}
      </div>

      <div className="ts-count">{filtered.length} strategy{filtered.length !== 1 ? 'ies' : 'y'}</div>

      <div className="ts-table-wrap">
        <table className="ts-table">
          <thead>
            <tr>
              <th>
                Strategy Name
                <input type="search" placeholder="Filter names..." value={nameSearch} onChange={(e) => setNameSearch(e.target.value)}
                  className="ts-col-search" />
              </th>
              <th>Category</th>
              <th>
                Symbols
                <input type="search" placeholder="Filter symbols..." value={symbolSearch} onChange={(e) => setSymbolSearch(e.target.value)}
                  className="ts-col-search" />
              </th>
              <th>Timeframes</th>
              <th>Risk</th>
              <th>Version</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((s) => (
              <tr key={s.name}>
                <td className="ts-name">{s.name}</td>
                <td><span className="ts-cat-badge" style={{ background: `${CATEGORY_COLORS[s.category]}20`, color: CATEGORY_COLORS[s.category], borderColor: CATEGORY_COLORS[s.category] }}>{s.category}</span></td>
                <td className="ts-symbols">{typeof s.symbols === 'number' ? s.symbols : s.symbols}</td>
                <td className="ts-timeframes">{s.timeframes}</td>
                <td><span className={`ts-chip ts-chip-${RISK_TONES[s.risk]}`}>{s.risk}</span></td>
                <td className="ts-version">v{s.version}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {filtered.length === 0 && <p className="ts-empty">No strategies match the current filters.</p>}
    </main>
  )
}