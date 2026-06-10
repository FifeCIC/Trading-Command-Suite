import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { apiGet, apiPost, apiPatch } from '../core/api/client'
import './trading-platforms.css'

const SYMBOL_TYPES = ['stock', 'crypto', 'forex']

export default function ActiveSymbolsPage() {
  const queryClient = useQueryClient()
  const [showAdd, setShowAdd] = useState(false)
  const [filterActive, setFilterActive] = useState('all')
  const [filterType, setFilterType] = useState('all')
  const [form, setForm] = useState({ ticker: '', name: '', exchange: '', type: 'stock' })
  const [adding, setAdding] = useState(false)
  const [error, setError] = useState(null)

  const symbols = useQuery({
    queryKey: ['active-symbols'],
    queryFn: () => apiGet('/api/symbols'),
    refetchInterval: 30_000,
  })

  const syms = Array.isArray(symbols.data?.symbols) ? symbols.data.symbols : []
  const mode = symbols.data?.mode ?? '...'

  const filtered = syms.filter((s) => {
    if (filterActive === 'active' && !s.active) return false
    if (filterActive === 'inactive' && s.active !== false) return false
    if (filterType !== 'all' && s.type !== filterType) return false
    return true
  })

  const activeCount = syms.filter((s) => s.active !== false).length
  const inactiveCount = syms.filter((s) => s.active === false).length

  async function toggleActive(sym) {
    try {
      await apiPatch(`/api/symbols/${sym.id}`, { active: !(sym.active !== false) })
      queryClient.invalidateQueries({ queryKey: ['active-symbols'] })
    } catch (e) {
      setError(`Failed to update ${sym.ticker}: ${e.message}`)
    }
  }

  async function addSymbol(e) {
    e.preventDefault()
    if (!form.ticker || !form.name || !form.exchange) {
      setError('Ticker, name, and exchange are required.')
      return
    }
    setAdding(true)
    setError(null)
    try {
      await apiPost('/api/symbols', form)
      setForm({ ticker: '', name: '', exchange: '', type: 'stock' })
      setShowAdd(false)
      queryClient.invalidateQueries({ queryKey: ['active-symbols'] })
    } catch (e) {
      setError(`Failed to add symbol: ${e.message}`)
    } finally {
      setAdding(false)
    }
  }

  return (
    <div className="trading-platforms-page">
      <header className="tp-page-header">
        <h1>Active Symbols</h1>
        <p>
          {syms.length} symbol{syms.length !== 1 ? 's' : ''} total · {activeCount} active · {inactiveCount} inactive · Mode: {mode}
        </p>
      </header>

      {error && (
        <div className="tp-banner-retry" style={{ marginBottom: 16 }}>
          {error}
          <button type="button" onClick={() => setError(null)} style={{ marginLeft: 12 }}>Dismiss</button>
        </div>
      )}

      <section className="tp-card tp-controls-card">
        <h3>Filters & Actions</h3>
        <div className="tp-controls-grid" style={{ alignItems: 'end' }}>
          <label className="tp-control">
            <span>Status</span>
            <select value={filterActive} onChange={(e) => setFilterActive(e.target.value)}>
              <option value="all">All ({syms.length})</option>
              <option value="active">Active ({activeCount})</option>
              <option value="inactive">Inactive ({inactiveCount})</option>
            </select>
          </label>
          <label className="tp-control">
            <span>Type</span>
            <select value={filterType} onChange={(e) => setFilterType(e.target.value)}>
              <option value="all">All Types</option>
              {SYMBOL_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </label>
          <button type="button" className="btn btn-primary" onClick={() => setShowAdd(!showAdd)}>
            {showAdd ? 'Cancel' : '+ Add Symbol'}
          </button>
        </div>
      </section>

      {showAdd && (
        <section className="tp-card">
          <h3>Add New Symbol</h3>
          <form onSubmit={addSymbol} className="tp-controls-grid" style={{ alignItems: 'end' }}>
            <label className="tp-control">
              <span>Ticker *</span>
              <input type="text" value={form.ticker} onChange={(e) => setForm({ ...form, ticker: e.target.value.toUpperCase() })} placeholder="AAPL" maxLength={20} />
            </label>
            <label className="tp-control">
              <span>Name *</span>
              <input type="text" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Apple Inc." maxLength={200} />
            </label>
            <label className="tp-control">
              <span>Exchange *</span>
              <input type="text" value={form.exchange} onChange={(e) => setForm({ ...form, exchange: e.target.value })} placeholder="NASDAQ" maxLength={50} />
            </label>
            <label className="tp-control">
              <span>Type</span>
              <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
                {SYMBOL_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </label>
            <button type="submit" className="btn btn-primary" disabled={adding}>
              {adding ? 'Adding...' : 'Add Symbol'}
            </button>
          </form>
        </section>
      )}

      <section className="tp-card tp-comparison-card">
        <h3>Symbols ({filtered.length})</h3>
        <div className="tp-comparison-wrap">
          <table className="tp-comparison-table">
            <thead>
              <tr>
                <th>Ticker</th>
                <th>Name</th>
                <th>Exchange</th>
                <th>Type</th>
                <th>Status</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((sym) => {
                const isActive = sym.active !== false
                return (
                  <tr key={sym.id}>
                    <td><strong>{sym.ticker}</strong></td>
                    <td>{sym.name}</td>
                    <td>{sym.exchange}</td>
                    <td><span className="tp-chip tp-chip--neutral">{sym.type}</span></td>
                    <td>
                      <span className={`tp-chip ${isActive ? 'tp-chip--ok' : 'tp-chip--warn'}`}>
                        {isActive ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td>
                      <button
                        type="button"
                        className={`btn ${isActive ? '' : 'btn-primary'}`}
                        onClick={() => toggleActive(sym)}
                        style={{ padding: '4px 12px', fontSize: '0.85rem' }}
                      >
                        {isActive ? 'Deactivate' : 'Activate'}
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}
