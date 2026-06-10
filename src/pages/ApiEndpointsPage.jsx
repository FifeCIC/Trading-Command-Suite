import { useMemo, useState } from 'react'
import endpointCatalog from '../data/endpoint-catalog.seed.json'
import './trading-platforms.css'

const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']

function titleFromId(id) {
  return id.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

function confidenceClass(level) {
  if (level === 'confirmed') return 'tp-chip--ok'
  if (level === 'likely') return 'tp-chip--neutral'
  if (level === 'uncertain') return 'tp-chip--warn'
  return 'tp-chip--warn'
}

const CATEGORY_LABELS = {
  account: 'Account', portfolio: 'Portfolio', reference: 'Reference',
  order_management: 'Orders', market_data: 'Market Data', quotes: 'Quotes',
  historical: 'Historical', streaming: 'Streaming', bars: 'Bars',
}

export default function ApiEndpointsPage() {
  const providerEntries = Object.entries(endpointCatalog.providers)
  const providerIds = providerEntries.map(([id]) => id)

  const [selectedProvider, setSelectedProvider] = useState(providerIds[0] || '')
  const [methodFilter, setMethodFilter] = useState('ALL')
  const [categoryFilter, setCategoryFilter] = useState('ALL')
  const [sortKey, setSortKey] = useState('path')
  const [sortDir, setSortDir] = useState('asc')
  const [search, setSearch] = useState('')

  const provider = endpointCatalog.providers[selectedProvider]

  const endpoints = useMemo(() => {
    if (!provider?.endpoints) return []
    let list = [...provider.endpoints]

    if (methodFilter !== 'ALL') list = list.filter((ep) => ep.method === methodFilter)
    if (categoryFilter !== 'ALL') list = list.filter((ep) => ep.category === categoryFilter)
    if (search) {
      const q = search.toLowerCase()
      list = list.filter((ep) =>
        ep.displayName.toLowerCase().includes(q) ||
        ep.path.toLowerCase().includes(q) ||
        ep.id.toLowerCase().includes(q) ||
        (ep.description || '').toLowerCase().includes(q),
      )
    }

    list.sort((a, b) => {
      const aVal = (a[sortKey] ?? '').toString().toLowerCase()
      const bVal = (b[sortKey] ?? '').toString().toLowerCase()
      return sortDir === 'asc' ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal)
    })

    return list
  }, [provider, methodFilter, categoryFilter, search, sortKey, sortDir])

  const categories = useMemo(() => {
    const set = new Set()
    if (provider?.endpoints) provider.endpoints.forEach((ep) => set.add(ep.category))
    return [...set].sort()
  }, [provider])

  const rateLimitCategories = endpointCatalog.rateLimitCategories || {}
  const payloadClasses = endpointCatalog.payloadClasses || {}

  function toggleSort(key) {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortKey(key)
      setSortDir('asc')
    }
  }

  function sortIcon(key) {
    if (sortKey !== key) return ' ↕'
    return sortDir === 'asc' ? ' ↑' : ' ↓'
  }

  return (
    <div className="trading-platforms-page">
      <header className="tp-page-header">
        <h1>API Endpoint Catalog</h1>
        <p>
          Complete endpoint registry for strategic providers. {endpointCatalog.providers ? Object.keys(endpointCatalog.providers).length : 0} providers,{' '}
          {Object.values(endpointCatalog.providers).reduce((sum, p) => sum + (p.endpoints?.length || 0), 0)} endpoints.
        </p>
        <p className="tp-source-meta">
          Schema v{endpointCatalog.$meta?.schemaVersion} · Generated {new Date(endpointCatalog.$meta?.generatedAt).toLocaleDateString()}
        </p>
      </header>

      <section className="tp-card tp-controls-card">
        <h3>Filters</h3>
        <div className="tp-controls-grid" style={{ alignItems: 'end' }}>
          <label className="tp-control">
            <span>Provider</span>
            <select value={selectedProvider} onChange={(e) => setSelectedProvider(e.target.value)}>
              {providerIds.map((id) => (
                <option key={id} value={id}>{endpointCatalog.providers[id].displayName}</option>
              ))}
            </select>
          </label>
          <label className="tp-control">
            <span>Method</span>
            <select value={methodFilter} onChange={(e) => setMethodFilter(e.target.value)}>
              <option value="ALL">All Methods</option>
              {METHODS.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </label>
          <label className="tp-control">
            <span>Category</span>
            <select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)}>
              <option value="ALL">All Categories</option>
              {categories.map((c) => (
                <option key={c} value={c}>{CATEGORY_LABELS[c] || titleFromId(c)}</option>
              ))}
            </select>
          </label>
          <label className="tp-control">
            <span>Search</span>
            <input
              type="text"
              placeholder="Filter endpoints..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </label>
        </div>
      </section>

      {provider && (
        <>
          <section className="tp-card">
            <h3>{provider.displayName} — Provider Info</h3>
            <div className="tp-controls-grid">
              <div><span className="k">Type</span> <span className="v">{provider.providerType}</span></div>
              <div><span className="k">Auth</span> <span className="v">{provider.auth?.method}</span></div>
              <div>
                <span className="k">Adapter</span>
                <span className={`tp-chip ${provider.adapterStatus?.implemented ? 'tp-chip--ok' : 'tp-chip--warn'}`} style={{ marginLeft: 8 }}>
                  {provider.adapterStatus?.implemented ? (provider.adapterStatus?.isMockOnly ? 'Mock' : 'Live') : 'None'}
                </span>
              </div>
              <div><span className="k">Rate Limit</span> <span className="v">{provider.rateLimitProfile?.paidTier?.requestsPerMinute ?? '?'}/min</span></div>
              <div><span className="k">Latency</span> <span className="v">~{provider.freshnessSLA?.expectedLatencyMs ?? '?'}ms</span></div>
            </div>
          </section>

          <section className="tp-card tp-comparison-card">
            <h3>Endpoints ({endpoints.length})</h3>
            <div className="tp-comparison-wrap">
              <table className="tp-comparison-table">
                <thead>
                  <tr>
                    <th onClick={() => toggleSort('method')} style={{ cursor: 'pointer', width: 70 }}>Method{sortIcon('method')}</th>
                    <th onClick={() => toggleSort('path')} style={{ cursor: 'pointer' }}>Path{sortIcon('path')}</th>
                    <th onClick={() => toggleSort('category')} style={{ cursor: 'pointer', width: 100 }}>Category{sortIcon('category')}</th>
                    <th>Description</th>
                    <th onClick={() => toggleSort('confidence')} style={{ cursor: 'pointer', width: 90 }}>Confidence{sortIcon('confidence')}</th>
                    <th style={{ width: 110 }}>Rate Limit</th>
                    <th style={{ width: 90 }}>Pagination</th>
                  </tr>
                </thead>
                <tbody>
                  {endpoints.map((ep) => {
                    const rlCategory = rateLimitCategories[ep.rateLimitCategory]
                    const rlLabel = rlCategory?.label || ep.rateLimitCategory || '—'
                    return (
                      <tr key={ep.id}>
                        <td><span className={`tp-chip ${ep.method === 'GET' ? 'tp-chip--ok' : ep.method === 'POST' ? 'tp-chip--neutral' : 'tp-chip--warn'}`}>{ep.method}</span></td>
                        <td><code>{ep.path}</code></td>
                        <td>{CATEGORY_LABELS[ep.category] || titleFromId(ep.category)}</td>
                        <td className="tp-cell-note">{ep.description || '—'}</td>
                        <td><span className={`tp-chip ${confidenceClass(ep.confidence)}`}>{ep.confidence}</span></td>
                        <td className="tp-cell-note" title={rlCategory?.notes || ''}>{rlLabel}</td>
                        <td><span className="tp-chip tp-chip--neutral">{ep.paginationSupport === 'none' ? '—' : ep.paginationSupport}</span></td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </section>

          {provider.endpoints && provider.endpoints.length > 0 && (
            <section className="tp-card">
              <h3>Endpoint Distribution</h3>
              <div className="tp-provider-pills">
                {categories.map((cat) => {
                  const count = provider.endpoints.filter((ep) => ep.category === cat).length
                  const confCount = provider.endpoints.filter((ep) => ep.category === cat && ep.confidence === 'confirmed').length
                  return (
                    <span key={cat} className="tp-provider-pill" style={{ cursor: 'default' }}>
                      {CATEGORY_LABELS[cat] || titleFromId(cat)}: {count} ({confCount} confirmed)
                    </span>
                  )
                })}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  )
}
