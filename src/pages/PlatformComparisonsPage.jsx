import { useEffect, useMemo, useState } from 'react'
import LoadingSkeleton from '../components/LoadingSkeleton'
import './trading-platforms.css'

const STORAGE_KEY = 'tcs:comparisons'

const STRATEGIC_PROVIDER_ORDER = [
  'trading212',
  'interactive_brokers',
  'alpaca',
  'alphavantage',
  'polygon',
  'tradier',
]

const PROVIDER_PRESETS = [
  {
    id: 'sees-core',
    label: 'SEES Core',
    providers: ['trading212', 'interactive_brokers', 'alpaca', 'alphavantage', 'polygon', 'tradier'],
  },
  {
    id: 'execution-focus',
    label: 'Execution Focus',
    providers: ['trading212', 'interactive_brokers', 'alpaca', 'tradier', 'polygon'],
  },
  {
    id: 'research-focus',
    label: 'Research Focus',
    providers: ['alphavantage', 'polygon', 'finnhub', 'twelvedata', 'eodhd', 'iexcloud'],
  },
]

function titleFromProviderId(providerId) {
  return providerId
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase())
}

function toneForValue(value = '') {
  const normalized = String(value).toLowerCase()

  if (normalized.includes('yes') || normalized.includes('full') || normalized === 'available') {
    return 'ok'
  }

  if (normalized.includes('no') || normalized.includes('not available') || normalized.includes('unavailable')) {
    return 'warn'
  }

  if (normalized.includes('limited') || normalized.includes('partial') || normalized.includes('rate')) {
    return 'neutral'
  }

  return 'neutral'
}

function resolveProviderSet(providerIds, preferredIds, fallbackCount = 6) {
  const allowed = new Set(providerIds)
  const preferred = preferredIds.filter((id, index, arr) => allowed.has(id) && arr.indexOf(id) === index)

  if (preferred.length > 0) {
    return preferred
  }

  return providerIds.slice(0, fallbackCount)
}

function buildDefaultProviders(providerIds) {
  const preferred = STRATEGIC_PROVIDER_ORDER.filter((id) => providerIds.includes(id))

  if (preferred.length >= 6) {
    return preferred.slice(0, 6)
  }

  const missing = providerIds.filter((id) => !preferred.includes(id))
  return [...preferred, ...missing].slice(0, 6)
}

export default function PlatformComparisonsPage() {
  const [comparisonSeed, setComparisonSeed] = useState(null)

  useEffect(() => {
    import('../data/provider-comparisons.seed.json').then((m) => setComparisonSeed(m.default))
  }, [])

  if (!comparisonSeed) {
    return (
      <div className="trading-platforms-page">
        <header className="tp-page-header">
          <h1>Platform Comparisons</h1>
        </header>
        <LoadingSkeleton variant="card" count={3} />
        <LoadingSkeleton variant="table" rows={6} cols={5} className="ls-spacer-top" />
      </div>
    )
  }

  return <PlatformComparisonsInner seed={comparisonSeed} />
}

