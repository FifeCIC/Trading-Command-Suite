import { useEffect, useMemo, useRef, useState } from 'react'
import './sees-live-stack.css'

const INITIAL_SYMBOLS = [
  { symbol: 'AAPL', name: 'Apple Inc.', industry: 'Consumer Electronics', price: 198.32, score: 79.1, changePercent: 0.41 },
  { symbol: 'MSFT', name: 'Microsoft Corp.', industry: 'Software Infrastructure', price: 462.75, score: 82.5, changePercent: 0.56 },
  { symbol: 'NVDA', name: 'NVIDIA Corp.', industry: 'Semiconductors', price: 129.14, score: 88.2, changePercent: 1.21 },
  { symbol: 'TSLA', name: 'Tesla Inc.', industry: 'Auto Manufacturers', price: 227.91, score: 68.7, changePercent: -0.36 },
  { symbol: 'META', name: 'Meta Platforms', industry: 'Internet Content', price: 513.48, score: 76.4, changePercent: 0.18 },
  { symbol: 'AMD', name: 'Advanced Micro Devices', industry: 'Semiconductors', price: 176.23, score: 73.2, changePercent: -0.22 },
]

const AUTO_INTERVAL_MS = 5000

function scoreDelta(seed) {
  return Math.sin(seed) * 2.3 + (Math.random() * 2 - 1.0)
}

function priceDelta(seed) {
  return Math.sin(seed * 0.91) * 0.33 + (Math.random() * 0.12 - 0.06)
}

export default function SeesLiveStackMockPage() {
  const [symbols, setSymbols] = useState(INITIAL_SYMBOLS)
  const [lastUpdated, setLastUpdated] = useState(new Date())
  const [isAutoSorting, setIsAutoSorting] = useState(false)
  const tickRef = useRef(0)

  const rankedSymbols = useMemo(() => {
    return [...symbols].sort((a, b) => b.score - a.score)
  }, [symbols])

  const mutateSymbols = () => {
    tickRef.current += 1
    const tick = tickRef.current

    setSymbols((current) => {
      return current.map((row, idx) => {
        const score = Math.max(0, Math.min(100, row.score + scoreDelta((tick + idx) * 0.75)))
        const price = Math.max(1, row.price + priceDelta((tick + idx) * 0.61))

        return {
          ...row,
          score: Number(score.toFixed(2)),
          price: Number(price.toFixed(2)),
          changePercent: Number(((priceDelta((tick + idx) * 0.43)) * 2.5).toFixed(2)),
        }
      })
    })

    setLastUpdated(new Date())
  }

  useEffect(() => {
    if (!isAutoSorting) {
      return undefined
    }

    const id = window.setInterval(() => {
      mutateSymbols()
    }, AUTO_INTERVAL_MS)

    return () => window.clearInterval(id)
  }, [isAutoSorting])

  return (
    <main className="sees-page">
      <section className="sees-header">
        <div className="sees-title-wrap">
          <p className="eyebrow">Trading Command Suite</p>
          <h1>SEES Live Stack Mockup</h1>
          <p className="subcopy">
            A standalone React prototype of ranked symbols and re-sorting behavior.
            No WordPress bridge is used in this version.
          </p>
        </div>

        <div className="sees-status-card" role="status" aria-live="polite">
          <p><strong>Status:</strong> {isAutoSorting ? 'Auto-Re-Sorting Active' : 'Manual Refresh'}</p>
          <p><strong>Symbols:</strong> {rankedSymbols.length}</p>
          <p><strong>Last updated:</strong> {lastUpdated.toLocaleTimeString()}</p>
        </div>
      </section>

      <section className="sees-controls">
        <button type="button" className="btn btn-primary" onClick={mutateSymbols}>Refresh Data</button>
        {!isAutoSorting && (
          <button type="button" className="btn" onClick={() => setIsAutoSorting(true)}>Start Auto-Re-Sorting</button>
        )}
        {isAutoSorting && (
          <button type="button" className="btn" onClick={() => setIsAutoSorting(false)}>Stop Auto-Re-Sorting</button>
        )}
      </section>

      <section className="stack" aria-label="SEES ranked symbols">
        {rankedSymbols.map((row, index) => {
          const positive = row.changePercent >= 0
          const delta = `${positive ? '+' : ''}${row.changePercent.toFixed(2)}%`

          return (
            <article className="stack-card" key={row.symbol}>
              <header className="stack-header">
                <div className="stack-rank">#{index + 1}</div>
                <div>
                  <h2>{row.symbol}</h2>
                  <p>{row.name}</p>
                </div>
                <div className="score-pill">Score {row.score.toFixed(2)}</div>
              </header>

              <div className="stack-grid">
                <div>
                  <span className="k">Industry</span>
                  <span className="v">{row.industry}</span>
                </div>
                <div>
                  <span className="k">Price</span>
                  <span className="v">${row.price.toFixed(2)}</span>
                </div>
                <div>
                  <span className="k">Change</span>
                  <span className={`v ${positive ? 'up' : 'down'}`}>{delta}</span>
                </div>
              </div>
            </article>
          )
        })}
      </section>
    </main>
  )
}
