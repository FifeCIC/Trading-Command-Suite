/**
 * DirectiveCard
 * =============
 * Draggable card showing directive info. Used in both palette and canvas.
 * When in palette: draggable. When in canvas: has remove button + weight slider.
 *
 * Q301b: Supports forkStatus for default vs customised badge display.
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
  forkStatus, // { isFork: boolean, forkId?: string, onRevert?: () => void }
  isBottomed = false,
  onSendToBottom,
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
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span className="sb-card-name">{directive.name}</span>
            {forkStatus && (
              <span className={`sb-fork-badge sb-fork-badge--${forkStatus.isFork ? 'fork' : 'default'}`}>
                {forkStatus.isFork ? '⚙ Customised' : '🟢 Default'}
              </span>
            )}
          </div>
          <code className="sb-card-id">{directive.id}</code>
        </div>
        <span className="sb-card-category" style={{ backgroundColor: catColor + '20', color: catColor }}>
          {directive.category}
        </span>
        {!isInCanvas && (
          <button
            type="button"
            className={`sb-send-bottom ${isBottomed ? 'sb-send-bottom--done' : ''}`}
            onClick={(e) => { e.stopPropagation(); onSendToBottom?.(); }}
            title={isBottomed ? 'Sent to bottom' : 'Send to bottom'}
            disabled={isBottomed}
          >
            {isBottomed ? '⏬' : '⬇'}
          </button>
        )}
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
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            {forkStatus?.isFork && forkStatus.onRevert && (
              <button
                type="button"
                className="sb-revert-btn"
                onClick={() => forkStatus.onRevert(directive.id)}
                title="Revert to default — removes this fork"
              >
                ↺ Reset
              </button>
            )}
            <button
              type="button"
              className="sb-remove-btn"
              onClick={() => onRemove?.(directive.id)}
              title="Remove from strategy"
            >
              ✕
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
