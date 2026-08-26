import { useEffect, useMemo, useState } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import { useQuery } from '@tanstack/react-query'
import { apiGet } from '../core/api/client'
import StarToggle from '../components/StarToggle'
import { formatCurrency, formatPct } from '../core/format-utils'
import { SB_COLUMNS, readSBColumnVisibility } from '../core/symbols-browser-columns'
import './symbols-browser.css'

const SYMBOL_TYPES = ['stock', 'crypto', 'forex']

/** marketCap is stored in millions → render as $X.XXB / $X.XXM. */
function fmtMarketCap(mc) {
  if (mc == null || Number.isNaN(mc)) return '—'
  if (mc >= 1000) return `$${(mc / 1000).toFixed(2)}B`
  if (mc >= 1) return `$${mc.toFixed(2)}M`
  return `$${mc.toFixed(2)}M`
}

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

  const positions = useQuery({
    queryKey: ['symbols-positions'],
    queryFn: () => apiGet('/api/symbols/positions'),
    refetchInterval: 60000,
  })

  const s = symbols.data ?? {}
  const syms = Array.isArray(s.symbols) ? s.symbols : []
  const f = freshness.data ?? {}
  const freshes = Array.isArray(f.results) ? f.results : []
  const freshnessBySymbol = Object.fromEntries(freshes.map((r) => [r.symbolId, r]))

  const posData = positions.data ?? {}
  const posRows = Array.isArray(posData.positions) ? posData.positions : []
  const positionByTicker = Object.fromEntries(posRows.map((p) => [p.symbol.toUpperCase(), p]))
  function positionFor(sym) {
    return sym ? positionByTicker[sym.ticker.toUpperCase()] : null
  }

  const filtered = useMemo(() => {
    let list = [...syms]
    if (filterType !== 'all') list = list.filter((sym) => sym.type === filterType)
    if (search) {
      const q = search.toLowerCase()
      list = list.filter((sym) => sym.ticker.toLowerCase().includes(q) || sym.name.toLowerCase().includes(q))
    }
    list.sort((a, b) => {
      const accessors = {
        ticker: (sym) => sym.ticker ?? '',
        name: (sym) => sym.name ?? '',
        exchange: (sym) => sym.exchange ?? '',
        type: (sym) => sym.type ?? '',
        active: (sym) => (sym.active ? 1 : 0),
        tags: (sym) => (Array.isArray(sym.tags) ? sym.tags.join(', ') : ''),
        aliases: (sym) => (sym.aliases && typeof sym.aliases === 'object' ? Object.keys(sym.aliases).join(', ') : ''),
        position: (sym) => (positionFor(sym) ? 1 : 0),
        provider: (sym) => positionFor(sym)?.provider ?? '',
        quantity: (sym) => positionFor(sym)?.quantity ?? null,
        avgPrice: (sym) => positionFor(sym)?.avgPrice ?? null,
        currentPrice: (sym) => positionFor(sym)?.currentPrice ?? null,
        pnl: (sym) => positionFor(sym)?.pnl ?? null,
        pnlPct: (sym) => positionFor(sym)?.pnlPct ?? null,
        fresh: (sym) => freshnessBySymbol[sym.id]?.status ?? '',
        freshAge: (sym) => freshnessBySymbol[sym.id]?.ageMinutes ?? null,
        freshTimeframe: (sym) => freshnessBySymbol[sym.id]?.timeframe ?? '',
        freshLatest: (sym) => freshnessBySymbol[sym.id]?.latestTimestamp ?? null,
        created: (sym) => sym.createdAt ?? null,
        updated: (sym) => sym.updatedAt ?? null,
        id: (sym) => sym.id ?? '',
      }
      const get = accessors[sortKey] || ((sym) => sym[sortKey] ?? '')
      const av = get(a)
      const bv = get(b)
      if (av == null && bv == null) return 0
      if (av == null) return 1 // nulls always sort last
      if (bv == null) return -1
      let cmp
      if (typeof av === 'number' && typeof bv === 'number') cmp = av - bv
      else cmp = String(av).toLowerCase().localeCompare(String(bv).toLowerCase(), undefined, { numeric: true })
      return sortDir === 'asc' ? cmp : -cmp
    })
    return list
  }, [syms, filterType, search, sortKey, sortDir, posRows, freshes])

  // Auto-select the first symbol (falls back gracefully when the current
  // selection is filtered out) — mirrors the directives-registry behaviour.
  const selected = useMemo(() => {
    if (!filtered.length) return null
    return filtered.find((sym) => sym.id === selectedId) ?? filtered[0]
  }, [filtered, selectedId])

  const snapshot = useQuery({
    queryKey: ['symbol-snapshot', selected?.id],
    queryFn: () => apiGet(`/api/symbols/${selected.ticker}/snapshot`),
    enabled: !!selected,
    staleTime: 30_000,
  })

  const snap = snapshot.data ?? {}
  const company = snap.company ?? {}
  const ranges = snap.ranges ?? {}
  const selectedFreshness = selected ? freshnessBySymbol[selected.id] : null
  const selectedPos = positionFor(selected)

  // Optional table columns — configured via Screen Options (gear) → Table Columns.
  const [columns, setColumns] = useState(readSBColumnVisibility)

  // Poll localStorage for Screen Options changes (same-tab doesn't fire 'storage' event).
  useEffect(() => {
    const interval = setInterval(() => {
      const next = readSBColumnVisibility()
      setColumns((prev) => {
        for (const key of Object.keys(next)) {
          if (prev[key] !== next[key]) return next
        }
        return prev
      })
    }, 250)
    return () => clearInterval(interval)
  }, [])

  function toggleSort(key) {
    if (sortKey === key) { setSortDir((d) => (d === 'asc' ? 'desc' : 'asc')) }
    else { setSortKey(key); setSortDir('asc') }
  }
  function sortIcon(key) { return sortKey === key ? (sortDir === 'asc' ? ' ↑' : ' ↓') : ' ↕' }

  function freshnessTone(st) {
    if (st === 'fresh') return 'ok'
    if (st === 'stale') return 'warn'
    return 'neutral'
  }

  /** Render one table cell for a symbol + column. */
  function renderCell(sym, col, fr, pos) {
    switch (col.key) {
      case 'star':
        return <StarToggle itemType="symbol" itemId={sym.id} size={16} />
      case 'ticker':
        return <strong>{sym.ticker}</strong>
      case 'name':
        return sym.name
      case 'exchange':
        return sym.exchange
      case 'type':
        return <span className="sb-chip sb-chip--neutral">{sym.type}</span>
      case 'active':
        return sym.active
          ? <span className="sb-chip sb-chip--ok">Active</span>
          : <span className="sb-chip sb-chip--warn">Inactive</span>
      case 'tags': {
        const tags = Array.isArray(sym.tags) ? sym.tags : []
        return tags.length ? <span className="sb-tags-text">{tags.join(', ')}</span> : <span className="pnl-none">—</span>
      }
      case 'aliases': {
        const keys = sym.aliases && typeof sym.aliases === 'object' ? Object.keys(sym.aliases) : []
        return keys.length ? <span className="sb-tags-text">{keys.join(', ')}</span> : <span className="pnl-none">—</span>
      }
      case 'position':
        return pos
          ? <span className="sb-chip sb-chip--ok" title={`Held via ${pos.provider} · ${pos.quantity} units`}>Held</span>
          : <span className="pnl-none">—</span>
      case 'provider':
        return pos ? pos.provider : <span className="pnl-none">—</span>
      case 'quantity':
        return pos && pos.quantity != null
          ? pos.quantity.toLocaleString(undefined, { maximumFractionDigits: 4 })
          : <span className="pnl-none">—</span>
      case 'avgPrice':
        return pos && pos.avgPrice != null ? formatCurrency(pos.avgPrice) : <span className="pnl-none">—</span>
      case 'currentPrice':
        return pos && pos.currentPrice != null ? formatCurrency(pos.currentPrice) : <span className="pnl-none">—</span>
      case 'pnl':
        return pos && pos.pnl != null
          ? (
            <span className={`pnl-cell ${pos.pnl >= 0 ? 'pnl--pos' : 'pnl--neg'}`} title={pos.pnlPct != null ? `P&L ${formatPct(pos.pnlPct)}` : undefined}>
              {formatCurrency(pos.pnl, { showZero: true })}
            </span>
          )
          : <span className="pnl-none">—</span>
      case 'pnlPct':
        return pos && pos.pnlPct != null
          ? <span className={`pnl-cell ${pos.pnlPct >= 0 ? 'pnl--pos' : 'pnl--neg'}`}>{formatPct(pos.pnlPct)}</span>
          : <span className="pnl-none">—</span>
      case 'fresh':
        return (
          <span className={`sb-chip sb-chip--${freshnessTone(fr?.status)}`}>
            {fr?.status ?? '...'}
          </span>
        )
      case 'freshAge':
        return fr?.ageMinutes != null ? `${fr.ageMinutes.toFixed(0)} min` : <span className="pnl-none">—</span>
      case 'freshTimeframe':
        return fr?.timeframe ? fr.timeframe : <span className="pnl-none">—</span>
      case 'freshLatest':
        return fr?.latestTimestamp ? new Date(fr.latestTimestamp).toLocaleString() : <span className="pnl-none">—</span>
      case 'created':
        return sym.createdAt ? new Date(sym.createdAt).toLocaleDateString() : <span className="pnl-none">—</span>
      case 'updated':
        return sym.updatedAt ? new Date(sym.updatedAt).toLocaleDateString() : <span className="pnl-none">—</span>
      case 'id':
        return <code className="sb-id-code">{sym.id}</code>
      default:
        return null
    }
  }

  return (
    <main className="symbols-page">
      <header className="sb-page-header">
        <h1>Symbols Browser</h1>
        <p>
          {syms.length} symbol{syms.length !== 1 ? 's' : ''} in database ·
          Showing {filtered.length} · Mode: {s.mode || '...'}
        </p>
      </header>

      <section className="symbols-toolbar">
        <div className="symbols-toolbar-row">
          <label>Search</label>
          <input
            type="text"
            placeholder="Ticker or name..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="symbols-toolbar-row">
          <label>Type</label>
          <select value={filterType} onChange={(e) => setFilterType(e.target.value)}>
            <option value="all">All Types</option>
            {SYMBOL_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
        <div className="symbols-toolbar-stats">
          <span>Total <strong>{syms.length}</strong></span>
          <span>Shown <strong>{filtered.length}</strong></span>
        </div>
      </section>

      <section className="symbols-layout">
        <div className="symbols-table-wrap">
          <table className="symbols-table">
            <thead>
              <tr>
                {SB_COLUMNS.filter((c) => columns[c.key]).map((c) => {
                  const sortable = c.key !== 'star'
                  const sorted = sortable && sortKey === c.key
                  return (
                    <th
                      key={c.key}
                      aria-sort={sorted ? (sortDir === 'asc' ? 'ascending' : 'descending') : undefined}
                      className={[
                        c.key === 'star' ? 'sb-col-star' : '',
                        sortable ? 'sb-th-sortable' : '',
                        sorted ? 'sb-sorted' : '',
                      ].filter(Boolean).join(' ') || undefined}
                      onClick={sortable ? () => toggleSort(c.key) : undefined}
                    >
                      {c.label}{sortable ? sortIcon(c.key) : ''}
                    </th>
                  )
                })}
              </tr>
            </thead>
            <tbody>
              {filtered.map((sym, i) => {
                const fr = freshnessBySymbol[sym.id]
                const pos = positionFor(sym)
                const rowSelected = selected?.id === sym.id
                return (
                  <motion.tr
                    key={sym.id}
                    className={`symbol-row ${rowSelected ? 'is-selected' : ''}`}
                    onClick={() => setSelectedId(selectedId === sym.id ? null : sym.id)}
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.2, delay: Math.min(i * 0.015, 0.3) }}
                  >
                    {SB_COLUMNS.filter((c) => columns[c.key]).map((c) => (
                      <td
                        key={c.key}
                        className={c.key === 'star' ? 'sb-col-star' : undefined}
                        onClick={c.key === 'star' ? (e) => e.stopPropagation() : undefined}
                      >
                        {renderCell(sym, c, fr, pos)}
                      </td>
                    ))}
                  </motion.tr>
                )
              })}
            </tbody>
          </table>
        </div>

        <AnimatePresence>
        {selected && (
          <motion.aside
            className="symbol-detail-rail"
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 20 }}
            transition={{ duration: 0.2 }}
          >
            <header className="symbol-detail-header">
              <div className="symbol-detail-header-row">
                <h2>{selected.ticker}</h2>
                <StarToggle itemType="symbol" itemId={selected.id} size={18} />
              </div>
              <p className="symbol-name">{company.name || selected.name}</p>
              <div className="symbol-detail-meta-row">
                <span className="sb-chip sb-chip--neutral">{company.type || selected.type || '—'}</span>
                <span className="sb-chip sb-chip--neutral">{company.exchange || selected.exchange || '—'}</span>
                <span className={`sb-chip sb-chip--${selected.active ? 'ok' : 'warn'}`}>
                  {selected.active ? 'Active' : 'Inactive'}
                </span>
              </div>
            </header>

            <section className="symbol-detail-section">
              <h3>Company</h3>
              <div className="detail-grid">
                <div className="detail-item">
                  <span className="detail-label">Sector</span>
                  <span className="detail-value">{company.sector ?? '—'}</span>
                </div>
                <div className="detail-item">
                  <span className="detail-label">Industry</span>
                  <span className="detail-value">{company.industry ?? '—'}</span>
                </div>
                <div className="detail-item">
                  <span className="detail-label">Market Cap</span>
                  <span className="detail-value">{fmtMarketCap(company.marketCap)}</span>
                </div>
                <div className="detail-item">
                  <span className="detail-label">Price</span>
                  <span className="detail-value">{snap.price != null ? formatCurrency(snap.price) : '—'}</span>
                </div>
              </div>
            </section>

            <section className="symbol-detail-section">
              <h3>Ranges</h3>
              <div className="detail-grid">
                <div className="detail-item">
                  <span className="detail-label">Day High</span>
                  <span className="detail-value">{ranges.dayHigh != null ? formatCurrency(ranges.dayHigh) : '—'}</span>
                </div>
                <div className="detail-item">
                  <span className="detail-label">Day Low</span>
                  <span className="detail-value">{ranges.dayLow != null ? formatCurrency(ranges.dayLow) : '—'}</span>
                </div>
                <div className="detail-item">
                  <span className="detail-label">Hist. High</span>
                  <span className="detail-value">{ranges.historicalHigh != null ? formatCurrency(ranges.historicalHigh) : '—'}</span>
                </div>
                <div className="detail-item">
                  <span className="detail-label">Hist. Low</span>
                  <span className="detail-value">{ranges.historicalLow != null ? formatCurrency(ranges.historicalLow) : '—'}</span>
                </div>
              </div>
            </section>

            {selectedFreshness && (
              <section className="symbol-detail-section">
                <h3>Data Freshness</h3>
                <div className="detail-grid">
                  <div className="detail-item">
                    <span className="detail-label">Status</span>
                    <span className={`sb-chip sb-chip--${freshnessTone(selectedFreshness.status)}`}>
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
                    <span className="detail-value">{selectedFreshness.timeframe ?? '—'}</span>
                  </div>
                </div>
              </section>
            )}

            <section className="symbol-detail-section">
              <h3>Position</h3>
              {selectedPos ? (
                <div className="detail-grid">
                  <div className="detail-item">
                    <span className="detail-label">Status</span>
                    <span className="sb-chip sb-chip--ok">Held</span>
                  </div>
                  <div className="detail-item">
                    <span className="detail-label">Broker</span>
                    <span className="detail-value">{selectedPos.provider ?? '—'}</span>
                  </div>
                  <div className="detail-item">
                    <span className="detail-label">Quantity</span>
                    <span className="detail-value">{selectedPos.quantity != null ? selectedPos.quantity.toLocaleString(undefined, { maximumFractionDigits: 4 }) : '—'}</span>
                  </div>
                  <div className="detail-item">
                    <span className="detail-label">Avg Cost</span>
                    <span className="detail-value">{selectedPos.avgPrice != null ? formatCurrency(selectedPos.avgPrice) : '—'}</span>
                  </div>
                  <div className="detail-item">
                    <span className="detail-label">Current</span>
                    <span className="detail-value">{selectedPos.currentPrice != null ? formatCurrency(selectedPos.currentPrice) : '—'}</span>
                  </div>
                  <div className="detail-item">
                    <span className="detail-label">P&L</span>
                    <span className={`detail-value ${selectedPos.pnl >= 0 ? 'pnl--pos' : 'pnl--neg'}`}>
                      {selectedPos.pnl != null ? formatCurrency(selectedPos.pnl, { showZero: true }) : '—'}
                      {selectedPos.pnlPct != null ? ` (${formatPct(selectedPos.pnlPct)})` : ''}
                    </span>
                  </div>
                </div>
              ) : (
                <p className="symbol-detail-empty">No current position or holding.</p>
              )}
            </section>

            <section className="symbol-detail-section">
              <h3>Timestamps</h3>
              <div className="detail-grid">
                <div className="detail-item">
                  <span className="detail-label">Created</span>
                  <span className="detail-value">{selected.createdAt ? new Date(selected.createdAt).toLocaleString() : '—'}</span>
                </div>
                <div className="detail-item">
                  <span className="detail-label">Updated</span>
                  <span className="detail-value">{selected.updatedAt ? new Date(selected.updatedAt).toLocaleString() : '—'}</span>
                </div>
              </div>
            </section>

            <section className="symbol-detail-section">
              <h3>ID</h3>
              <code className="symbol-id-code">{selected.id}</code>
            </section>
          </motion.aside>
        )}
        </AnimatePresence>
      </section>
    </main>
  )
}
