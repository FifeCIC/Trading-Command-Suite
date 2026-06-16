/**
 * DirectivesConfigPage
 * ====================
 * Directives configuration page with weight sliders, enable/disable toggles,
 * and localStorage persistence. Canonical weights match CANONICAL-DIRECTIVE-REFERENCE.md.
 *
 * Route: /scoring/configure-directives
 */

import { useState, useEffect, useMemo } from 'react'
import LoadingSkeleton from '../components/LoadingSkeleton'
import { DIRECTIVE_SEED } from './directives-manager.seed'
import './directives-config.css'

const STORAGE_KEY = 'tcs:directive-config'

function loadConfig() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) return JSON.parse(raw)
  } catch { /* ignore */ }
  return null
}

function saveConfig(config) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(config))
}

const CANONICAL_WEIGHTS = Object.fromEntries(
  DIRECTIVE_SEED.map((d) => [d.id, d.baseWeight]),
)

export default function DirectivesConfigPage() {
  const [simulatedLoading, setSimulatedLoading] = useState(true)
  const [config, setConfig] = useState(() => {
    const saved = loadConfig()
    if (saved) return saved
    // Initialize with canonical values
    return Object.fromEntries(
      DIRECTIVE_SEED.map((d) => [d.id, { enabled: true, weight: d.baseWeight }]),
    )
  })

  useEffect(() => {
    const timer = setTimeout(() => setSimulatedLoading(false), 400)
    return () => clearTimeout(timer)
  }, [])

  // Persist to localStorage on every change
  useEffect(() => {
    saveConfig(config)
  }, [config])

  const totalWeight = useMemo(
    () => Object.values(config).reduce((sum, d) => sum + (d.enabled ? d.weight : 0), 0),
    [config],
  )

  const isValid = totalWeight === 100
  const isCanonical = DIRECTIVE_SEED.every(
    (d) => config[d.id]?.enabled !== false && config[d.id]?.weight === d.baseWeight,
  )

  function setDirective(id, patch) {
    setConfig((prev) => ({
      ...prev,
      [id]: { ...prev[id], ...patch },
    }))
  }

  function resetToCanonical() {
    setConfig(
      Object.fromEntries(
        DIRECTIVE_SEED.map((d) => [d.id, { enabled: true, weight: d.baseWeight }]),
      ),
    )
  }

  // ---- Loading state ----
  if (simulatedLoading) {
    return (
      <div className="dc-page">
        <header className="dc-header">
          <h2>Configure Directives</h2>
        </header>
        <LoadingSkeleton variant="card" count={5} />
      </div>
    )
  }

  return (
    <div className="dc-page">
      <header className="dc-header">
        <div>
          <h1>Configure Directives</h1>
          <p>
            Enable, disable, and adjust directive weights. Enabled weights must
            sum to <strong>100</strong> for a valid configuration.
          </p>
        </div>
        <div className="dc-header-actions">
          {isCanonical ? (
            <span className="dc-chip dc-chip--ok">Canonical</span>
          ) : (
            <button type="button" className="btn" onClick={resetToCanonical}>
              Reset to Canonical
            </button>
          )}
        </div>
      </header>

      {/* Weight validation banner */}
      <div className={`dc-validation-banner ${isValid ? 'dc-valid' : 'dc-invalid'}`}>
        {isValid
          ? `✅ Total weight: ${totalWeight}% — Valid configuration`
          : `⚠️ Total weight: ${totalWeight}% — Must equal 100% (${100 - totalWeight > 0 ? `add ${100 - totalWeight}%` : `reduce ${totalWeight - 100}%`})`}
      </div>

      {/* Directive cards */}
      <div className="dc-cards">
        {DIRECTIVE_SEED.map((d) => {
          const state = config[d.id] || { enabled: true, weight: d.baseWeight }
          const canonicalWeight = CANONICAL_WEIGHTS[d.id]

          return (
            <article key={d.id} className={`dc-card ${!state.enabled ? 'dc-card--disabled' : ''}`}>
              <div className="dc-card-header">
                <div className="dc-card-title">
                  <h3>{d.name}</h3>
                  <code className="dc-id">{d.id}</code>
                  <span className="dc-category-chip">{d.category}</span>
                  <span className={`dc-badge dc-badge--${d.complexity}`}>{d.complexity}</span>
                  <span className="dc-badge dc-badge--coverage">{d.testCoverage}% tests</span>
                </div>
                <label className="dc-toggle">
                  <input
                    type="checkbox"
                    checked={state.enabled}
                    onChange={(e) => setDirective(d.id, { enabled: e.target.checked })}
                  />
                  <span className="dc-toggle-track">
                    <span className="dc-toggle-thumb" />
                  </span>
                  <span className="dc-toggle-label">{state.enabled ? 'Enabled' : 'Disabled'}</span>
                </label>
              </div>

              <p className="dc-summary">{d.summary}</p>

              <div className="dc-weight-row">
                <label className="dc-weight-label">
                  Weight: <strong>{state.enabled ? state.weight : 0}%</strong>
                  {state.weight !== canonicalWeight && (
                    <span className="dc-canonical-hint"> (canonical: {canonicalWeight})</span>
                  )}
                </label>
                <input
                  type="range"
                  min="0"
                  max="50"
                  value={state.weight}
                  disabled={!state.enabled}
                  onChange={(e) => setDirective(d.id, { weight: Number(e.target.value) })}
                  className="dc-slider"
                />
                <div className="dc-slider-marks">
                  <span>0</span>
                  <span>10</span>
                  <span>20</span>
                  <span>30</span>
                  <span>40</span>
                  <span>50</span>
                </div>
              </div>
            </article>
          )
        })}
      </div>

      <p className="dc-hint">
        Configuration saved to localStorage. Backend integration (POST /api/directives/config) is a future enhancement.
      </p>
    </div>
  )
}
