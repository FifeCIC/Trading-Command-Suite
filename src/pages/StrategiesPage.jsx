import { useEffect, useMemo, useState } from 'react'
import LoadingSkeleton from '../components/LoadingSkeleton'
import './strategies-page.css'
import PageInfoPopover from '../components/PageInfoPopover';

/**
 * Seed strategy data matching docs/CANONICAL-DIRECTIVE-REFERENCE.md
 * and docs/STRATEGY-AGGREGATION-CONTRACT.md.
 */
const STRATEGY_SEED = [
  {
    id: 'conviction-dip-accumulation',
    name: 'Conviction Dip Accumulation',
    type: 'Soft long-only, share-buying',
    description:
      'Accumulate on quality dips; hold through normal drawdown; avoid panic exits. Improves buy timing, not turnover.',
    entryThreshold: 60,
    watchThreshold: 40,
    defenseThreshold: 25,
    directiveCount: 5,
    totalWeight: 100,
    directives: [
      { id: 'rsi-oversold', name: 'RSI Oversold Reversion', weight: 24, rule: 'Bullish when RSI(14) < 30 and curling upward' },
      { id: 'macd-crossover', name: 'MACD Bullish Crossover', weight: 22, rule: 'Bullish when MACD line crosses above signal line' },
      { id: 'ema-structure', name: 'Price Above EMA Structure', weight: 20, rule: 'Stronger when price > EMA20 > EMA50' },
      { id: 'atr-dip', name: 'ATR Normalized Dip', weight: 18, rule: 'Favors dips that are significant but not breakdown-level' },
      { id: 'volume-confirmation', name: 'Volume Confirmation', weight: 16, rule: 'Bullish setups score higher with volume support' },
    ],
    maxScore: 100,
    capped: true,
  },
]

const STORAGE_KEY = 'tcs-active-strategy-id'

