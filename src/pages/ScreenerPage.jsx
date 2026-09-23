import { useEffect, useMemo, useState } from 'react'
import { motion } from 'motion/react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiGet, apiPost } from '../core/api/client'
import { readSCRColumnVisibility } from '../core/screener-columns'
import './screener.css'

const SOURCES = ['all', 'news', 'earnings']
const TOP_PICK_CHOICES = ['5', '10', '15', '20', '25']

/**
 * COLUMN_HELP — what each screener column MEANS and HOW the number is derived.
 *
 * WHY THIS EXISTS (owner's report, 2026-09-23): *"Hovering over values on the screen table doesn't
 * explain what the value is and how we get it."* A bare `94` in a column headed "Strength" is
 * unreadable — the reader cannot tell whether it is a percentage, a count, a rank, or how close to
 * the ceiling it is. Applied to BOTH the `<th>` and the value `<td>` so the explanation is
 * available wherever the eye already is.
 *
 * ⚠️ Every formula below is quoted from the implementation, not inferred from the column name:
 * `nest/src/modules/screener/screener.service.ts` — `screenerRawWeight()`, `screenerRecency()`,
 * `normalizeAttentionWeights()` and the per-ticker aggregation loop. If that service changes, these
 * strings are wrong and must change with it. Two of them are genuinely counter-intuitive:
 *
 *   • Strength and Reliab. are MAXIMUMS across the ticker's hits, NOT averages.
 *   • Attention is RELATIVE — normalised against the strongest row in the current set, so the top
 *     row is 100 by construction and the number is only meaningful against its neighbours. It is
 *     not an absolute score and comparing it across two different loads is meaningless.
 */
const COLUMN_HELP = {
  ticker: 'The symbol itself, as recorded in the catalyst hits.',
  catalyst: 'Which kinds of catalyst produced this row — news, earnings, or both.',
  source: 'Which providers contributed hits for this symbol.',
  lean:
    'Direction the attached news stories lean. COUNTED from the stories: LONG if more lean LONG ' +
    'than SHORT, SHORT if the reverse, NEUTRAL on a tie. “—” means no stories are attached, which ' +
    'is not the same as a neutral view.',
  strength:
    'Strength of this symbol\u2019s STRONGEST catalyst, 0–100. ' +
    'HOW: max(catalystStrength) over every hit for the ticker — deliberately the MAXIMUM, not the ' +
    'average, so one strong earnings date is not buried by a dozen minor news mentions.',
  reliability:
    'Reliability of the BEST source that reported on this symbol, 0–100. ' +
    'HOW: max(sourceReliability) over every hit. A hit whose source states no reliability is ' +
    'counted as 50 — the neutral default of the underlying column — so 50 may mean "unknown".',
  attention:
    'How much this symbol stands out RELATIVE to the strongest row in the list currently loaded. ' +
    'HOW: strength × reliability × recency, then rescaled so the highest raw weight in the set ' +
    'becomes 100. \u26a0\ufe0f The top row therefore always reads 100 — the number is only meaningful ' +
    'beside its neighbours in the same load, NOT as an absolute score and NOT across two loads.',
  when:
    'The next FUTURE event date if one exists, otherwise how long ago the latest hit arrived. ' +
    'Recency weighting uses this: future events score 1/(1+daysAway); past items decay by half ' +
    'every 24 hours.',
  hits: 'How many catalyst hits this symbol has on record — a COUNT of rows, not a score.',
};

