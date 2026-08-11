import { Fragment, useMemo, useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiGet } from '../core/api/client'
import LoadingSkeleton from '../components/LoadingSkeleton'
import './directives-manager.css'

const CATEGORY_COLORS = {
  'Technical Analysis':       { color: '#3b82f6', bg: '#3b82f618' },
  'Market Context':           { color: '#8b5cf6', bg: '#8b5cf618' },
  'Sentiment & Fundamentals': { color: '#f59e0b', bg: '#f59e0b18' },
  'Risk & Structural':        { color: '#ef4444', bg: '#ef444418' },
  'Exit Signals':             { color: '#ec4899', bg: '#ec489918' },
  'Strategy Composites':      { color: '#10b981', bg: '#10b98118' },
  'Other':                    { color: '#64748b', bg: '#64748b18' },
};

const COMPLEXITY_COLORS = {
  'Basic':    '#94a3b8',
  'Simple':   '#22c55e',
  'Moderate': '#3b82f6',
  'Complex':  '#f59e0b',
  'Advanced': '#ef4444',
  'Expert':   '#8b5cf6',
};

const READINESS_COLORS = {
  'ready':  { color: '#22c55e', bg: '#22c55e18', label: 'READY' },
  'beta':  { color: '#f59e0b', bg: '#f59e0b18', label: 'BETA' },
  'alpha':  { color: '#ef4444', bg: '#ef444418', label: 'ALPHA' },
};

/** Map API directive shape into the manager's expected fields. */
function hydrateFromApi(raw) {
  return {
    id: raw.id,
    code: raw.id,
    name: raw.name,
    category: raw.category ?? 'Uncategorized',
    active: raw.active !== false,
    status: raw.active !== false ? 'active' : 'inactive',
    complexity: raw.complexity?.label ?? 'Basic',
    protocolCount: raw.protocolCount ?? 0,
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
    // ── Fields from Directives Status that are now merged here ──
    avgScore: raw.avgScore ?? null,
    runs: raw.runs ?? null,
    bias: raw.directionBias ?? null,
    classification: raw.classification ?? 'unknown',
    performance: raw.performance ?? 'unknown',
    readiness: raw.readiness ?? 'alpha',
  }
}

function toneForStatus(status) {
  if (status === 'active') return 'ok'
  if (status === 'review') return 'warn'
  if (status === 'draft') return 'neutral'
  return 'muted'
}

