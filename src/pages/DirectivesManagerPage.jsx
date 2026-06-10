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
      <section className="directives-header">
        <div>
          <p className="directives-eyebrow">Scoring governance</p>
        </div>
        <aside className="directives-header-stats" role="status" aria-live="polite">
          <p><strong>Total directives:</strong> {DIRECTIVE_SEED.length}</p>
          <p><strong>Visible:</strong> {filtered.length}</p>
          <p><strong>Active:</strong> {DIRECTIVE_SEED.filter((item) => item.status === 'active').length}</p>
        </aside>
      </section>

      <section className="directives-toolbar">
        <label htmlFor="directive-search">Search directives</label>
        <input
          id="directive-search"
          type="search"
          placeholder="Search by code, name, category, owner"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
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
              <header>
                <p className="directives-eyebrow">Selected directive</p>
                <h2>{selected.name}</h2>
                <p>{selected.code}</p>
              </header>

              <section>
                <h3>Summary</h3>
                <p>{selected.summary}</p>
              </section>

              <section>
                <h3>Ownership</h3>
                <ul>
                  <li><strong>Owner:</strong> {selected.owner}</li>
                  <li><strong>Last review:</strong> {selected.lastReview}</li>
                  <li><strong>Outputs:</strong> {selected.outputs.join(', ')}</li>
                </ul>
              </section>

              <section>
                <h3>Maintenance Notes</h3>
                <p>{selected.riskNotes}</p>
              </section>

              <section>
                <h3>Import Shape</h3>
                <pre>{JSON.stringify(DIRECTIVE_IMPORT_SCHEMA, null, 2)}</pre>
              </section>
            </>
          )}
        </aside>
      </section>
    </main>
  )
}
