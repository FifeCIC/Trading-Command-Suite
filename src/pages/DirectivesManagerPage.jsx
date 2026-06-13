import { Fragment, useMemo, useState } from 'react'
import { DIRECTIVE_IMPORT_SCHEMA, DIRECTIVE_SEED } from './directives-manager.seed'
import './directives-manager.css'

function toneForStatus(status) {
  if (status === 'active') return 'ok'
  if (status === 'review') return 'warn'
  if (status === 'draft') return 'neutral'
  return 'muted'
}

export default function DirectivesManagerPage() {
  const [query, setQuery] = useState('')
  const [selectedId, setSelectedId] = useState(DIRECTIVE_SEED[0]?.id ?? null)
  const [expandedRows, setExpandedRows] = useState(() => new Set([DIRECTIVE_SEED[0]?.id]))

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return DIRECTIVE_SEED

    return DIRECTIVE_SEED.filter((item) => {
      return [item.code, item.name, item.category, item.owner, item.summary]
        .join(' ')
        .toLowerCase()
        .includes(q)
    })
  }, [query])

  const selected = useMemo(() => {
    const first = filtered[0] ?? null
    return filtered.find((item) => item.id === selectedId) ?? first
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
  }

  function selectDirective(id) {
    setSelectedId(id)
    setExpandedRows((previous) => {
      const next = new Set(previous)
      next.add(id)
      return next
    })
  }

  return (
    <main className="directives-page">
      <section className="directives-toolbar">
        <div className="directives-toolbar-row">
          <label htmlFor="directive-search">Search</label>
          <input
            id="directive-search"
            type="search"
            placeholder="Search by code, name, category, owner"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        <div className="directives-toolbar-stats" role="status" aria-live="polite">
          <span><strong>{DIRECTIVE_SEED.length}</strong> total</span>
          <span className="directives-stat-dot stat-active" />
          <span><strong>{DIRECTIVE_SEED.filter((item) => item.status === 'active').length}</strong> active</span>
          <span className="directives-stat-dot stat-draft" />
          <span><strong>{DIRECTIVE_SEED.filter((item) => item.status === 'draft').length}</strong> draft</span>
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
                    <tr className={`directive-row ${selectedRow ? 'is-selected' : ''}`}>
                      <td>
                        <button
                          type="button"
                          className="directive-primary"
                          onClick={() => {
                            selectDirective(item.id)
                            toggleRow(item.id)
                          }}
                          aria-expanded={expanded}
                        >
                          <span className="directive-chevron" aria-hidden="true">{expanded ? '▾' : '▸'}</span>
                          <span>
                            <strong>{item.name}</strong>
                            <small>{item.code}</small>
                          </span>
                        </button>
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
                  <h4>Import / Config</h4>
                  <pre className="directive-json-pre">{JSON.stringify(DIRECTIVE_IMPORT_SCHEMA, null, 2)}</pre>
                </div>
              </details>
            </>
          )}
        </aside>
      </section>
    </main>
  )
}
