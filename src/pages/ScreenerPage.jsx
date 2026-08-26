import { useEffect, useMemo, useState } from 'react'
import { motion } from 'motion/react'
import { useQuery } from '@tanstack/react-query'
import { apiGet } from '../core/api/client'
import './screener.css'

const SOURCES = ['all', 'news', 'earnings']
const TOP_PICK_CHOICES = ['5', '10', '15', '20', '25']

/** Top-picks count — Screen Options setting (same key as the registry). */
function readTopPicks() {
  try {
    const v = localStorage.getItem('scr-top-picks')
    return TOP_PICK_CHOICES.includes(v) ? v : '10'
  } catch {
    return '10'
  }
}

function fmtWhen(nextEventAt, latestTimestamp) {
  const now = Date.now()
  if (nextEventAt) {
    const t = new Date(nextEventAt).getTime()
    const days = Math.round((t - now) / 86_400_000)
    const label = days <= 0 ? 'today' : days === 1 ? 'in 1d' : `in ${days}d`
    return `${new Date(nextEventAt).toLocaleDateString()} (${label})`
  }
  if (latestTimestamp) {
    const ageH = Math.max(0, (now - new Date(latestTimestamp).getTime()) / 3_600_000)
    if (ageH < 1) return 'just now'
    if (ageH < 24) return `${Math.round(ageH)}h ago`
    return `${Math.round(ageH / 24)}d ago`
  }
  return '—'
}

