/**
 * StrategyCanvas
 * ==============
 * Right panel: drop zone for directives. Shows dropped directives with
 * weight sliders, running total, and save button.
 */

import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import DirectiveCard from './DirectiveCard'
import './strategy-builder.css'

const CATEGORY_COLORS = {
  Momentum: '#6366f1',
  Trend: '#0ea5a6',
  Volatility: '#f59e0b',
  Participation: '#10b981',
  Pattern: '#ec4899',
  Volume: '#8b5cf6',
  Macro: '#ef4444',
}

export default function StrategyCanvas({ directives, weights, onWeightChange, onRemove, onReset, directivesMeta }) {
  const navigate = useNavigate()
  const [saveStatus, setSaveStatus] = useState(null)
  const [strategyName, setStrategyName] = useState('')
  const [dragOver, setDragOver] = useState(false)

  const totalWeight = useMemo(
    () => Object.values(weights).reduce((s, w) => s + w, 0),
    [weights],
  )
  const isValid = totalWeight === 100
  const remaining = 100 - totalWeight

  async function handleSave() {
    if (directives.length === 0 || !strategyName.trim()) return
    setSaveStatus('saving')
    try {
      const res = await fetch('/api/strategies', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: strategyName.trim(),
          directives: directives.map((id) => ({ id, weight: weights[id] || 0 })),
        }),
      })
      const data = await res.json()
      if (data.success) {
        setSaveStatus('saved')
        setTimeout(() => setSaveStatus(null), 3000)
      } else {
        setSaveStatus('error')
      }
    } catch {
      setSaveStatus('error')
    }
  }

  function handleDragOver(e) {
    e.preventDefault()
    setDragOver(true)
  }

  function handleDragLeave() {
    setDragOver(false)
  }

  function handleDrop(e) {
    e.preventDefault()
    setDragOver(false)
    try {
      const data = JSON.parse(e.dataTransfer.getData('application/json'))
      if (data?.id && onWeightChange) {
        onWeightChange(data.id, 10) // default weight on drop
      }
    } catch {
      // Not a valid directive drag
    }
  }

  return (
    <div
      className={`sb-canvas ${dragOver ? 'sb-canvas--drag-over' : ''}`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Strategy metadata */}
      <div className="sb-canvas-header">
        <h3>Your Strategy</h3>
        <div className="sb-weight-summary">
          <span className={isValid ? 'sb-weight-ok' : 'sb-weight-warn'}>
            {totalWeight}/100
          </span>
          {!isValid && <span className="sb-weight-remaining">({remaining > 0 ? `add ${remaining}%` : `reduce ${Math.abs(remaining)}%`})</span>}
        </div>
      </div>

      <input
        type="text"
        className="sb-strategy-name"
        placeholder="Strategy name..."
        value={strategyName}
        onChange={(e) => setStrategyName(e.target.value)}
      />

      {/* Dropped directives */}
      <div className="sb-canvas-directives">
        {directives.length === 0 ? (
          <div className="sb-drop-placeholder">
            <span className="sb-drop-icon">⬇</span>
            <p>Drag directives here to build your strategy</p>
            <p className="sb-hint">Tip: search & filter in the palette, then drag cards across</p>
          </div>
        ) : (
          directives.map((id) => {
            const meta = directivesMeta.find((d) => d.id === id)
            return (
              <DirectiveCard
                key={id}
                directive={meta || { id, name: id, category: 'Other' }}
                weight={weights[id] || 0}
                isInCanvas
                onWeightChange={onWeightChange}
                onRemove={onRemove}
              />
            )
          })
        )}
      </div>

      {/* Save button */}
      {directives.length > 0 && (
        <div className="sb-canvas-actions">
          <button
            type="button"
            className="btn btn-primary"
            onClick={handleSave}
            disabled={!isValid || !strategyName.trim() || saveStatus === 'saving'}
          >
            {saveStatus === 'saving' ? 'Saving...' : saveStatus === 'saved' ? '✓ Saved' : saveStatus === 'error' ? 'Error! Retry' : 'Save Strategy'}
          </button>
          <button type="button" className="btn" onClick={onReset}>
            Reset
          </button>
          {directives.length > 0 && isValid && (
            <button
              type="button"
              className="btn"
              onClick={() => navigate(`/trading/strategy-builder`)}
            >
              View Strategies
            </button>
          )}
        </div>
      )}
    </div>
  )
}
