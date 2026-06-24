import { Fragment, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { apiGet } from '../core/api/client'
import LoadingSkeleton from '../components/LoadingSkeleton'
import './directives-manager.css'

/** Map API directive shape into the manager's expected fields. */
function hydrateFromApi(raw) {
  return {
    id: raw.id,
    code: raw.id,
    name: raw.name,
    category: raw.category ?? 'Uncategorized',
    status: 'active',
    complexity: 'Medium',
    baseWeight: raw.priority ?? 50,
    boostEnabled: false,
    multiplierEnabled: false,
    testCoverage: 0,
    formula: raw.description ?? '',
    inputs: [],
    tests: [],
    owner: 'System',
    summary: raw.description ?? '',
    description: raw.description ?? '',
    lastReview: '—',
    outputs: [],
    riskNotes: '',
  }
}

function toneForStatus(status) {
  if (status === 'active') return 'ok'
  if (status === 'review') return 'warn'
  if (status === 'draft') return 'neutral'
  return 'muted'
}

export default function DirectivesManagerPage() {
  const [query, setQuery] = useState('')
  const [selectedId, setSelectedId] = useState(null)
  const [expandedRows, setExpandedRows] = useState(() => new Set())

  const directivesQuery = useQuery({
    queryKey: ['directives'],
    queryFn: () => apiGet('/api/directives'),
    staleTime: 30_000,
  })

  const loaded = directivesQuery.data ?? []
  const allDirectives = useMemo(() => loaded.map(hydrateFromApi), [loaded])
  const seeded = allDirectives.length > 0

  const filterable = useMemo(() => {
    if (allDirectives.length === 0) return []
    return allDirectives
  }, [allDirectives])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return filterable

    return filterable.filter((item) => {
      return [item.code, item.name, item.category, item.summary]
        .join(' ')
        .toLowerCase()
        .includes(q)
    })
  }, [filterable, query])

  const selected = useMemo(() => {
    const first = filtered[0] ?? null
    return filtered.find((item) => item.id === selectedId) ?? first
  }, [filtered, selectedId])

  // Set initial selectedId once data loads
  useMemo(() => {
    if (!selectedId && filtered.length > 0) {
      setSelectedId(filtered[0].id)
    }
  }, [filtered, selectedId])

  function toggleRow(id) {
    setExpandedRows((previous) => {
      const next = new Set(previous)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
    selectDirective(id)
  }

  function selectDirective(id) {
    setSelectedId(id)
    setExpandedRows((previous) => {
      const next = new Set(previous)
      next.add(id)
      return next
    })
  }

  // Loading state
  if (directivesQuery.isLoading) {
    return (
      <main className="directives-page">
        <section className="directives-toolbar">
          <div className="directives-toolbar-row">
            <label htmlFor="directive-search">Search</label>
            <input id="directive-search" type="search" placeholder="Loading directives…" disabled />
          </div>
          <div className="directives-toolbar-stats" role="status">
            <span>Loading…</span>
          </div>
        </section>
        <LoadingSkeleton variant="table" rows={12} cols={6} />
      </main>
    )
  }

  // Error state
  if (directivesQuery.isError) {
    return (
      <main className="directives-page">
        <section className="directives-toolbar">
          <div className="directives-toolbar-row">
            <label htmlFor="directive-search">Search</label>
            <input id="directive-search" type="search" placeholder="Search directives…" disabled />
          </div>
          <div className="directives-toolbar-stats" role="status">
            <span>Failed to load directives. Is the API running?</span>
          </div>
        </section>
      </main>
    )
  }

  if (!seeded) {
    return (
      <main className="directives-page">
        <p>No directives registered.</p>
      </main>
    )
  }

  return (
    <main className="directives-page">
      <section className="directives-toolbar">
        <div className="directives-toolbar-row">
          <label htmlFor="directive-search">Search</label>
          <input
            id="directive-search"
            type="search"
            placeholder="Search by code, name, category"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        <div className="directives-toolbar-stats" role="status" aria-live="polite">
          <span><strong>{allDirectives.length}</strong> total</span>
          <span className="directives-stat-dot stat-active" />
          <span><strong>{allDirectives.filter((item) => item.status === 'active').length}</strong> active</span>
        </div>
      </section>

      <section className="directives-layout">
        <div className="directives-table-wrap" aria-label="Directives table with accordion rows">
          <table className="directives-table">
            <thead>
              <tr>
                <th>Directive</th>
                <th>Category</th>
                <th>Status</th>
                <th>Complexity</th>
                <th>Weighting</th>
                <th>Tests</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((item) => {
                const expanded = expandedRows.has(item.id)
                const selectedRow = selected?.id === item.id
                const statusTone = toneForStatus(item.status)

                return (
                  <Fragment key={item.id}>
                    <tr
                      className={`directive-row ${selectedRow ? 'is-selected' : ''}`}
                      onClick={() => {
                        if (selected?.id === item.id) {
                          toggleRow(item.id);
                        } else {
                          selectDirective(item.id);
                        }
                      }}
                      style={{ cursor: 'pointer' }}
                    >
                      <td>
                        <span className="directive-primary">
                          <span className="directive-chevron" aria-hidden="true">{expanded ? '▾' : '▸'}</span>
                          <span>
                            <strong>{item.name}</strong>
                            <small>{item.code}</small>
                          </span>
                        </span>
                      </td>
                      <td>{item.category}</td>
                      <td><span className={`directive-chip tone-${statusTone}`}>{item.status}</span></td>
                      <td>{item.complexity}</td>
                      <td>
                        base {item.baseWeight}
                        <span className="directive-weight-meta">
                          {item.boostEnabled ? ' +boost' : ''}
                          {item.multiplierEnabled ? ' xmult' : ''}
                        </span>
                      </td>
                      <td>{item.testCoverage}%</td>
                    </tr>
                    {expanded && (
                      <tr className="directive-expand">
                        <td colSpan={6}>
                          <div className="directive-expand-grid">
                            <div>
                              <h3>Formula</h3>
                              <p>{item.formula}</p>
                            </div>
                            <div>
                              <h3>Inputs</h3>
                              <ul>
                                {item.inputs.map((entry) => (
                                  <li key={entry}>{entry}</li>
                                ))}
                              </ul>
                            </div>
                            <div>
                              <h3>Tests</h3>
                              <ul>
                                {item.tests.map((entry) => (
                                  <li key={entry}>{entry}</li>
                                ))}
                              </ul>
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                )
              })}
            </tbody>
          </table>
        </div>

        <aside className="directive-detail-rail" aria-label="Selected directive details">
          {!selected && <p>No directive matches the current search.</p>}

          {selected && (
            <>
              <header className="directive-detail-header">
                <h2>{selected.name}</h2>
                <span className={`directive-chip tone-${toneForStatus(selected.status)}`}>{selected.status}</span>
                <p className="directive-code">{selected.code}</p>
              </header>

              <section className="directive-detail-section">
                <h3>Introduction</h3>
                <p>{selected.summary}</p>
              </section>

              <section className="directive-detail-section">
                <h3>Defaults</h3>
                <div className="directive-detail-defaults">
                  <div>
                    <span className="directive-detail-label">Priority</span>
                    <div className="directive-slider-row">
                      <input type="range" min="1" max="10" defaultValue="5" className="directive-slider" />
                      <span>5</span>
                    </div>
                  </div>
                  <div>
                    <span className="directive-detail-label">Weight</span>
                    <div className="directive-slider-row">
                      <input type="range" min="1" max="100" defaultValue={selected.baseWeight} className="directive-slider" />
                      <span>{selected.baseWeight}</span>
                    </div>
                  </div>
                  <div>
                    <span className="directive-detail-label">Category</span>
                    <span>{selected.category}</span>
                  </div>
                  <div>
                    <span className="directive-detail-label">Complexity</span>
                    <span>{selected.complexity}</span>
                  </div>
                </div>
              </section>

              <section className="directive-detail-section">
                <h3>Test Results</h3>
                <div className="directive-detail-test-results">
                  <span>Last run: {selected.lastReview}</span>
                  <span>Coverage: {selected.testCoverage}%</span>
                  <button type="button" className="directive-detail-btn directive-btn-test">Run Test</button>
                </div>
              </section>

              <section className="directive-detail-section">
                <h3>Actions</h3>
                <div className="directive-detail-actions">
                  <button type="button" className={`directive-detail-btn ${selected.status === 'active' ? 'directive-btn-disable' : 'directive-btn-enable'}`}>
                    {selected.status === 'active' ? 'Disable' : 'Enable'}
                  </button>
                  <button type="button" className="directive-detail-btn directive-btn-delete">Delete</button>
                </div>
              </section>

              <details className="directive-detail-advanced">
                <summary>Advanced</summary>
                <div className="directive-detail-advanced-content">
                  <h4>Ownership</h4>
                  <ul>
                    <li><strong>Owner:</strong> {selected.owner}</li>
                    <li><strong>Last review:</strong> {selected.lastReview}</li>
                    <li><strong>Outputs:</strong> {selected.outputs.join(', ')}</li>
                  </ul>
                  <h4>Risk Notes</h4>
                  <p>{selected.riskNotes}</p>
                  <h4>Raw API Data</h4>
                  <pre className="directive-json-pre">{JSON.stringify(selected, null, 2)}</pre>
                </div>
              </details>
            </>
          )}
        </aside>
      </section>
    </main>
  )
}
