import { useEffect, useMemo, useState } from 'react'
import { motion } from 'motion/react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiGet, apiPost } from '../core/api/client'
import { readSCRColumnVisibility } from '../core/screener-columns'
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

/**
 * Screener page (epic #682) — the app's ATTENTION funnel.
 * ========================================================
 * Layout order mirrors the funnel stages:
 *   1. Transparency strip   — what the app filtered out (decision 9)
 *   2. Toolbar              — source / My-DB / search filters
 *   3. Promote panel        — conditional, top of the table
 *   4. Stories panel        — conditional, per-ticker news lean
 *   5. Table                — ranked rows, top N highlighted
 *
 * attentionWeight is RELATIVE (0–100 vs the strongest current catalyst),
 * computed on read by the backend — never stored, never a score (#645).
 */
export default function ScreenerPage() {
  const [source, setSource] = useState('all')
  const [search, setSearch] = useState('')
  const [sortKey, setSortKey] = useState('attention')
  const [sortDir, setSortDir] = useState('desc')
  const [topPicks, setTopPicks] = useState(readTopPicks)
  const [selectedTicker, setSelectedTicker] = useState(null)
  const [onlyDb, setOnlyDb] = useState(false)
  const [promoteTicker, setPromoteTicker] = useState(null)
  const [watchChoice, setWatchChoice] = useState('')
  const [newListInput, setNewListInput] = useState('')
  const [catalystType, setCatalystType] = useState('all')
  // Column visibility — same registry as Screen Options (scr-col-* keys).
  const [cols, setCols] = useState(readSCRColumnVisibility)
  const queryClient = useQueryClient()

  const rankedQuery = useQuery({
    queryKey: ['screener-ranked'],
    queryFn: () => apiGet('/api/screener/ranked?limit=200'),
    refetchInterval: 60_000,
  })

  // Per-ticker news stories for the popover panel (#682 Phase 4.2) — one
  // round-trip per selection, so /ranked stays light.
  const storiesQuery = useQuery({
    queryKey: ['screener-stories', selectedTicker],
    queryFn: () => apiGet(`/api/screener/stories?ticker=${encodeURIComponent(selectedTicker)}`),
    enabled: !!selectedTicker,
    staleTime: 30_000,
  })

  // Per-ticker catalyst history for the detail panel (#682 Phase 4.3) —
  // reuses the existing GET /api/screener/hits?symbol= endpoint.
  const hitsQuery = useQuery({
    queryKey: ['screener-hits', selectedTicker],
    queryFn: () => apiGet(`/api/screener/hits?symbol=${encodeURIComponent(selectedTicker)}&limit=50`),
    enabled: !!selectedTicker,
    staleTime: 30_000,
  })

  // Watchlists for the promote chooser (#682 Phase 4.4).
  const watchlistsQuery = useQuery({
    queryKey: ['watchlists'],
    queryFn: () => apiGet('/api/watchlists'),
    enabled: !!promoteTicker,
    staleTime: 30_000,
  })

  const promoteMutation = useMutation({
    mutationFn: (body) => apiPost('/api/screener/promote', body),
    onSuccess: () => {
      // Refresh the ranked board (🔖 status flips) AND the watchlists cache —
      // the picker counts and the Watchlists page share the ['watchlists']
      // key, so this keeps both fresh after a promotion.
      queryClient.invalidateQueries({ queryKey: ['screener-ranked'] })
      queryClient.invalidateQueries({ queryKey: ['watchlists'] })
      setPromoteTicker(null)
      setWatchChoice('')
      setNewListInput('')
    },
  })

  /**
   * Maps the panel's pick onto the backend's watchlist-resolution order
   * (mirror of ScreenerService.promote): explicit id → new name → default
   * (empty body fields let the backend fall through to the default list).
   */
  function confirmPromote() {
    const wl = (watchlistsQuery.data ?? []).find((w) => w.id === watchChoice)
    const body = { ticker: promoteTicker }
    if (watchChoice === '__new__') {
      body.watchlistName = newListInput.trim() || 'Screener'
    } else if (wl) {
      body.watchlistId = wl.id
    }
    promoteMutation.mutate(body)
  }

  // Poll Screen Options settings (same-tab doesn't fire 'storage' events):
  // top-picks count + table column visibility.
  useEffect(() => {
    const t = setInterval(() => {
      const next = readTopPicks()
      setTopPicks((prev) => (prev !== next ? next : prev))
      const nextCols = readSCRColumnVisibility()
      setCols((prev) => (JSON.stringify(prev) === JSON.stringify(nextCols) ? prev : nextCols))
    }, 250)
    return () => clearInterval(t)
  }, [])

  const d = rankedQuery.data ?? {}
  const ranked = Array.isArray(d.ranked) ? d.ranked : []
  const universe = d.universe ?? {}

  // Distinct catalyst types across the ranked set — drives the type filter
  // chips (only types actually present are surfaced).
  const catalystTypes = useMemo(() => {
    const set = new Set()
    for (const r of ranked) for (const t of (r.catalystTypes ?? [])) set.add(t)
    return [...set].sort()
  }, [ranked])

  // Sort/filter pipeline. The accessors registry maps a sort key to a value
  // extractor; nulls always sink to the bottom regardless of direction.
  const filtered = useMemo(() => {
    const accessors = {
      ticker: (r) => r.ticker ?? '',
      catalyst: (r) => (r.catalystTypes ?? []).join(', '),
      source: (r) => (r.sources ?? []).join(', '),
      strength: (r) => r.strength ?? null,
      reliability: (r) => r.reliability ?? null,
      attention: (r) => r.attentionWeight ?? null,
      lean: (r) => r.lean ?? '',
      when: (r) => r.nextEventAt ?? r.latestTimestamp ?? null,
      hits: (r) => r.hitCount ?? 0,
    }
    let list = [...ranked]
    if (source !== 'all') list = list.filter((r) => (r.sources ?? []).includes(source))
    if (catalystType !== 'all') list = list.filter((r) => (r.catalystTypes ?? []).includes(catalystType))
    if (onlyDb) list = list.filter((r) => r.inDb)
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
  }, [ranked, source, search, sortKey, sortDir, onlyDb, catalystType])

  const topN = Math.min(parseInt(topPicks, 10) || 10, filtered.length)

  /** Toggle column sort; magnitude columns default to desc, names to asc. */
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
          <button
            type="button"
            className={`sc-chip ${onlyDb ? 'sc-chip-active' : ''}`}
            onClick={() => setOnlyDb((v) => !v)}
            title="Only show symbols that exist in your database (hides discovery candidates)"
          >
            My DB only
          </button>
        </div>
        <div className="sc-toolbar-chips">
          <span className="sc-chip-label">Type</span>
          <button
            type="button"
            className={`sc-chip ${catalystType === 'all' ? 'sc-chip-active' : ''}`}
            onClick={() => setCatalystType('all')}
          >
            All Types
          </button>
          {catalystTypes.map((t) => (
            <button
              key={t}
              type="button"
              className={`sc-chip ${catalystType === t ? 'sc-chip-active' : ''}`}
              onClick={() => setCatalystType(catalystType === t ? 'all' : t)}
            >
              {t}
            </button>
          ))}
        </div>
      </section>

      {/* Promote-to-watchlist panel (#682 Phase 4.4) — manual, 1:1 provenance.
          Plain conditional render: AnimatePresence exits freeze on this page
          (motion 12.40 bug), leaving an invisible click-blocking ghost. */}
      {promoteTicker && (
        <section className="sc-stories-panel sc-panel-enter">
          <header className="sc-stories-header">
            <h2>➕ Add {promoteTicker} to a watchlist</h2>
            <button type="button" className="sc-stories-close" onClick={() => setPromoteTicker(null)} aria-label="Close">✕</button>
          </header>
          <div className="sc-promote-row">
            <select
              className="sc-promote-select"
              value={watchChoice}
              onChange={(e) => setWatchChoice(e.target.value)}
            >
              <option value="">Default list (creates "Screener" if none)</option>
              {(watchlistsQuery.data ?? []).map((wl) => (
                <option key={wl.id} value={wl.id}>
                  {wl.label} ({wl.symbolCount}){wl.isDefault ? ' · default' : ''}
                </option>
              ))}
              <option value="__new__">＋ Create new list…</option>
            </select>
            {watchChoice === '__new__' && (
              <input
                className="sc-promote-input"
                type="text"
                placeholder="New watchlist name"
                value={newListInput}
                onChange={(e) => setNewListInput(e.target.value)}
              />
            )}
            <button
              className="sc-promote-confirm"
              disabled={promoteMutation.isPending}
              onClick={confirmPromote}
            >
              {promoteMutation.isPending ? 'Adding…' : 'Add to watchlist'}
            </button>
          </div>
          {promoteMutation.isError && <p className="sc-promote-err">Promotion failed — try again.</p>}
        </section>
      )}

      {/* Symbol detail popover (#682 Phase 4.2 + 4.3) — catalyst history
          from GET /api/screener/hits plus per-story LONG/SHORT news lean. */}
      {selectedTicker && (
        <section className="sc-stories-panel sc-panel-enter">
          <header className="sc-stories-header">
            <h2>🔎 {selectedTicker} — catalysts &amp; news</h2>
            <button
              type="button"
              className="sc-stories-close"
              onClick={() => setSelectedTicker(null)}
              aria-label="Close detail panel"
            >
              ✕
            </button>
          </header>

          <h3 className="sc-panel-subhead">Catalyst history</h3>
          {hitsQuery.isLoading && <p className="sc-state">Loading catalyst history…</p>}
          {!hitsQuery.isLoading && (!Array.isArray(hitsQuery.data?.hits) || hitsQuery.data.hits.length === 0) && (
            <p className="sc-state">No stored catalyst hits for this ticker.</p>
          )}
          {!hitsQuery.isLoading && hitsQuery.data?.hits?.length > 0 && (
            <ul className="sc-history-list">
              {hitsQuery.data.hits.map((h) => (
                <li key={h.id} className="sc-history-item">
                  <span className={`sc-chip sc-chip--${h.source}`}>{h.source}</span>
                  <span className="sc-history-type">{h.catalystType}</span>
                  <span className="sc-history-nums">strength {h.catalystStrength ?? '—'} · reliability {h.sourceReliability ?? '—'}</span>
                  <span className="sc-story-meta">{fmtWhen(null, h.timestamp)}</span>
                </li>
              ))}
            </ul>
          )}

          <h3 className="sc-panel-subhead">News stories</h3>
          {storiesQuery.isLoading && <p className="sc-state">Loading stories…</p>}
          {!storiesQuery.isLoading && (!Array.isArray(storiesQuery.data?.stories) || storiesQuery.data.stories.length === 0) && (
            <p className="sc-state">No trade-supporting news stories stored for this ticker.</p>
          )}
          {!storiesQuery.isLoading && storiesQuery.data?.stories?.length > 0 && (
            <ul className="sc-stories-list">
              {storiesQuery.data.stories.map((s) => (
                <li key={s.headline + (s.publishedAt || '')} className="sc-story">
                  <span className={`sc-lean sc-lean--${String(s.lean).toLowerCase()}`}>{s.lean}</span>
                  <a className="sc-story-headline" href={`https://www.google.com/search?q=${encodeURIComponent(s.headline)}`} target="_blank" rel="noreferrer">
                    {s.headline}
                  </a>
                  <span className="sc-story-meta">{s.source} · {fmtWhen(null, s.publishedAt)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

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
                {cols.catalyst && <th className="sc-th-sortable" onClick={() => toggleSort('catalyst')}>Catalyst{sortIcon('catalyst')}</th>}
                {cols.source && <th className="sc-th-sortable" onClick={() => toggleSort('source')}>Source{sortIcon('source')}</th>}
                {cols.lean && <th className="sc-th-sortable" onClick={() => toggleSort('lean')}>Lean{sortIcon('lean')}</th>}
                <th className="sc-col-action">Action</th>
                {cols.strength && <th className="sc-th-sortable" onClick={() => toggleSort('strength')}>Strength{sortIcon('strength')}</th>}
                {cols.reliability && <th className="sc-th-sortable" onClick={() => toggleSort('reliability')}>Reliab.{sortIcon('reliability')}</th>}
                <th className="sc-th-sortable" onClick={() => toggleSort('attention')}>Attention{sortIcon('attention')}</th>
                {cols.when && <th className="sc-th-sortable" onClick={() => toggleSort('when')}>When{sortIcon('when')}</th>}
                {cols.hits && <th className="sc-th-sortable" onClick={() => toggleSort('hits')}>Hits{sortIcon('hits')}</th>}
              </tr>
            </thead>
            <tbody>
              {filtered.map((r, i) => (
                <motion.tr
                  key={r.ticker}
                  className={[
                    i < topN ? 'sc-top-pick' : '',
                    selectedTicker === r.ticker ? 'sc-row-selected' : '',
                  ].filter(Boolean).join(' ') || undefined}
                  onClick={() => setSelectedTicker(selectedTicker === r.ticker ? null : r.ticker)}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.2, delay: Math.min(i * 0.012, 0.3) }}
                >
                  <td className="sc-col-pick">{i < topN ? '🎯' : ''}</td>
                  <td className="sc-ticker-cell">
                    <strong>{r.ticker}</strong>
                    {r.inDb ? <span className="sc-in-db" title="Symbol exists in your database">DB</span> : null}
                    {r.fitsCount > 0 ? (
                      <span className="sc-fits" title={`Fits ${r.fitsCount} protocol(s): ${(r.fitsProtocols ?? []).join(', ')}`}>
                        ✓{r.fitsCount}
                      </span>
                    ) : null}
                  </td>
                  {cols.catalyst && <td>{(r.catalystTypes ?? []).join(', ')}</td>}
                  {cols.source && (
                    <td>
                      {(r.sources ?? []).map((s) => (
                        <span key={s} className={`sc-chip sc-chip--${s}`}>{s}</span>
                      ))}
                    </td>
                  )}
                  {cols.lean && (
                    <td>
                      {r.lean ? (
                        <span className={`sc-lean sc-lean--${String(r.lean).toLowerCase()}`} title={r.storyCount ? `${r.storyCount} news storie(s)` : undefined}>
                          {r.lean}{r.storyCount > 0 ? ` 📰${r.storyCount}` : ''}
                        </span>
                      ) : <span className="pnl-none">—</span>}
                    </td>
                  )}
                  <td className="sc-col-action">
                    {r.promotedStatus ? (
                      <span className="sc-watching" title={`Already in a watchlist (${r.promotedStatus})`}>🔖 {r.promotedStatus}</span>
                    ) : (
                      <button
                        type="button"
                        className="sc-watch-btn"
                        title="Add to watchlist"
                        onClick={(e) => { e.stopPropagation(); setPromoteTicker(r.ticker) }}
                      >
                        ➕ Watch
                      </button>
                    )}
                  </td>
                  {cols.strength && <td>{r.strength}</td>}
                  {cols.reliability && <td>{r.reliability}</td>}
                  <td>
                    <div className="sc-attn-cell">
                      <span className="sc-attn-num">{r.attentionWeight}</span>
                      <span className="sc-attn-bar">
                        <span className="sc-attn-fill" style={{ width: `${Math.min(100, Math.max(0, r.attentionWeight))}%` }} />
                      </span>
                    </div>
                  </td>
                  {cols.when && <td className="sc-when">{fmtWhen(r.nextEventAt, r.latestTimestamp)}</td>}
                  {cols.hits && <td>{r.hitCount}</td>}
                </motion.tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </main>
  )
}