export default function DirectivesManagerPage() {
  const navigate = useNavigate();
  const [query, setQuery] = useState('')
  const [selectedId, setSelectedId] = useState(null)
  const [readinessFilter, setReadinessFilter] = useState('all') // 'all' | 'ready' | 'beta' | 'alpha'
  const [expandedRows, setExpandedRows] = useState(() => new Set())
  const queryClient = useQueryClient()

  const directivesQuery = useQuery({
    queryKey: ['directives'],
    queryFn: () => apiGet('/api/directives'),
    staleTime: 30_000,
  })

  const loaded = directivesQuery.data ?? []
  const allDirectives = useMemo(() => loaded.map(hydrateFromApi), [loaded])
  const seeded = allDirectives.length > 0

  const toggleMutation = useMutation({
    mutationFn: ({ id, active }) =>
      apiGet(`/api/directives/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ active }),
      }),
    onMutate: async ({ id, active }) => {
      await queryClient.cancelQueries({ queryKey: ['directives'] })
      const previous = queryClient.getQueryData(['directives'])
      queryClient.setQueryData(['directives'], (old) =>
        (old || []).map((d) => d.id === id ? { ...d, active } : d)
      )
      return { previous }
    },
    onError: (_err, _vars, context) => {
      queryClient.setQueryData(['directives'], context?.previous)
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['directives'] })
    },
  })

  function handleToggle(e, id, currentActive) {
    e.stopPropagation()
    toggleMutation.mutate({ id, active: !currentActive })
  }

  const filtered = useMemo(() => {
    let result = allDirectives;
    // Text search filter
    const q = query.trim().toLowerCase()
    if (q) {
      result = result.filter((item) => {
        return [item.code, item.name, item.category, item.summary]
          .join(' ')
          .toLowerCase()
          .includes(q)
      })
    }
    // Readiness tier filter
    if (readinessFilter !== 'all') {
      result = result.filter((item) => item.readiness === readinessFilter)
    }
    return result
  }, [allDirectives, query, readinessFilter])

  const selected = useMemo(() => {
    const first = filtered[0] ?? null
    return filtered.find((item) => item.id === selectedId) ?? first
  }, [filtered, selectedId])

  // Set initial selectedId once data loads
  useEffect(() => {
    if (!selectedId && filtered.length > 0) {
      setSelectedId(filtered[0].id)
    }
  }, [filtered, selectedId])

  function selectDirective(id) {
    setSelectedId(id)
  }

  // Loading state
  if (directivesQuery.isLoading) {
    return (
      <main className="directives-page">
        <section className="directives-toolbar">
          <div className="directives-toolbar-row">
            <label htmlFor="directive-search">Search</label>
            <input id="directive-search" type="search" placeholder="Loading directives…" value="" readOnly disabled />
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
            <input id="directive-search" type="search" placeholder="Search directives…" value={query} onChange={(e) => setQuery(e.target.value)} disabled />
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
          <div className="directives-readiness-filters" style={{ display: 'flex', gap: '0.35rem', marginLeft: '0.75rem' }}>
            {['all', 'ready', 'beta', 'alpha'].map((tier) => {
              const rs = tier === 'all' ? { color: '#94a3b8', bg: '#94a3b818', label: 'ALL' } : READINESS_COLORS[tier];
              return (
                <button
                  key={tier}
                  onClick={() => setReadinessFilter(tier)}
                  style={{
                    background: readinessFilter === tier ? rs.bg : 'transparent',
                    color: rs.color,
                    border: `1px solid ${rs.color}40`,
                    padding: '3px 10px',
                    borderRadius: '4px',
                    fontSize: '0.72rem',
                    fontWeight: readinessFilter === tier ? 700 : 500,
                    cursor: 'pointer',
                    opacity: readinessFilter === tier ? 1 : 0.6,
                  }}
                >
                  {rs.label}
                </button>
              );
            })}
          </div>
        </div>
        <div className="directives-toolbar-stats" role="status" aria-live="polite">
          <span><strong>{filtered.length}</strong> shown</span>
          <span className="directives-stat-dot stat-active" />
          <span><strong>{allDirectives.filter((item) => item.active).length}</strong> active</span>
          <span style={{ marginLeft: '0.5rem', color: '#22c55e', fontSize: '0.78rem' }}>
            🟢 {allDirectives.filter((i) => i.readiness === 'ready').length}
          </span>
          <span style={{ color: '#f59e0b', fontSize: '0.78rem' }}>
            🟡 {allDirectives.filter((i) => i.readiness === 'beta').length}
          </span>
          <span style={{ color: '#ef4444', fontSize: '0.78rem' }}>
            🔴 {allDirectives.filter((i) => i.readiness === 'alpha').length}
          </span>
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
                <th>RUNS</th>
                <th>BIAS</th>
                <th>Protocols</th>
                <th>Weighting</th>
                <th>Test</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((item) => {
                const selectedRow = selected?.id === item.id
                const statusTone = toneForStatus(item.status)

                return (
                  <Fragment key={item.id}>
                    <tr
                      className={`directive-row ${selectedRow ? 'is-selected' : ''}`}
                      onClick={() => selectDirective(item.id)}
                      style={{ cursor: 'pointer' }}
                    >
                      <td>
                        <span className="directive-primary">
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.15rem' }}>
                            <span style={{ color: 'var(--ink)', fontSize: '0.9rem', fontWeight: 600 }}>
                              {item.name}
                            </span>
                            <small style={{ color: '#60a5fa', fontFamily: 'monospace', fontSize: '0.72rem' }}>{item.code}</small>
                          </div>
                        </span>
                      </td>
                      <td>
                        {(() => {
                          const cat = CATEGORY_COLORS[item.category] || CATEGORY_COLORS.Other;
                          return <span style={{ color: cat.color, background: cat.bg, padding: '2px 8px', borderRadius: '4px', fontSize: '0.78rem', fontWeight: 600 }}>{item.category}</span>;
                        })()}
                      </td>
                      <td>
                        <span
                          className={`directive-chip tone-${statusTone}`}
                          style={{ cursor: 'pointer', userSelect: 'none' }}
                          onClick={(e) => handleToggle(e, item.id, item.active)}
                          title={`Click to ${item.active ? 'disable' : 'enable'} ${item.name}`}
                        >
                          {item.status}
                        </span>
                      </td>
                      <td>{item.runs ?? '—'}</td>
                      <td style={{ fontWeight: 700, color: item.bias === 'bullish' ? '#22c55e' : item.bias === 'bearish' ? '#ef4444' : 'var(--ink-soft)' }}>{item.bias ?? '—'}</td>
                      <td style={{ color: item.protocolCount > 0 ? 'var(--accent)' : 'var(--ink-soft)' }}>
                        {item.protocolCount || '—'}
                      </td>
                      <td>
                        base {item.baseWeight}
                        <span className="directive-weight-meta">
                          {item.boostEnabled ? ' +boost' : ''}
                          {item.multiplierEnabled ? ' xmult' : ''}
                        </span>
                      </td>
                      <td>
                        <button
                          className="directive-row-test-btn"
                          onClick={(e) => { e.stopPropagation(); navigate(`/scoring/directive-detail?id=${item.code}`); }}
                          title={`Test ${item.name} in isolation`}
                        >
                          Test
                        </button>
                      </td>
                    </tr>
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
                <div className="directive-detail-header-row">
                  <h2 style={{color:'var(--accent)', fontSize:'1.05rem', textShadow: '0 0 12px rgba(59,130,246,0.4)'}}>{selected.name}</h2>
                  <span className={`directive-chip tone-${toneForStatus(selected.status)}`}>{selected.status}</span>
                </div>
                <div className="directive-detail-meta-row">
                  {(() => {
                    const r = READINESS_COLORS[selected.readiness] || READINESS_COLORS.alpha;
                    return (
                      <span
                        className="directive-detail-badge"
                        style={{ color: r.color, background: r.bg, border: `1px solid ${r.color}40` }}
                        title={selected.readiness === 'ready' ? 'Verified against live data' : selected.readiness === 'beta' ? 'Real math, proxy/limited data' : 'Mock, stub, or placeholder'}
                      >
                        {r.label}
                      </span>
                    );
                  })()}
                  <span
                    className="directive-detail-badge"
                    style={{ color: COMPLEXITY_COLORS[selected.complexity] || '#94a3b8', border: `1px solid ${COMPLEXITY_COLORS[selected.complexity] || '#94a3b8'}40`, background: 'transparent' }}
                  >
                    {selected.complexity}
                  </span>
                </div>
              </header>

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
                </div>
              </section>

              <section className="directive-detail-section">
                <h3>Formula</h3>
                <p style={{ fontSize: '0.82rem', color: 'var(--ink-soft)', lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>
                  {selected.description || selected.formula || 'No formula description available.'}
                </p>
              </section>

              <section className="directive-detail-section">
                <h3>Actions</h3>
                <div className="directive-detail-actions">
                  <button type="button" className={`directive-detail-btn ${selected.status === 'active' ? 'directive-btn-disable' : 'directive-btn-enable'}`}>
                    {selected.status === 'active' ? 'Disable' : 'Enable'}
                  </button>
                  <button type="button" className="directive-detail-btn directive-btn-delete">Delete</button>
                  <button
                    type="button"
                    className="directive-detail-btn directive-btn-test"
                    onClick={() => navigate(`/scoring/directive-detail?id=${selected.code}`)}
                  >
                    Test
                  </button>
                </div>
              </section>

              <section className="directive-detail-section directive-detail-advanced-box">
                <h3>Advanced</h3>
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
              </section>
            </>
          )}
        </aside>
      </section>
    </main>
  )
}