export default function StrategiesPage() {
  const [strategies, setStrategies] = useState(() => [...STRATEGY_SEED])
  const [activeId, setActiveId] = useState(() =>
    localStorage.getItem(STORAGE_KEY) || STRATEGY_SEED[0].id,
  )
  const [expandedId, setExpandedId] = useState(null)

  const [simulatedLoading, setSimulatedLoading] = useState(true)
  const [duplicateMsg, setDuplicateMsg] = useState('')

  const active = useMemo(
    () => strategies.find((s) => s.id === activeId) ?? strategies[0],
    [activeId, strategies],
  )

  // Simulate brief initial load for skeleton demo
  useEffect(() => {
    const timer = setTimeout(() => setSimulatedLoading(false), 500)
    return () => clearTimeout(timer)
  }, [])

  const selectStrategy = (id) => {
    setActiveId(id)
    localStorage.setItem(STORAGE_KEY, id)
  }

  // ---- Loading state ----
  if (simulatedLoading) {
    return (
      <main className="strategies-page">
        <header className="strategies-header">
          <h2>Strategy Management</h2>
        </header>
        <LoadingSkeleton variant="card" count={1} />
        <LoadingSkeleton variant="card" count={2} className="ls-spacer-top" />
      </main>
    )
  }

  return (
    <main className="strategies-page">
      <header className="strategies-header">
        <h1>Strategy Management
          <PageInfoPopover>
            View available scoring strategies, inspect directive weights and
          thresholds, and select the active strategy. Strategy data is
           static / seed data for MVP.
          </PageInfoPopover>
        </h1>
      </header>

      {/* Active strategy summary card */}
      <section className="strategy-active-card">
        <div className="strategy-active-badge">Active</div>
        <div className="strategy-active-body">
          <h2>{active.name}</h2>
          <p className="strategy-type">{active.type}</p>
          <p className="strategy-desc">{active.description}</p>

          <div className="strategy-thresholds">
            <div className="threshold-item threshold-entry">
              <span className="threshold-label">Entry</span>
              <span className="threshold-value">{active.entryThreshold}</span>
            </div>
            <div className="threshold-item threshold-watch">
              <span className="threshold-label">Watch</span>
              <span className="threshold-value">{active.watchThreshold}</span>
            </div>
            <div className="threshold-item threshold-defense">
              <span className="threshold-label">Defense</span>
              <span className="threshold-value">{active.defenseThreshold}</span>
            </div>
            <div className="threshold-item threshold-max">
              <span className="threshold-label">Max Score</span>
              <span className="threshold-value">{active.maxScore}</span>
            </div>
          </div>

          <p className="strategy-meta">
            {active.directiveCount} directives · {active.totalWeight} total weight
            {active.capped ? ' · Score capped at 100' : ''}
          </p>
          <div className="strategy-actions">
            <button
              type="button"
              className="strategy-duplicate-btn"
              onClick={() => {
                const copy = { ...active, id: `${active.id}-copy-${Date.now()}`, name: `${active.name} (Copy)` }
                setDuplicateMsg(`"${active.name}" duplicated as "${copy.name}". Any strategy can be a template — just duplicate and modify.`)
                setTimeout(() => setDuplicateMsg(''), 5000)
              }}
            >
              📋 Duplicate Strategy
            </button>
            {duplicateMsg && <p className="strategy-duplicate-msg">{duplicateMsg}</p>}
          </div>
        </div>
      </section>

      {/* All strategies list */}
      <section className="strategies-list">
        <h2>Available Strategies</h2>
        {strategies.map((strategy) => {
          const isActive = strategy.id === activeId
          const isExpanded = expandedId === strategy.id

          return (
            <article
              key={strategy.id}
              className={`strategy-card ${isActive ? 'strategy-card--active' : ''} ${isExpanded ? 'strategy-card--expanded' : ''}`}
            >
              <div className="strategy-card-header">
                <div className="strategy-card-info">
                  <h3>{strategy.name}</h3>
                  <p className="strategy-type">{strategy.type}</p>
                  <p className="strategy-desc">{strategy.description}</p>
                </div>
                <div className="strategy-card-actions">
                  {!isActive && (
                    <button
                      type="button"
                      className="strategy-select-btn"
                      onClick={() => selectStrategy(strategy.id)}
                    >
                      Select
                    </button>
                  )}
                  <button
                    type="button"
                    className="strategy-toggle-btn"
                    onClick={() =>
                      setExpandedId(isExpanded ? null : strategy.id)
                    }
                    aria-label={isExpanded ? 'Collapse details' : 'Expand details'}
                  >
                    {isExpanded ? '▲' : '▼'}
                  </button>
                  <button
                    type="button"
                    className="strategy-dup-btn"
                    title="Duplicate this strategy as a starting template"
                    onClick={() => {
                      const dup = JSON.parse(JSON.stringify(strategy))
                      dup.id = `${strategy.id}-copy-${Date.now()}`
                      dup.name = `${strategy.name} (Copy)`
                      setStrategies((prev) => [...prev, dup])
                    }}
                  >
                    Duplicate
                  </button>
                </div>
              </div>

              {/* Threshold bar */}
              <div className="strategy-threshold-bar">
                <div
                  className="threshold-segment segment-entry"
                  style={{ width: `${strategy.entryThreshold}%` }}
                  title={`Entry ≥ ${strategy.entryThreshold}`}
                >
                  E
                </div>
                <div
                  className="threshold-segment segment-watch"
                  style={{ width: `${strategy.watchThreshold - strategy.defenseThreshold}%` }}
                  title={`Watch ≥ ${strategy.watchThreshold}`}
                >
                  W
                </div>
                <div
                  className="threshold-segment segment-defense"
                  style={{ width: `${strategy.defenseThreshold}%` }}
                  title={`Defense ≥ ${strategy.defenseThreshold}`}
                >
                  D
                </div>
              </div>

              {/* Expanded directive breakdown */}
              {isExpanded && (
                <div className="strategy-directives">
                  <h4>Directive Weights</h4>
                  <table className="strategy-directives-table">
                    <thead>
                      <tr>
                        <th>Directive</th>
                        <th>Weight</th>
                        <th>Rule</th>
                      </tr>
                    </thead>
                    <tbody>
                      {strategy.directives.map((d) => (
                        <tr key={d.id}>
                          <td>
                            <code>{d.id}</code>
                            <br />
                            <span className="directive-name">{d.name}</span>
                          </td>
                          <td className="weight-cell">{d.weight}</td>
                          <td className="rule-cell">{d.rule}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr>
                        <td>Total</td>
                        <td className="weight-cell">{strategy.totalWeight}</td>
                        <td />
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}
            </article>
          )
        })}
      </section>

      {/* Empty state for future expansion */}
      {strategies.length === 0 && (
        <div className="strategies-empty">
          <p>No strategies available. Strategies will be seeded from the backend in a future update.</p>
        </div>
      )}
    </main>
  )
}
