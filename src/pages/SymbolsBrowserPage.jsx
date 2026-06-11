import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { apiGet } from '../core/api/client'
import './symbols-browser.css'

const SYMBOL_TYPES = ['stock', 'crypto', 'forex']

export default function SymbolsBrowserPage() {
  const [selectedId, setSelectedId] = useState(null)
  const [search, setSearch] = useState('')
  const [filterType, setFilterType] = useState('all')
  const [sortKey, setSortKey] = useState('ticker')
  const [sortDir, setSortDir] = useState('asc')

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

  const filtered = useMemo(() => {
    let list = [...syms]
    if (filterType !== 'all') list = list.filter((s) => s.type === filterType)
    if (search) {
      const q = search.toLowerCase()
      list = list.filter((s) => s.ticker.toLowerCase().includes(q) || s.name.toLowerCase().includes(q))
    }
    list.sort((a, b) => {
      const aVal = (a[sortKey] ?? '').toString().toLowerCase()
      const bVal = (b[sortKey] ?? '').toString().toLowerCase()
      return sortDir === 'asc' ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal)
    })
    return list
  }, [syms, filterType, search, sortKey, sortDir])

  function toggleSort(key) {
    if (sortKey === key) { setSortDir((d) => (d === 'asc' ? 'desc' : 'asc')) }
    else { setSortKey(key); setSortDir('asc') }
  }
  function sortIcon(key) { return sortKey === key ? (sortDir === 'asc' ? ' ↑' : ' ↓') : ' ↕' }

  const selected = syms.find((sym) => sym.id === selectedId)
  const selectedFreshness = selectedId ? freshnessBySymbol[selectedId] : null

  return (
    <div className="symbols-browser">
      <header className="sb-page-header">
        <p>{syms.length} symbol{syms.length !== 1 ? 's' : ''} in database · Showing {filtered.length} · Mode: {s.mode || '...'}</p>
      </header>

      <section className="sb-controls" style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap', alignItems: 'end' }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: '0.8rem' }}>
          Search
          <input type="text" placeholder="Ticker or name..." value={search} onChange={(e) => setSearch(e.target.value)} style={{ padding: '6px 10px', borderRadius: 6, border: '1px solid var(--line)', background: 'var(--panel)', color: 'var(--ink)', fontSize: '0.85rem' }} />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: '0.8rem' }}>
          Type
          <select value={filterType} onChange={(e) => setFilterType(e.target.value)} style={{ padding: '6px 10px', borderRadius: 6, border: '1px solid var(--line)', background: 'var(--panel)', color: 'var(--ink)', fontSize: '0.85rem' }}>
            <option value="all">All Types</option>
            {SYMBOL_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </label>
      </section>

      <section className="symbols-layout">
        <div className="symbols-list">
          <table className="symbols-table">
            <thead>
              <tr>
                <th onClick={() => toggleSort('ticker')} style={{ cursor: 'pointer' }}>Ticker{sortIcon('ticker')}</th>
                <th onClick={() => toggleSort('name')} style={{ cursor: 'pointer' }}>Name{sortIcon('name')}</th>
                <th onClick={() => toggleSort('exchange')} style={{ cursor: 'pointer' }}>Exchange{sortIcon('exchange')}</th>
                <th onClick={() => toggleSort('type')} style={{ cursor: 'pointer' }}>Type{sortIcon('type')}</th>
                <th>Freshness</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((sym) => {
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
                    <td><span className="sb-chip sb-chip--neutral">{sym.type}</span></td>
                    <td>
                      <span className={`sb-chip sb-chip--${f?.status === 'fresh' ? 'ok' : f?.status === 'stale' ? 'warn' : 'neutral'}`}>
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
                <span className={`sb-chip sb-chip--${selected.active ? 'ok' : 'warn'}`}>
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
                    <span className={`sb-chip sb-chip--${selectedFreshness.status === 'fresh' ? 'ok' : selectedFreshness.status === 'stale' ? 'warn' : 'neutral'}`}>
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
