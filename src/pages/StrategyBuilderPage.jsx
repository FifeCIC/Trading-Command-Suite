import { useState, useEffect } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { apiGet, apiPost } from '../core/api/client'
import LoadingSkeleton from '../components/LoadingSkeleton'
import StarToggle from '../components/StarToggle'
import DirectivePalette from '../components/StrategyBuilder/DirectivePalette'
import StrategyCanvas from '../components/StrategyBuilder/StrategyCanvas'
import '../components/StrategyBuilder/strategy-builder.css'

export default function StrategyBuilderPage() {
  const [canvasIds, setCanvasIds] = useState([])
  const [weights, setWeights] = useState({})
  // Strategy metadata
  const [strategyName, setStrategyName] = useState('')
  const [description, setDescription] = useState('')
  const [goals, setGoals] = useState('')
  const [symbolFocus, setSymbolFocus] = useState('')
  const [savedMsg, setSavedMsg] = useState('')
  const [metaOpen, setMetaOpen] = useState(true)

  // Fetch directives from live API
  const directivesQuery = useQuery({
    queryKey: ['directives'],
    queryFn: () => apiGet('/api/directives'),
    staleTime: 60_000,
  })
  const directives = directivesQuery.data ?? []

  // Fetch saved strategies
  const savedQuery = useQuery({
    queryKey: ['saved-strategies'],
    queryFn: () => apiGet('/api/strategies/saved'),
    staleTime: 30_000,
  })
  const savedStrategies = savedQuery.data?.strategies ?? []

  // Save mutation
  const saveMutation = useMutation({
    mutationFn: () => apiPost('/api/strategies', {
      name: strategyName || 'Untitled Strategy',
      description,
      goals,
      symbolFocus: symbolFocus ? symbolFocus.split(',').map(s => s.trim()).filter(Boolean) : [],
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
        <h1>Strategy Builder</h1>
        <Link to="/scoring/strategy-wizard" style={{ fontSize: '0.8rem', color: 'var(--accent, #0ea5a6)' }}>🧙 Try the Strategy Wizard →</Link>
      </header>

      {/* Collapsible metadata form toggle */}
      <button
        type="button"
        className="sb-meta-toggle"
        onClick={() => setMetaOpen((v) => !v)}
      >
        <span className={`sb-meta-toggle-arrow${metaOpen ? ' sb-meta-toggle-arrow--open' : ''}`}>▶</span>
        Strategy Details {metaOpen ? '' : '(hidden)'}
      </button>

      {/* Strategy metadata form */}
      <div className={`sb-meta-form${metaOpen ? '' : ' sb-meta-form--collapsed'}`}>
        <div className="sb-meta-row">
          <label>
            <span>Strategy Name</span>
            <input
              type="text"
              value={strategyName}
              onChange={(e) => setStrategyName(e.target.value)}
              placeholder="e.g., Tech Dip Accumulation"
              className="sb-input"
            />
          </label>
          <label>
            <span>Symbol Focus (comma-separated)</span>
            <input
              type="text"
              value={symbolFocus}
              onChange={(e) => setSymbolFocus(e.target.value)}
              placeholder="e.g., NVDA, AAPL, TSLA"
              className="sb-input"
            />
          </label>
        </div>
        <div className="sb-meta-row">
          <label>
            <span>Description</span>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What does this strategy aim to do?"
              className="sb-input sb-textarea"
              rows={2}
            />
          </label>
          <label>
            <span>Goals</span>
            <textarea
              value={goals}
              onChange={(e) => setGoals(e.target.value)}
              placeholder="e.g., Target 5% monthly, Focus on tech pullbacks"
              className="sb-input sb-textarea"
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
            {saveMutation.isPending ? 'Saving...' : 'Save Strategy'}
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
          <summary>Saved Strategies ({savedStrategies.length})</summary>
          <div className="sb-saved-grid">
            {savedStrategies.map((s) => (
              <button
                key={s.id}
                type="button"
                className="sb-saved-card"
                onClick={() => {
                  setStrategyName(s.name || '')
                  setDescription(s.description || '')
                  setGoals(s.goals || '')
                  setSymbolFocus((s.symbolFocus || []).join(', '))
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
                  {s.symbolFocus?.length ? ` · ${s.symbolFocus.slice(0,3).join(', ')}` : ''}
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