function PlatformComparisonsInner({ seed: comparisonSeed }) {
  const categories = useMemo(() => comparisonSeed.categories || [], [])
  const providers = useMemo(() => comparisonSeed.providerIds || [], [])
  const matrix = comparisonSeed.providers || {}

  const [selectedCategory, setSelectedCategory] = useState(() => {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY))?.category || 'all' } catch { return 'all' }
  })
  const [selectedProviders, setSelectedProviders] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY))?.providers
      if (Array.isArray(saved) && saved.length) return saved.filter((id) => providers.includes(id))
    } catch { /* ignore */ }
    return buildDefaultProviders(providers)
  })

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ category: selectedCategory, providers: selectedProviders }))
  }, [selectedCategory, selectedProviders])

  const activePresetId = useMemo(() => {
    const sorted = [...selectedProviders].sort()
    for (const preset of PROVIDER_PRESETS) {
      const resolved = resolveProviderSet(providers, preset.providers)
      if (resolved.length === sorted.length && [...resolved].sort().every((id, i) => id === sorted[i])) return preset.id
    }
    return null
  }, [selectedProviders, providers])

  const visibleCategories = useMemo(() => {
    if (selectedCategory === 'all') {
      return categories
    }
    return categories.filter((category) => category.id === selectedCategory)
  }, [categories, selectedCategory])

  function toggleProvider(providerId) {
    setSelectedProviders((previous) => {
      if (previous.includes(providerId)) {
        return previous.filter((id) => id !== providerId)
      }
      return [...previous, providerId]
    })
  }

  function applyPreset(presetProviders) {
    setSelectedProviders(resolveProviderSet(providers, presetProviders))
  }

  return (
    <div className="trading-platforms-page">
      <header className="tp-page-header">
        <h1>API Provider Comparisons</h1>
        <p>
          Imported from plugin comparison data and normalized for architecture guidance in this React shell.
        </p>
        <p className="tp-source-meta">
          Source: {comparisonSeed.source?.pluginFile} | Extracted: {new Date(comparisonSeed.source?.extractedAt).toLocaleString()}
        </p>
      </header>

      {categories.length === 0 && (
        <section className="tp-banner tp-banner--info">
          No comparison data loaded. Verify provider-comparisons.seed.json is present and valid.
        </section>
      )}

      <section className="tp-card tp-controls-card">
        <h3>Matrix Controls</h3>

        <div className="tp-controls-grid">
          <label className="tp-control">
            <span>Category</span>
            <select value={selectedCategory} onChange={(event) => setSelectedCategory(event.target.value)}>
              <option value="all">All Categories</option>
              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.title}
                </option>
              ))}
            </select>
          </label>

          <div className="tp-control">
            <span>Providers ({selectedProviders.length} selected)</span>
            <div className="tp-preset-actions">
              {PROVIDER_PRESETS.map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  className={`tp-preset-btn${activePresetId === preset.id ? ' tp-preset-btn--active' : ''}`}
                  onClick={() => applyPreset(preset.providers)}
                  aria-pressed={activePresetId === preset.id}
                >
                  {preset.label}
                </button>
              ))}
              <button
                type="button"
                className="tp-preset-btn"
                onClick={() => setSelectedProviders(providers)}
              >
                Select All
              </button>
              <button
                type="button"
                className="tp-preset-btn"
                onClick={() => setSelectedProviders(buildDefaultProviders(providers))}
              >
                Reset Default
              </button>
            </div>
            <div className="tp-provider-pills">
              {providers.map((providerId) => {
                const selected = selectedProviders.includes(providerId)
                return (
                  <button
                    key={providerId}
                    type="button"
                    className={`tp-provider-pill ${selected ? 'active' : ''}`}
                    onClick={() => toggleProvider(providerId)}
                  >
                    {titleFromProviderId(providerId)}
                  </button>
                )
              })}
            </div>
          </div>
        </div>
      </section>

      {visibleCategories.map((category) => (
        <section key={category.id} className="tp-card tp-comparison-card">
          <h3>{category.title}</h3>
          <div className="tp-comparison-wrap">
            <table className="tp-comparison-table">
              <thead>
                <tr>
                  <th>Capability</th>
                  {selectedProviders.map((providerId) => (
                    <th key={providerId}>{titleFromProviderId(providerId)}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {category.fields.map((field) => (
                  <tr key={field.id}>
                    <td className="tp-field-cell">{field.label}</td>
                    {selectedProviders.map((providerId) => {
                      const entry = matrix[providerId]?.[field.id] || {
                        value: 'Pending',
                        notes: 'Data pending in plugin reference',
                      }

                      const tone = toneForValue(entry.value)

                      return (
                        <td key={`${providerId}-${field.id}`}>
                          <span className={`tp-chip tp-chip--${tone}`}>{entry.value}</span>
                          <p className="tp-cell-note">{entry.notes}</p>
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}

      <section className="tp-card tp-comparison-card">
        <h3>Directive Capability Matrix (Alpha)</h3>
        <p className="tp-hint">
          Mirrors plugin alpha directives so SEES and scoring architecture can validate provider-readiness against required data types.
        </p>
        <table className="tp-config-table">
          <thead>
            <tr>
              <th>Directive</th>
              <th>Status</th>
              <th>Required Data</th>
            </tr>
          </thead>
          <tbody>
            {(comparisonSeed.directiveCapabilityAlpha || []).map((directive) => (
              <tr key={directive.id}>
                <td>{directive.label}</td>
                <td><span className="tp-chip tp-chip--warn">{directive.status}</span></td>
                <td>{Array.isArray(directive.requiredData) ? directive.requiredData.join(', ') : 'N/A'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  )
}