export default function ScreenerPage() {
  const [source, setSource] = useState('all')
  const [search, setSearch] = useState('')
  const [sortKey, setSortKey] = useState('attention')
  const [sortDir, setSortDir] = useState('desc')
  const [topPicks, setTopPicks] = useState(readTopPicks)

  const rankedQuery = useQuery({
    queryKey: ['screener-ranked'],
    queryFn: () => apiGet('/api/screener/ranked?limit=200'),
    refetchInterval: 60_000,
  })

  // Poll Screen Options top-picks setting (same-tab doesn't fire 'storage' event).
  useEffect(() => {
    const t = setInterval(() => {
      const next = readTopPicks()
      setTopPicks((prev) => (prev !== next ? next : prev))
    }, 250)
    return () => clearInterval(t)
  }, [])

  const d = rankedQuery.data ?? {}
  const ranked = Array.isArray(d.ranked) ? d.ranked : []
  const universe = d.universe ?? {}

  const filtered = useMemo(() => {
    const accessors = {
      ticker: (r) => r.ticker ?? '',
      catalyst: (r) => (r.catalystTypes ?? []).join(', '),
      source: (r) => (r.sources ?? []).join(', '),
      strength: (r) => r.strength ?? null,
      reliability: (r) => r.reliability ?? null,
      attention: (r) => r.attentionWeight ?? null,
      when: (r) => r.nextEventAt ?? r.latestTimestamp ?? null,
      hits: (r) => r.hitCount ?? 0,
    }
    let list = [...ranked]
    if (source !== 'all') list = list.filter((r) => (r.sources ?? []).includes(source))
    if (search) {
      const q = search.toLowerCase()
      list = list.filter((r) => r.ticker.toLowerCase().includes(q))
    }
    list.sort((a, b) => {
      const get = accessors[sortKey] || ((r) => r[sortKey] ?? '')
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
  }, [ranked, source, search, sortKey, sortDir])

  const topN = Math.min(parseInt(topPicks, 10) || 10, filtered.length)

  function toggleSort(key) {
    if (sortKey === key) { setSortDir((dir) => (dir === 'asc' ? 'desc' : 'asc')) }
    else { setSortKey(key); setSortDir(key === 'attention' || key === 'strength' || key === 'reliability' || key === 'hits' ? 'desc' : 'asc') }
  }
  function sortIcon(key) { return sortKey === key ? (sortDir === 'asc' ? ' ↑' : ' ↓') : ' ↕' }

  const isLoading = rankedQuery.isLoading
  const isError = rankedQuery.isError

  return (
    <main className="screener-page">
      <header className="sc-page-header">
        <h1>Screener</h1>
        <p>
          Attention-ranked catalysts — news and earnings events that deserve a look
          before conviction scoring. The top {topN} are your picks.
        </p>
      </header>

      {/* Transparency strip (#682 decision 9) — what the app filtered out */}
      <section className="sc-transparency">
        <div className="sc-trans-item">
          <strong>{universe.totalSymbols ?? '—'}</strong>
          <span>symbols in DB</span>
        </div>
        <div className="sc-trans-item sc-trans-hit">
          <strong>{universe.hitSymbols ?? ranked.length}</strong>
          <span>with recent catalysts</span>
        </div>
        <div className="sc-trans-item sc-trans-quiet">
          <strong>{universe.quietSymbols ?? '—'}</strong>
          <span>quiet — filtered out</span>
        </div>
        <div className="sc-trans-item">
          <strong>{filtered.length}</strong>
          <span>shown · top {topN} picked</span>
        </div>
      </section>

      <section className="sc-toolbar">
        <div className="sc-toolbar-search">
          <label htmlFor="sc-search">Search</label>
          <input
            id="sc-search"
            type="text"
            placeholder="Ticker..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="sc-toolbar-chips">
          {SOURCES.map((s) => (
            <button
              key={s}
              type="button"
              className={`sc-chip ${source === s ? 'sc-chip-active' : ''}`}
              onClick={() => setSource(s)}
            >
              {s === 'all' ? 'All Sources' : s}
            </button>
          ))}
        </div>
      </section>

      <section className="sc-table-wrap">
        {isLoading && <p className="sc-state">Loading catalysts…</p>}
        {isError && !isLoading && (
          <p className="sc-state">Couldn't load the screener feed. Retrying…</p>
        )}
        {!isLoading && !isError && filtered.length === 0 && (
          <p className="sc-state">No catalysts match. Try another source or clear the search.</p>
        )}
        {!isLoading && filtered.length > 0 && (
          <table className="sc-table">
            <thead>
              <tr>
                <th className="sc-col-pick">🎯</th>
                <th className="sc-th-sortable" onClick={() => toggleSort('ticker')}>Ticker{sortIcon('ticker')}</th>
                <th className="sc-th-sortable" onClick={() => toggleSort('catalyst')}>Catalyst{sortIcon('catalyst')}</th>
                <th className="sc-th-sortable" onClick={() => toggleSort('source')}>Source{sortIcon('source')}</th>
                <th className="sc-th-sortable" onClick={() => toggleSort('strength')}>Strength{sortIcon('strength')}</th>
                <th className="sc-th-sortable" onClick={() => toggleSort('reliability')}>Reliab.{sortIcon('reliability')}</th>
                <th className="sc-th-sortable" onClick={() => toggleSort('attention')}>Attention{sortIcon('attention')}</th>
                <th className="sc-th-sortable" onClick={() => toggleSort('when')}>When{sortIcon('when')}</th>
                <th className="sc-th-sortable" onClick={() => toggleSort('hits')}>Hits{sortIcon('hits')}</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r, i) => (
                <motion.tr
                  key={r.ticker}
                  className={i < topN ? 'sc-top-pick' : ''}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.2, delay: Math.min(i * 0.012, 0.3) }}
                >
                  <td className="sc-col-pick">{i < topN ? '🎯' : ''}</td>
                  <td className="sc-ticker-cell">
                    <strong>{r.ticker}</strong>
                    {r.inDb ? <span className="sc-in-db" title="Symbol exists in your database">DB</span> : null}
                  </td>
                  <td>{(r.catalystTypes ?? []).join(', ')}</td>
                  <td>
                    {(r.sources ?? []).map((s) => (
                      <span key={s} className={`sc-chip sc-chip--${s}`}>{s}</span>
                    ))}
                  </td>
                  <td>{r.strength}</td>
                  <td>{r.reliability}</td>
                  <td>
                    <div className="sc-attn-cell">
                      <span className="sc-attn-num">{r.attentionWeight}</span>
                      <span className="sc-attn-bar">
                        <span className="sc-attn-fill" style={{ width: `${Math.min(100, Math.max(0, r.attentionWeight))}%` }} />
                      </span>
                    </div>
                  </td>
                  <td className="sc-when">{fmtWhen(r.nextEventAt, r.latestTimestamp)}</td>
                  <td>{r.hitCount}</td>
                </motion.tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </main>
  )
}
