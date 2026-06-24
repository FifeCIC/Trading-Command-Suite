import { useEffect, useState, useCallback } from 'react'
import './sees-live-stack.css'

const API = 'http://localhost:3201'
const AUTO_INTERVAL_MS = 10000

export default function SeesLiveStackMockPage() {
  const [watchlists, setWatchlists] = useState([])
  const [protocols, setProtocols] = useState([])
  const [selectedWatchlist, setSelectedWatchlist] = useState('')
  const [selectedProtocol, setSelectedProtocol] = useState('')
  const [autoRun, setAutoRun] = useState(true)
  const [symbols, setSymbols] = useState([]) // { ticker, name } from watchlist
  const [scored, setScored] = useState([])    // { symbol, name, protocol, composite, maxScore, signal, price }
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  // ── Load watchlists + protocols on mount ──
  useEffect(() => {
    (async () => {
      try {
        const [wlRes, protoRes] = await Promise.all([
          fetch(`${API}/api/watchlists`),
          fetch(`${API}/api/scoring/gated/protocols`),
        ])
        const wlData = await wlRes.json()
        const protoData = await protoRes.json()
        setWatchlists(Array.isArray(wlData) ? wlData : [])
        const codeProtos = (protoData.protocols || []).filter(p => p.source === 'code')
        setProtocols(codeProtos)
        // Auto-select first watchlist + matching protocol
        if (wlData.length > 0) {
          setSelectedWatchlist(wlData[0].id)
          // Try to match protocol to watchlist name
          const wlName = (wlData[0].label || '').toLowerCase()
          const match = codeProtos.find(p =>
            p.id.includes(wlName.replace(/\s+/g, '-')) ||
            (p.name || '').toLowerCase().includes(wlName)
          )
          setSelectedProtocol(match ? match.id : 'default')
        }
      } catch (e) {
        setError('Failed to load data: ' + e.message)
      }
    })()
  }, [])

  // ── Load watchlist symbols when selection changes ──
  useEffect(() => {
    if (!selectedWatchlist) return
    (async () => {
      try {
        const res = await fetch(`${API}/api/watchlists/${selectedWatchlist}`)
        const data = await res.json()
        setSymbols(data.symbols || [])
      } catch { setSymbols([]) }
    })()
  }, [selectedWatchlist])

  // ── Score all symbols ──
  const runScoring = useCallback(async () => {
    if (symbols.length === 0 || !selectedProtocol) return
    setLoading(true)
    setError(null)
    const results = []
    for (const s of symbols) {
      try {
        const ticker = s.ticker || s.symbol
        const res = await fetch(`${API}/api/scoring/gated/${ticker}?protocol=${selectedProtocol}&timeframe=1d&bars=100`)
        const data = await res.json()
        results.push({
          symbol: ticker,
          name: s.name || ticker,
          protocol: selectedProtocol,
          composite: data.composite ?? 0,
          maxScore: data.meta?.maxScore ?? 100,
          signal: data.signal ?? 'HOLD',
          gated: data.gatingActive && (data.composite ?? 0) < 50,
        })
      } catch {
        results.push({ symbol: s.ticker || s.symbol, name: s.name || '?', protocol: selectedProtocol, composite: 0, maxScore: 100, signal: '--', gated: true })
      }
    }
    results.sort((a, b) => b.composite - a.composite)
    setScored(results)
    setLoading(false)
  }, [symbols, selectedProtocol])

  // ── Auto-run ──
  useEffect(() => {
    if (!autoRun || symbols.length === 0) return
    runScoring()
    const interval = setInterval(runScoring, AUTO_INTERVAL_MS)
    return () => clearInterval(interval)
  }, [autoRun, runScoring])

  // Build protocol maxScore lookup for percentage display
  const protoMaxScore = protocols.find(p => p.id === selectedProtocol)?.maxScore ?? 1500

  return (
    <main className="sees-page">
      <header className="sees-header">
        <h1>SEES Live Stack</h1>
        <p className="sees-subtitle">
          {scored.length > 0
            ? `${scored.length} symbols ranked · ${scored.filter(s => s.composite >= 50).length} active · protocol maxScore: ${protoMaxScore.toLocaleString()}`
            : 'Select a watchlist and protocol to begin'}
        </p>
      </header>

      <div className="sees-controls">
        <select value={selectedWatchlist} onChange={e => setSelectedWatchlist(e.target.value)} className="sees-protocol-select">
          <option value="">-- Watchlist --</option>
          {watchlists.map(w => <option key={w.id} value={w.id}>{w.label} ({w.symbolCount})</option>)}
        </select>
        <select value={selectedProtocol} onChange={e => setSelectedProtocol(e.target.value)} className="sees-protocol-select">
          <option value="">-- Protocol --</option>
          {protocols.map(p => <option key={p.id} value={p.id}>{p.name || p.id}</option>)}
        </select>
        <button type="button" className={'sees-auto-btn' + (autoRun ? ' active' : '')} onClick={() => setAutoRun(!autoRun)}>
          {autoRun ? 'Pause' : 'Auto'}
        </button>
        <button type="button" className="sees-refresh-btn" onClick={runScoring} disabled={autoRun || loading}>
          {loading ? 'Scoring…' : 'Refresh'}
        </button>
      </div>

      {error && <div className="sees-error">{error}</div>}

      <div className="sees-table-wrap">
        <table className="sees-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Symbol</th>
              <th>Name</th>
              <th>Score</th>
              <th>% of Max</th>
              <th>Signal</th>
            </tr>
          </thead>
          <tbody>
            {loading && scored.length === 0 && (
              <tr><td colSpan={6} className="sees-loading">Scoring {symbols.length} symbols…</td></tr>
            )}
            {!loading && scored.length === 0 && selectedWatchlist && (
              <tr><td colSpan={6} className="sees-empty">No results yet — click Refresh</td></tr>
            )}
            {!selectedWatchlist && (
              <tr><td colSpan={6} className="sees-empty">Select a watchlist above to begin</td></tr>
            )}
            {scored.map((s, i) => {
              const pct = protoMaxScore > 0 ? Math.round((s.composite / protoMaxScore) * 100) : 0
              return (
                <tr key={s.symbol} className={i === 0 ? 'sees-top' : ''}>
                  <td className="sees-rank">{i + 1}</td>
                  <td className="sees-sym">{s.symbol}</td>
                  <td>{s.name}</td>
                  <td className="sees-score-cell">
                    <span className={`sees-score-badge ${s.composite >= protoMaxScore * 0.5 ? 'high' : s.composite >= protoMaxScore * 0.3 ? 'mid' : 'low'}`}>
                      {Math.round(s.composite)}
                    </span>
                  </td>
                  <td>
                    <div className="sees-pct-bar-wrap">
                      <div className={`sees-pct-bar ${pct >= 50 ? 'high' : pct >= 30 ? 'mid' : 'low'}`} style={{ width: `${Math.min(100, pct)}%` }} />
                      <span className="sees-pct-label">{pct}%</span>
                    </div>
                  </td>
                  <td>
                    <span className={`sees-signal ${s.signal === 'BUY' ? 'buy' : s.signal === 'SELL' ? 'sell' : 'hold'}`}>
                      {s.gated ? '⛔' : ''} {s.signal}
                    </span>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </main>
  )
}
