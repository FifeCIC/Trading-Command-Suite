/**
 * DirectivePalette
 * ================
 * Left panel showing all available directives grouped by category.
 * Directives are draggable onto the StrategyCanvas.
 */

import { useState } from 'react'
import DirectiveCard from './DirectiveCard'
import './strategy-builder.css'

const CATEGORY_ORDER = ['Momentum', 'Trend', 'Volatility', 'Participation', 'Pattern', 'Volume', 'Macro']

export default function DirectivePalette({ directives, onDragStart }) {
  const [search, setSearch] = useState('')
  const [bottomIds, setBottomIds] = useState(new Set())

  const filtered = directives.filter((d) => {
    if (!search.trim()) return true
    const q = search.toLowerCase()
    return (
      d.name.toLowerCase().includes(q) ||
      d.id.toLowerCase().includes(q) ||
      (d.category || '').toLowerCase().includes(q)
    )
  })

  // Group by category
  const grouped = {}
  for (const d of filtered) {
    const cat = d.category || 'Uncategorized'
    if (!grouped[cat]) grouped[cat] = []
    grouped[cat].push(d)
  }

  // Sort each category: bottom-pinned items last
  for (const cat of Object.keys(grouped)) {
    grouped[cat].sort((a, b) => {
      const aBot = bottomIds.has(a.id) ? 1 : 0
      const bBot = bottomIds.has(b.id) ? 1 : 0
      return aBot - bBot
    })
  }

  function sendToBottom(id) {
    setBottomIds((prev) => new Set([...prev, id]))
  }

  return (
    <div className="sb-palette">
      <div className="sb-palette-header">
        <h3>Available Directives</h3>
        <span className="sb-count">{filtered.length}</span>
      </div>

      <input
        type="text"
        className="sb-search"
        placeholder="Search directives..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />

      <div className="sb-palette-scroll">
        {CATEGORY_ORDER.filter((c) => grouped[c]?.length).map((cat) => (
          <div key={cat} className="sb-category-group">
            <h4 className="sb-category-title">{cat}</h4>
            <div className="sb-category-cards">
              {grouped[cat].map((d) => (
                <DirectiveCard
                  key={d.id}
                  directive={d}
                  onDragStart={onDragStart}
                  isBottomed={bottomIds.has(d.id)}
                  onSendToBottom={() => sendToBottom(d.id)}
                />
              ))}
            </div>
          </div>
        ))}

        {/* Remaining uncategorized */}
        {grouped['Uncategorized']?.length > 0 && (
          <div className="sb-category-group">
            <h4 className="sb-category-title">Other</h4>
            <div className="sb-category-cards">
              {grouped['Uncategorized'].map((d) => (
                <DirectiveCard
                  key={d.id}
                  directive={d}
                  onDragStart={onDragStart}
                  isBottomed={bottomIds.has(d.id)}
                  onSendToBottom={() => sendToBottom(d.id)}
                />
              ))}
            </div>
          </div>
        )}

        {filtered.length === 0 && (
          <p className="sb-empty">No directives match your search.</p>
        )}
      </div>
    </div>
  )
}
