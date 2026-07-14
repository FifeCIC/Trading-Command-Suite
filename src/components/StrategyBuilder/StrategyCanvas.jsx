/**
 * StrategyCanvas
 * ==============
 * Right panel: drop zone for directives. Shows dropped directives with
 * weight sliders, running total, and save button.
 */

import { useMemo, useState } from 'react'
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
  const [dragOver, setDragOver] = useState(false)

  const totalWeight = useMemo(
    () => Object.values(weights).reduce((s, w) => s + w, 0),
    [weights],
  )
  const isValid = totalWeight === 100
  const remaining = 100 - totalWeight

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
      {/* Protocol canvas header */}
      <div className="sb-canvas-header">
        <h3>Your Protocol</h3>
        <div className="sb-weight-summary">
          <span className={isValid ? 'sb-weight-ok' : 'sb-weight-warn'}>
            {totalWeight}/100
          </span>
          {!isValid && <span className="sb-weight-remaining">({remaining > 0 ? `add ${remaining}%` : `reduce ${Math.abs(remaining)}%`})</span>}
        </div>
      </div>

      {/* Dropped directives */}
      <div className="sb-canvas-directives">
        {directives.length === 0 ? (
          <div className="sb-drop-placeholder">
            <span className="sb-drop-icon">⬇</span>
            <p>Drag directives here to build your protocol</p>
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

      {/* Canvas actions — save is handled by the parent Protocol Details form */}
      {directives.length > 0 && (
        <div className="sb-canvas-actions">
          {!isValid && (
            <span className="sb-weight-hint">Set directive weights to total 100% before saving</span>
          )}
          <button type="button" className="btn" onClick={onReset}>
            Clear Canvas
          </button>
        </div>
      )}
    </div>
  )
}
