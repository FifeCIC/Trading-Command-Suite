import { useEffect, useMemo, useState } from 'react'
import './sees-live-stack.css'

const AUTO_INTERVAL_MS = 4000

const PROTOCOLS = [
  { id: 'default', label: 'Default Protocol' },
  { id: 'ai-titans', label: 'AI Titans (4H)' },
  { id: 'tech-momentum', label: 'Tech Momentum (15M)' },
  { id: 'kitchen-sink', label: 'Kitchen Sink' },
  { id: 'gold-hedge', label: 'Gold Hedge' },
]

export default function SeesLiveStackMockPage() {
  const [tick, setTick] = useState(0)
  const [selectedProtocol, setSelectedProtocol] = useState('default')
  const [autoRun, setAutoRun] = useState(true)

  const SEES_SYMBOLS = [
    { symbol: 'NVDA', name: 'NVIDIA Corp', basePrice: 142, baseBias: 0.25 },
    { symbol: 'TSLA', name: 'Tesla Inc', basePrice: 245, baseBias: -0.15 },
    { symbol: 'AAPL', name: 'Apple Inc', basePrice: 198, baseBias: 0.10 },
    { symbol: 'BTCUSD', name: 'Bitcoin', basePrice: 68500, baseBias: 0.35 },
    { symbol: 'MSFT', name: 'Microsoft Corp', basePrice: 420, baseBias: 0.08 },
    { symbol: 'EURUSD', name: 'Euro / USD', basePrice: 1.085, baseBias: -0.05 },
    { symbol: 'AMD', name: 'AMD Inc', basePrice: 165, baseBias: 0.18 },
    { symbol: 'XAUUSD', name: 'Gold Spot', basePrice: 2420, baseBias: 0.12 },
    { symbol: 'SPY', name: 'S&P 500 ETF', basePrice: 548, baseBias: 0.05 },
    { symbol: 'MSTR', name: 'MicroStrategy', basePrice: 1520, baseBias: 0.30 },
  ]

  useEffect(() => {
    if (!autoRun) return
    const interval = setInterval(() => setTick((t) => t + 1), AUTO_INTERVAL_MS)
    return () => clearInterval(interval)
  }, [autoRun])

  const symbols = useMemo(() => {
    return SEES_SYMBOLS.map((s) => {
      const noise = (Math.random() - 0.5) * s.basePrice * 0.03
      const price = +(s.basePrice + noise).toFixed(s.basePrice < 10 ? 4 : 2)
      const score = Math.min(100, Math.max(0, Math.round(40 + s.baseBias * 40 + (Math.random() - 0.5) * 30)))
      return { ...s, price, score, tick }
    })
  }, [tick])

  const ranked = [...symbols].sort((a, b) => b.score - a.score)

  return (
    <main className="sees-page">
      <header className="sees-header">
        <h1>SEES Live Stack</h1>
        <p className="sees-subtitle">Basic symbol ranking by score. Select a protocol and run manually.</p>
      </header>
      <div className="sees-controls">
        <select value={selectedProtocol} onChange={(e) => setSelectedProtocol(e.target.value)} className="sees-protocol-select">
          {PROTOCOLS.map((p) => (<option key={p.id} value={p.id}>{p.label}</option>))}
        </select>
        <button type="button" className={'sees-auto-btn' + (autoRun ? ' active' : '')} onClick={() => setAutoRun(!autoRun)}>
          {autoRun ? 'Pause' : 'Auto'}
        </button>
        <button type="button" className="sees-refresh-btn" onClick={() => setTick((t) => t + 1)} disabled={autoRun}>
          Refresh
        </button>
      </div>
      <div className="sees-table-wrap">
        <table className="sees-table">
          <thead><tr><th>#</th><th>Symbol</th><th>Name</th><th>Price</th><th>Score</th></tr></thead>
          <tbody>
            {ranked.map((s, i) => (
              <tr key={s.symbol} className={i === 0 ? 'sees-top' : ''}>
                <td className="sees-rank">{i + 1}</td>
                <td className="sees-sym">{s.symbol}</td>
                <td>{s.name}</td>
                <td className="sees-price">{s.price.toLocaleString()}</td>
                <td><span className={'sees-score-badge ' + (s.score >= 70 ? 'high' : s.score >= 40 ? 'mid' : 'low')}>{s.score}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  )
}
