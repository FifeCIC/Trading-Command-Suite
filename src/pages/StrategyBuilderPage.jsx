import { useState, useEffect, useMemo } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { apiGet, apiPost } from '../core/api/client'
import LoadingSkeleton from '../components/LoadingSkeleton'
import StarToggle from '../components/StarToggle'
import DirectivePalette from '../components/StrategyBuilder/DirectivePalette'
import StrategyCanvas from '../components/StrategyBuilder/StrategyCanvas'
import '../core/forms.css'
import '../components/StrategyBuilder/strategy-builder.css'

// Heuristic: derive compatible symbol types from directive category
function getCompatibleTypes(directive) {
  const cat = (directive.category || '').toLowerCase();
  const id = (directive.id || '').toLowerCase();
  // Crypto-specific directives
  if (cat.includes('crypto') || id.includes('crypto') || id.includes('btc')) return ['crypto'];
  // Forex-specific directives
  if (cat.includes('forex') || id.includes('forex') || id.includes('fx-')) return ['forex'];
  // Most directives work for all symbol types
  return ['stock', 'crypto', 'forex'];
}

export default function StrategyBuilderPage() {
  const [canvasIds, setCanvasIds] = useState([])
  const [weights, setWeights] = useState({})
  // Strategy metadata
  const [strategyName, setStrategyName] = useState('')
  const [description, setDescription] = useState('')
  const [selectedWatchlist, setSelectedWatchlist] = useState('')
  const [savedMsg, setSavedMsg] = useState('')
  const [metaOpen, setMetaOpen] = useState(true)

  // Fetch directives from live API
  const directivesQuery = useQuery({
    queryKey: ['directives'],
    queryFn: () => apiGet('/api/directives').catch(() => []),
    staleTime: 60_000,
  })
  const directives = directivesQuery.data ?? []

  // Fetch watchlists for the selector
  const watchlistsQuery = useQuery({
    queryKey: ['watchlists'],
    queryFn: () => apiGet('/api/watchlists').catch(() => ({ watchlists: [] })),
    staleTime: 30_000,
  })
  const watchlists = watchlistsQuery.data?.watchlists ?? []

  // Fetch saved strategies
  const savedQuery = useQuery({
    queryKey: ['saved-strategies'],
    queryFn: () => apiGet('/api/strategies/saved'),
    staleTime: 30_000,
  })
  const savedStrategies = savedQuery.data?.strategies ?? []

  // Fetch selected watchlist detail (for symbol type detection)
  const watchlistDetailQuery = useQuery({
    queryKey: ['watchlist-detail', selectedWatchlist],
    queryFn: () => selectedWatchlist ? apiGet(`/api/watchlists/${selectedWatchlist}`).catch(() => null) : Promise.resolve(null),
    staleTime: 60_000,
    enabled: !!selectedWatchlist,
  })
  const watchlistSymbols = watchlistDetailQuery.data?.symbols ?? []

  // Derive symbol types in the selected watchlist
  const watchlistTypes = useMemo(() => {
    if (!watchlistSymbols.length) return []
    return [...new Set(watchlistSymbols.map(s => s.type).filter(Boolean))]
  }, [watchlistSymbols])

  // Check if any canvas directive is type-mismatched with the selected watchlist
  const typeMismatches = useMemo(() => {
    if (!watchlistTypes.length || !canvasIds.length) return []
    return canvasIds.filter(id => {
      const dir = directives.find(d => d.id === id)
      if (!dir) return false
      const compat = getCompatibleTypes(dir)
      // Directive is mismatched if none of the watchlist types are compatible
      return !watchlistTypes.some(t => compat.includes(t))
    }).map(id => {
      const dir = directives.find(d => d.id === id)
      return { id, name: dir?.name || id, compat: getCompatibleTypes(dir || {}) }
    })
  }, [watchlistTypes, canvasIds, directives])

  // Save mutation
  const saveMutation = useMutation({
    mutationFn: () => apiPost('/api/strategies', {
      name: strategyName || 'Untitled Protocol',
      description,
      watchlistId: selectedWatchlist || null,
      directives: canvasIds.map(id => ({ id, weight: weights[id] || 10 })),
    }),
    onSuccess: () => {
      setSavedMsg('Strategy saved!')
      setTimeout(() => setSavedMsg(''), 3000)
      savedQuery.refetch()
    },
  })

  function handleDragStart(e, directive) {
    e.dataTransfer.setData('application/json', JSON.stringify({ id: directive.id }))
    e.dataTransfer.effectAllowed = 'copy'
  }

  function handleWeightChange(id, weight) {
    setWeights((prev) => ({ ...prev, [id]: weight }))
  }

  function handleRemove(id) {
    setCanvasIds((prev) => prev.filter((i) => i !== id))
    setWeights((prev) => {
      const next = { ...prev }
      delete next[id]
      return next
    })
  }

  function handleAddToCanvas(id) {
    if (!canvasIds.includes(id)) {
      setCanvasIds((prev) => [...prev, id])
      setWeights((prev) => ({ ...prev, [id]: prev[id] || 10 }))
    }
  }

  function handleReset() {
    setCanvasIds([])
    setWeights({})
  }

  // ---- Loading state ----
  if (directivesQuery.isLoading && !directivesQuery.data) {
    return (
      <div className="sb-page">
        <header className="sb-header">
        </header>
        <div className="sb-layout">
          <LoadingSkeleton variant="card" count={6} />
          <LoadingSkeleton variant="card" count={3} />
        </div>
      </div>
    )
  }

  return (
    <div className="sb-page">
      <header className="sb-header">
        <h1>Protocol Builder</h1>
        <p className="sb-subtitle" style={{fontSize:'0.82rem',color:'var(--ink-soft)',margin:'0.2rem 0 0'}}>Create a protocol by selecting directives from the palette. Protocols define WHAT to score — individual directives contribute evidence. Note: some directives are symbol-type-specific — ensure your chosen symbols match.</p>
      </header>

      {/* Collapsible metadata form toggle */}
      <button
        type="button"
        className="sb-meta-toggle"
        onClick={() => setMetaOpen((v) => !v)}
      >
        <span className={`sb-meta-toggle-arrow${metaOpen ? ' sb-meta-toggle-arrow--open' : ''}`}>▶</span>
        Protocol Details {metaOpen ? '' : '(hidden)'}
      </button>

      {/* Strategy metadata form */}
      <div className={`sb-meta-form${metaOpen ? '' : ' sb-meta-form--collapsed'}`}>
        <div className="ff-row-2">
          <label className="ff-field">
            <span className="ff-label">Protocol Name</span>
            <input
              type="text"
              value={strategyName}
              onChange={(e) => setStrategyName(e.target.value)}
              placeholder="e.g., Tech Dip Accumulation"
              className="ff-input"
            />
          </label>
          <label className="ff-field">
            <span className="ff-label">Watchlist</span>
            <select
              value={selectedWatchlist}
              onChange={(e) => setSelectedWatchlist(e.target.value)}
              className="ff-select"
            >
              <option value="">— All active symbols —</option>
              {watchlists.map((w) => (
                <option key={w.id} value={w.id}>{w.name} ({w.symbols?.length ?? 0} symbols)</option>
              ))}
            </select>
            {watchlistTypes.length > 0 && (
              <span className="sb-type-tags">
                {watchlistTypes.map(t => (
                  <span key={t} className={`sb-type-tag sb-type-${t}`}>{t}</span>
                ))}
              </span>
            )}
          </label>
        </div>
        {/* Type mismatch warning */}
        {typeMismatches.length > 0 && (
          <div className="sb-mismatch-warning">
            ⚠️ These directives may not be compatible with the selected watchlist's symbol types ({watchlistTypes.join(', ')}):
            <ul>
              {typeMismatches.map(m => (
                <li key={m.id}>{m.name} — compatible with: {m.compat.join(', ')}</li>
              ))}
            </ul>
          </div>
        )}
        <div className="ff-row-2">
          <label className="ff-field">
            <span className="ff-label">Description</span>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What does this protocol aim to do?"
              className="ff-textarea"
              rows={2}
            />
          </label>

        </div>
        <div className="sb-meta-actions">
          <button
            type="button"
            className="sb-btn sb-btn-save"
            disabled={canvasIds.length === 0 || saveMutation.isPending}
            onClick={() => saveMutation.mutate()}
          >
            {saveMutation.isPending ? 'Saving...' : 'Save Protocol'}
          </button>
          <button type="button" className="sb-btn sb-btn-reset" onClick={handleReset}>
            Reset Canvas
          </button>
          {savedMsg && <span className="sb-saved-msg">{savedMsg}</span>}
        </div>
      </div>

      {/* Saved strategies sidebar toggle */}
      {savedStrategies.length > 0 && (
        <details className="sb-saved-list">
          <summary>Saved Protocols ({savedStrategies.length})</summary>
          <div className="sb-saved-grid">
            {savedStrategies.map((s) => (
              <button
                key={s.id}
                type="button"
                className="sb-saved-card"
                onClick={() => {
                  setStrategyName(s.name || '')
                  setDescription(s.description || '')
                  setSelectedWatchlist(s.watchlistId || '')
                  const dirIds = (s.directives || []).map(d => d.id)
                  setCanvasIds(dirIds)
                  const w = {}
                  ;(s.directives || []).forEach(d => { w[d.id] = d.weight })
                  setWeights(w)
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <StarToggle itemType="strategy" itemId={s.id} size={16} />
                  <strong>{s.name}</strong>
                </div>
                <span className="sb-saved-meta">
                  {s.directives?.length || 0} directives
                  {s.directives?.length ? ` · ${s.directives.length} directives` : ''}
                </span>
              </button>
            ))}
          </div>
        </details>
      )}

      <div className="sb-layout">
        <DirectivePalette
          directives={directives}
          onDragStart={handleDragStart}
        />

        <StrategyCanvas
          directives={canvasIds}
          weights={weights}
          directivesMeta={directives}
          onWeightChange={(id, w) => {
            handleWeightChange(id, w)
            // If the directive isn't in the canvas yet, add it
            if (!canvasIds.includes(id)) {
              handleAddToCanvas(id)
            }
          }}
          onRemove={handleRemove}
          onReset={handleReset}
        />
      </div>
    </div>
  )
}
