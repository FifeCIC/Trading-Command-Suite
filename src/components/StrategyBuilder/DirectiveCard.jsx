/**
 * DirectiveCard
 * =============
 * Draggable card showing directive info. Used in both palette and canvas.
 * When in palette: draggable. When in canvas: has remove button + weight slider.
 */

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

function getCategoryColor(category) {
  return CATEGORY_COLORS[category] || '#6b7280'
}

export default function DirectiveCard({
  directive,
  weight,
  onWeightChange,
  onRemove,
  isInCanvas = false,
  onDragStart,
}) {
  const catColor = getCategoryColor(directive.category)

  return (
    <div
      className={`sb-card ${isInCanvas ? 'sb-card--canvas' : 'sb-card--palette'}`}
      draggable={!isInCanvas}
      onDragStart={(e) => {
        if (onDragStart) onDragStart(e, directive)
      }}
    >
      <div className="sb-card-header" style={{ borderLeftColor: catColor }}>
        <div className="sb-card-info">
          <span className="sb-card-name">{directive.name}</span>
          <code className="sb-card-id">{directive.id}</code>
        </div>
        <span className="sb-card-category" style={{ backgroundColor: catColor + '20', color: catColor }}>
          {directive.category}
        </span>
      </div>

      {directive.description && (
        <p className="sb-card-desc">{directive.description}</p>
      )}

      {isInCanvas && (
        <div className="sb-card-controls">
          <div className="sb-weight-row">
            <label className="sb-weight-label">
              Weight: <strong>{weight}%</strong>
            </label>
            <input
              type="range"
              min="0"
              max="50"
              value={weight}
              onChange={(e) => onWeightChange?.(directive.id, Number(e.target.value))}
              className="sb-slider"
            />
          </div>
          <button
            type="button"
            className="sb-remove-btn"
            onClick={() => onRemove?.(directive.id)}
            title="Remove from strategy"
          >
            ✕
          </button>
        </div>
      )}
    </div>
  )
}