/** Tooltip for a column: “Label — meaning”. Falls back to undefined (no tooltip) if unknown. */
function helpFor(key, label) {
  const help = COLUMN_HELP[key];
  return help ? `${label} — ${help}` : undefined;
}

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
      <header className="screener-page-header">
        <h1>Screener</h1>
        <p>
          Attention-ranked catalysts — news and earnings events that deserve a look
          before conviction scoring. The top {topN} are your picks.
        </p>
      </header>

      {/* Transparency strip (#682 decision 9) — what the app filtered out */}
      <section className="screener-transparency">
        <div className="screener-trans-item">
          <strong>{universe.totalSymbols ?? '—'}</strong>
          <span>symbols in DB</span>
        </div>
        <div className="screener-trans-item screener-trans-hit">
          <strong>{universe.hitSymbols ?? ranked.length}</strong>
          <span>with recent catalysts</span>
        </div>
        <div className="screener-trans-item screener-trans-quiet">
          <strong>{universe.quietSymbols ?? '—'}</strong>
          <span>quiet — filtered out</span>
        </div>
        <div className="screener-trans-item">
          <strong>{filtered.length}</strong>
          <span>shown · top {topN} picked</span>
        </div>
      </section>

      <section className="screener-toolbar">
        <div className="screener-toolbar-search">
          <label htmlFor="screener-search">Search</label>
          <input
            id="screener-search"
            type="text"
            placeholder="Ticker..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="screener-toolbar-chips">
          {SOURCES.map((s) => (
            <button
              key={s}
              type="button"
              className={`screener-chip ${source === s ? 'screener-chip-active' : ''}`}
              onClick={() => setSource(s)}
            >
              {s === 'all' ? 'All Sources' : s}
            </button>
          ))}
          <button
            type="button"
            className={`screener-chip ${onlyDb ? 'screener-chip-active' : ''}`}
            onClick={() => setOnlyDb((v) => !v)}
            title="Only show symbols that exist in your database (hides discovery candidates)"
          >
            My DB only
          </button>
        </div>
        <div className="screener-toolbar-chips">
          <span className="screener-chip-label">Type</span>
          <button
            type="button"
            className={`screener-chip ${catalystType === 'all' ? 'screener-chip-active' : ''}`}
            onClick={() => setCatalystType('all')}
          >
            All Types
          </button>
          {catalystTypes.map((t) => (
            <button
              key={t}
              type="button"
              className={`screener-chip ${catalystType === t ? 'screener-chip-active' : ''}`}
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
        <section className="screener-stories-panel screener-panel-enter">
          <header className="screener-stories-header">
            <h2>➕ Add {promoteTicker} to a watchlist</h2>
            <button type="button" className="screener-stories-dismiss" onClick={() => setPromoteTicker(null)} aria-label="Close">✕</button>
          </header>
          <div className="screener-promote-row">
            <select
              className="screener-promote-select"
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
                className="screener-promote-input"
                type="text"
                placeholder="New watchlist name"
                value={newListInput}
                onChange={(e) => setNewListInput(e.target.value)}
              />
            )}
            <button
              className="screener-promote-confirm"
              disabled={promoteMutation.isPending}
              onClick={confirmPromote}
            >
              {promoteMutation.isPending ? 'Adding…' : 'Add to watchlist'}
            </button>
          </div>
          {promoteMutation.isError && <p className="screener-promote-err">Promotion failed — try again.</p>}
        </section>
      )}

      {/* Symbol detail popover (#682 Phase 4.2 + 4.3) — catalyst history
          from GET /api/screener/hits plus per-story LONG/SHORT news lean. */}
      {selectedTicker && (
        <section className="screener-stories-panel screener-panel-enter">
          <header className="screener-stories-header">
            <h2>🔎 {selectedTicker} — catalysts &amp; news</h2>
            <button
              type="button"
              className="screener-stories-dismiss"
              onClick={() => setSelectedTicker(null)}
              aria-label="Close detail panel"
            >
              ✕
            </button>
          </header>

          <h3 className="screener-panel-subhead">Catalyst history</h3>
          {hitsQuery.isLoading && <p className="screener-state">Loading catalyst history…</p>}
          {!hitsQuery.isLoading && (!Array.isArray(hitsQuery.data?.hits) || hitsQuery.data.hits.length === 0) && (
            <p className="screener-state">No stored catalyst hits for this ticker.</p>
          )}
          {!hitsQuery.isLoading && hitsQuery.data?.hits?.length > 0 && (
            <ul className="screener-history-list">
              {hitsQuery.data.hits.map((h) => (
                <li key={h.id} className="screener-history-item">
                  <span className={`screener-chip screener-chip--${h.source}`}>{h.source}</span>
                  <span className="screener-history-type">{h.catalystType}</span>
                  <span className="screener-history-nums">strength {h.catalystStrength ?? '—'} · reliability {h.sourceReliability ?? '—'}</span>
                  <span className="screener-story-meta">{fmtWhen(null, h.timestamp)}</span>
                </li>
              ))}
            </ul>
          )}

          <h3 className="screener-panel-subhead">News stories</h3>
          {storiesQuery.isLoading && <p className="screener-state">Loading stories…</p>}
          {!storiesQuery.isLoading && (!Array.isArray(storiesQuery.data?.stories) || storiesQuery.data.stories.length === 0) && (
            <p className="screener-state">No trade-supporting news stories stored for this ticker.</p>
          )}
          {!storiesQuery.isLoading && storiesQuery.data?.stories?.length > 0 && (
            <ul className="screener-stories-list">
              {storiesQuery.data.stories.map((s) => (
                <li key={s.headline + (s.publishedAt || '')} className="screener-story">
                  <span className={`screener-lean screener-lean--${String(s.lean).toLowerCase()}`}>{s.lean}</span>
                  <a className="screener-story-headline" href={`https://www.google.com/search?q=${encodeURIComponent(s.headline)}`} target="_blank" rel="noreferrer">
                    {s.headline}
                  </a>
                  <span className="screener-story-meta">{s.source} · {fmtWhen(null, s.publishedAt)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      <section className="screener-table-wrap">
        {isLoading && <p className="screener-state">Loading catalysts…</p>}
        {isError && !isLoading && (
          <p className="screener-state">Couldn't load the screener feed. Retrying…</p>
        )}
        {!isLoading && !isError && filtered.length === 0 && (
          <p className="screener-state">No catalysts match. Try another source or clear the search.</p>
        )}
        {!isLoading && filtered.length > 0 && (
          <table className="screener-table">
            <thead>
              <tr>
                <th className="screener-col-pick">🎯</th>
                <th className="screener-th-sortable" title={helpFor('ticker', 'Ticker')} onClick={() => toggleSort('ticker')}>Ticker{sortIcon('ticker')}</th>
                {cols.catalyst && <th className="screener-th-sortable" title={helpFor('catalyst', 'Catalyst')} onClick={() => toggleSort('catalyst')}>Catalyst{sortIcon('catalyst')}</th>}
                {cols.source && <th className="screener-th-sortable" title={helpFor('source', 'Source')} onClick={() => toggleSort('source')}>Source{sortIcon('source')}</th>}
                {cols.lean && <th className="screener-th-sortable" title={helpFor('lean', 'Lean')} onClick={() => toggleSort('lean')}>Lean{sortIcon('lean')}</th>}
                <th className="screener-col-action">Action</th>
                {cols.strength && <th className="screener-th-sortable" title={helpFor('strength', 'Strength')} onClick={() => toggleSort('strength')}>Strength{sortIcon('strength')}</th>}
                {cols.reliability && <th className="screener-th-sortable" title={helpFor('reliability', 'Reliab.')} onClick={() => toggleSort('reliability')}>Reliab.{sortIcon('reliability')}</th>}
                <th className="screener-th-sortable" title={helpFor('attention', 'Attention')} onClick={() => toggleSort('attention')}>Attention{sortIcon('attention')}</th>
                {cols.when && <th className="screener-th-sortable" title={helpFor('when', 'When')} onClick={() => toggleSort('when')}>When{sortIcon('when')}</th>}
                {cols.hits && <th className="screener-th-sortable" title={helpFor('hits', 'Hits')} onClick={() => toggleSort('hits')}>Hits{sortIcon('hits')}</th>}
              </tr>
            </thead>
            <tbody>
              {filtered.map((r, i) => (
                <motion.tr
                  key={r.ticker}
                  className={[
                    i < topN ? 'screener-top-pick' : '',
                    selectedTicker === r.ticker ? 'screener-row-selected' : '',
                  ].filter(Boolean).join(' ') || undefined}
                  onClick={() => setSelectedTicker(selectedTicker === r.ticker ? null : r.ticker)}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.2, delay: Math.min(i * 0.012, 0.3) }}
                >
                  <td className="screener-col-pick">{i < topN ? '🎯' : ''}</td>
                  <td className="screener-ticker-cell">
                    <strong>{r.ticker}</strong>
                    {r.inDb ? <span className="screener-in-db" title="Symbol exists in your database">DB</span> : null}
                    {r.fitsCount > 0 ? (
                      <span className="screener-fits" title={`Fits ${r.fitsCount} protocol(s): ${(r.fitsProtocols ?? []).join(', ')}`}>
                        ✓{r.fitsCount}
                      </span>
                    ) : null}
                  </td>
                  {cols.catalyst && <td>{(r.catalystTypes ?? []).join(', ')}</td>}
                  {cols.source && (
                    <td>
                      {(r.sources ?? []).map((s) => (
                        <span key={s} className={`screener-chip screener-chip--${s}`}>{s}</span>
                      ))}
                    </td>
                  )}
                  {cols.lean && (
                    <td>
                      {r.lean ? (
                        <span className={`screener-lean screener-lean--${String(r.lean).toLowerCase()}`} title={r.storyCount ? `${r.storyCount} news storie(s)` : undefined}>
                          {r.lean}{r.storyCount > 0 ? ` 📰${r.storyCount}` : ''}
                        </span>
                      ) : <span className="pnl-none">—</span>}
                    </td>
                  )}
                  <td className="screener-col-action">
                    {r.promotedStatus ? (
                      <span className="screener-watching" title={`Already in a watchlist (${r.promotedStatus})`}>🔖 {r.promotedStatus}</span>
                    ) : (
                      <button
                        type="button"
                        className="screener-watch-btn"
                        title="Add to watchlist"
                        onClick={(e) => { e.stopPropagation(); setPromoteTicker(r.ticker) }}
                      >
                        ➕ Watch
                      </button>
                    )}
                  </td>
                  {cols.strength && <td title={helpFor('strength', `Strength ${r.strength}`)}>{r.strength}</td>}
                  {cols.reliability && <td title={helpFor('reliability', `Reliability ${r.reliability}`)}>{r.reliability}</td>}
                  <td>
                    <div className="screener-attn-cell" title={helpFor('attention', `Attention ${r.attentionWeight}`)}>
                      <span className="screener-attn-num">{r.attentionWeight}</span>
                      <span className="screener-attn-bar">
                        <span className="screener-attn-fill" style={{ width: `${Math.min(100, Math.max(0, r.attentionWeight))}%` }} />
                      </span>
                    </div>
                  </td>
                  {cols.when && <td className="screener-when" title={helpFor('when', 'When')}>{fmtWhen(r.nextEventAt, r.latestTimestamp)}</td>}
                  {cols.hits && <td title={helpFor('hits', `${r.hitCount} hit(s)`)}>{r.hitCount}</td>}
                </motion.tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </main>
  )
}
