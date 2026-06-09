import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { apiGet } from '../core/api/client'
import './symbols-browser.css'

export default function SymbolsBrowserPage() {
  const [selectedId, setSelectedId] = useState(null)

  const symbols = useQuery({
    queryKey: ['symbols-browser'],
    queryFn: () => apiGet('/api/symbols'),
    refetchInterval: 30000,
  })

  const freshness = useQuery({
    queryKey: ['symbols-freshness'],
    queryFn: () => apiGet('/api/market-data/freshness'),
    refetchInterval: 30000,
  })

  const s = symbols.data ?? {}
  const syms = Array.isArray(s.symbols) ? s.symbols : []
  const f = freshness.data ?? {}
  const freshes = Array.isArray(f.results) ? f.results : []
  const freshnessBySymbol = Object.fromEntries(freshes.map((r) => [r.symbolId, r]))

  const selected = syms.find((sym) => sym.id === selectedId)
  const selectedFreshness = selectedId ? freshnessBySymbol[selectedId] : null

  return (
    <div className="symbols-browser">
      <header className="page-header">
        <h1>Symbols</h1>
        <p>{syms.length} symbol{syms.length !== 1 ? 's' : ''} in database · Mode: {s.mode || '...'}</p>
      </header>

      <section className="symbols-layout">
        <div className="symbols-list">
          <table className="symbols-table">
            <thead>
              <tr>
                <th>Ticker</th>
                <th>Name</th>
                <th>Exchange</th>
                <th>Type</th>
                <th>Freshness</th>
              </tr>
            </thead>
            <tbody>
              {syms.map((sym) => {
                const f = freshnessBySymbol[sym.id]
                return (
                  <tr
                    key={sym.id}
                    className={selectedId === sym.id ? 'row-selected' : ''}
                    onClick={() => setSelectedId(selectedId === sym.id ? null : sym.id)}
                  >
                    <td><strong>{sym.ticker}</strong></td>
                    <td>{sym.name}</td>
                    <td>{sym.exchange}</td>
                    <td><span className="chip chip--neutral">{sym.type}</span></td>
                    <td>
                      <span className={`chip chip--${f?.status === 'fresh' ? 'ok' : f?.status === 'stale' ? 'warn' : 'neutral'}`}>
                        {f?.status ?? '...'}
                      </span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        {selected && (
          <aside className="symbol-detail">
            <h2>{selected.ticker}</h2>
            <p className="symbol-name">{selected.name}</p>

            <div className="detail-grid">
              <div className="detail-item">
                <span className="detail-label">Exchange</span>
                <span className="detail-value">{selected.exchange}</span>
              </div>
              <div className="detail-item">
                <span className="detail-label">Type</span>
                <span className="detail-value">{selected.type}</span>
              </div>
              <div className="detail-item">
                <span className="detail-label">Active</span>
                <span className={`chip chip--${selected.active ? 'ok' : 'warn'}`}>
                  {selected.active ? 'Yes' : 'No'}
                </span>
              </div>
              <div className="detail-item">
                <span className="detail-label">ID</span>
                <code className="detail-value">{selected.id}</code>
              </div>
            </div>

            {selectedFreshness && (
              <div className="detail-section">
                <h3>Data Freshness</h3>
                <div className="detail-grid">
                  <div className="detail-item">
                    <span className="detail-label">Status</span>
                    <span className={`chip chip--${selectedFreshness.status === 'fresh' ? 'ok' : selectedFreshness.status === 'stale' ? 'warn' : 'neutral'}`}>
                      {selectedFreshness.status}
                    </span>
                  </div>
                  <div className="detail-item">
                    <span className="detail-label">Latest Bar</span>
                    <span className="detail-value">
                      {selectedFreshness.latestTimestamp
                        ? new Date(selectedFreshness.latestTimestamp).toLocaleString()
                        : 'None'}
                    </span>
                  </div>
                  <div className="detail-item">
                    <span className="detail-label">Age</span>
                    <span className="detail-value">
                      {selectedFreshness.ageMinutes != null
                        ? `${selectedFreshness.ageMinutes.toFixed(0)} min`
                        : '—'}
                    </span>
                  </div>
                  <div className="detail-item">
                    <span className="detail-label">Timeframe</span>
                    <span className="detail-value">{selectedFreshness.timeframe}</span>
                  </div>
                </div>
              </div>
            )}

            <div className="detail-section">
              <h3>Timestamps</h3>
              <div className="detail-grid">
                <div className="detail-item">
                  <span className="detail-label">Created</span>
                  <span className="detail-value">{new Date(selected.createdAt).toLocaleString()}</span>
                </div>
                <div className="detail-item">
                  <span className="detail-label">Updated</span>
                  <span className="detail-value">{new Date(selected.updatedAt).toLocaleString()}</span>
                </div>
              </div>
            </div>
          </aside>
        )}
      </section>
    </div>
  )
}
