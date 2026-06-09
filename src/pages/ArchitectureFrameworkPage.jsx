import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { apiGet } from '../core/api/client'
import {
  AI_GUARDRAILS,
  CONTRACTS,
  CONTRACT_CARDS,
  CURRENT_FLOW_CONTRACTS,
  CURRENT_ROUTE_CONTRACTS,
  CURRENT_SLICE,
  DATA_STATES,
  DECISION_WORKFLOW,
  DEFINITION_OF_DONE,
  DISCOVERY_COMMANDS,
  DOMAINS,
  FEATURE_MATRIX,
  HANDOFF_CHECKLIST,
  INTAKE_TEMPLATE,
  INFORMATION_SOURCES,
  KNOWN_GAPS,
  MAINTENANCE_WORKFLOW,
  OWNER_DIRECTORY,
  QUEUE_PROVIDER_CARDS,
  REVISION_LOG,
  SCORING_STRATEGY_CARDS,
  SECTION_META,
  STATUS_SNAPSHOT,
  SYSTEM_CONTEXTS,
  SYSTEM_SPINE,
  VERIFICATION_GOVERNANCE,
} from './architecture-framework.data'
import './architecture-framework.css'

const LIVE_REFRESH_INTERVAL_MS = 30_000
function normalize(value) {
  return String(value).toLowerCase()
}

function matchesQuery(query, terms) {
  if (!query) {
    return true
  }

  const lower = normalize(query)
  return terms.some((term) => normalize(term).includes(lower))
}

function SectionBlock({ id, title, summary, collapsed, onToggle, children }) {
  return (
    <section id={id} className="architecture-section">
      <div className="architecture-section-header">
        <div>
          <h2>{title}</h2>
          {summary && <p>{summary}</p>}
        </div>
        <button type="button" className="architecture-toggle" onClick={() => onToggle(id)}>
          {collapsed ? 'Expand' : 'Collapse'}
        </button>
      </div>
      {!collapsed && children}
    </section>
  )
}

function CardGrid({ cards }) {
  return (
    <div className="architecture-grid architecture-grid-wide">
      {cards.map((card) => (
        <article className="architecture-card" key={card.title}>
          <h3>{card.title}</h3>
          <p>{card.summary}</p>
          <ul>
            {card.items.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </article>
      ))}
    </div>
  )
}

function scrollToSection(sectionId) {
  const element = document.getElementById(sectionId)
  if (element) {
    element.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }
}

function toTimestamp(value) {
  const ts = Date.parse(value || '')
  return Number.isNaN(ts) ? 0 : ts
}

function formatDateTime(value) {
  if (!value) {
    return 'n/a'
  }

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return String(value)
  }

  return date.toLocaleString()
}

function countBy(items, keySelector) {
  return items.reduce((output, item) => {
    const key = keySelector(item)
    output[key] = (output[key] || 0) + 1
    return output
  }, {})
}

function normalizeStatus(value) {
  return String(value || '').toLowerCase()
}

function providerStatusTone(status) {
  const value = normalizeStatus(status)
  if (value === 'healthy') {
    return 'ok'
  }

  if (value === 'missing-credentials' || value === 'degraded') {
    return 'warn'
  }

  if (value === 'failed' || value === 'error' || value === 'offline' || value === 'unhealthy') {
    return 'error'
  }

  return 'neutral'
}

function importStatusTone(status) {
  const value = normalizeStatus(status)
  if (value === 'completed' || value === 'success') {
    return 'ok'
  }

  if (value === 'queued' || value === 'running' || value === 'processing' || value === 'pending') {
    return 'info'
  }

  if (value === 'failed' || value === 'error') {
    return 'error'
  }

  return 'neutral'
}

function queryConnectivityTone(queryState) {
  if (queryState.isError) {
    return 'error'
  }

  if (queryState.isLoading || queryState.isRefetching) {
    return 'info'
  }

  return 'ok'
}

function StatusChip({ label, tone = 'neutral' }) {
  return <span className={`architecture-chip architecture-chip-${tone}`}>{label}</span>
}

export default function ArchitectureFrameworkPage() {
  const [query, setQuery] = useState('')
  const [collapsedSections, setCollapsedSections] = useState([])
  const [autoRefreshEnabled, setAutoRefreshEnabled] = useState(true)

  const providerHealthQuery = useQuery({
    queryKey: ['architecture', 'provider-health'],
    queryFn: () => apiGet('/api/providers/health'),
    refetchInterval: autoRefreshEnabled ? LIVE_REFRESH_INTERVAL_MS : false,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
  })

  const importRunsQuery = useQuery({
    queryKey: ['architecture', 'import-runs'],
    queryFn: () => apiGet('/api/imports/runs?limit=5'),
    refetchInterval: autoRefreshEnabled ? LIVE_REFRESH_INTERVAL_MS : false,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
  })

  const providerHealthData = providerHealthQuery.data || {}
  const importRunsData = importRunsQuery.data || {}
  
  const systemMode = providerHealthData.mode || importRunsData.mode || null
  const systemServices = providerHealthData.services || importRunsData.services || {}
  
  const providerHealth = Array.isArray(providerHealthData.providers) ? providerHealthData.providers : Array.isArray(providerHealthData) ? providerHealthData : []
  const recentImportRuns = Array.isArray(importRunsData.runs) ? importRunsData.runs : Array.isArray(importRunsData) ? importRunsData : []

  const providerStatusCounts = useMemo(
    () => countBy(providerHealth, (item) => item.status || 'unknown'),
    [providerHealth],
  )

  const importRunStatusCounts = useMemo(
    () => countBy(recentImportRuns, (item) => item.status || 'unknown'),
    [recentImportRuns],
  )

  const latestProviderCheck = useMemo(() => {
    return providerHealth.reduce((latest, item) => {
      const candidate = item.checkedAt
      return toTimestamp(candidate) > toTimestamp(latest) ? candidate : latest
    }, null)
  }, [providerHealth])

  const latestImportRequest = useMemo(() => {
    return recentImportRuns.reduce((latest, item) => {
      const candidate = item.requestedAt
      return toTimestamp(candidate) > toTimestamp(latest) ? candidate : latest
    }, null)
  }, [recentImportRuns])

  const visibleSections = useMemo(() => {
    return SECTION_META.filter((section) => matchesQuery(query, section.terms))
  }, [query])

  const visibleIds = useMemo(() => new Set(visibleSections.map((section) => section.id)), [visibleSections])

  function toggleSection(sectionId) {
    setCollapsedSections((current) =>
      current.includes(sectionId)
        ? current.filter((item) => item !== sectionId)
        : [...current, sectionId],
    )
  }

  function collapseAll() {
    setCollapsedSections(SECTION_META.map((section) => section.id))
  }

  function expandAll() {
    setCollapsedSections([])
  }

  function refreshLiveStatus() {
    void Promise.all([providerHealthQuery.refetch(), importRunsQuery.refetch()])
  }

  return (
    <main className="architecture-page">
      <section className="architecture-hero">
        <div>
          <p className="eyebrow">Trading Command Suite</p>
          <h1>Architecture Framework</h1>
          <p className="architecture-subcopy">
            This page is the in-app mirror of the project north star. It exists early so design,
            implementation, and AI-assisted work all reference the same model while the system is still small.
          </p>
        </div>
        <div className="architecture-status-card">
          <p><strong>Priority:</strong> P0 foundation</p>
          <p><strong>Role:</strong> active decision reference</p>
          <p><strong>Mode:</strong> interactive shell now, live contract surface next</p>
        </div>
      </section>

      <section className="architecture-controls-bar">
        <div className="architecture-live-status">
          <span className={`architecture-mode-badge mode-${systemMode || 'unknown'}`}>
            {systemMode || '...'}
          </span>
          <span className="architecture-status-item">
            DB: <StatusChip label={systemServices.databaseConnected ? 'connected' : systemServices.database ? 'unreachable' : 'off'} tone={systemServices.databaseConnected ? 'ok' : systemServices.database ? 'warn' : 'neutral'} />
          </span>
          <span className="architecture-status-item">
            Queue: <StatusChip label={systemServices.queue ? 'on' : 'off'} tone={systemServices.queue ? 'ok' : 'neutral'} />
          </span>
          <span className="architecture-status-item">
            Redis: <StatusChip label={systemServices.redis ? 'connected' : 'off'} tone={systemServices.redis ? 'ok' : 'neutral'} />
          </span>
          <span className="architecture-status-item">
            Symbols: {providerHealth.length > 0 ? providerHealth.length : '—'}
          </span>
          <span className="architecture-status-item">
            {providerHealthQuery.isFetching ? '⟳ refreshing' : `✓ ${formatDateTime(latestProviderCheck)}`}
          </span>
        </div>
        <label className="architecture-search">
          <span>Filter Sections</span>
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search workflow, contracts, owners, queues..."
          />
        </label>
        <div className="architecture-actions">
          <button type="button" onClick={expandAll}>Expand All</button>
          <button type="button" onClick={collapseAll}>Collapse All</button>
        </div>
      </section>

      <section className="architecture-index-shell">
        <h2>Architecture Index</h2>
        <div className="architecture-index-grid">
          {visibleSections.map((section) => (
            <button
              key={section.id}
              type="button"
              className="architecture-index-chip"
              onClick={() => scrollToSection(section.id)}
            >
              {section.title}
            </button>
          ))}
        </div>
      </section>

      {visibleIds.has('status') && (
        <SectionBlock
          id="status"
          title="Status Snapshot"
          summary="Quick orientation before using the detailed sections below."
          collapsed={collapsedSections.includes('status')}
          onToggle={toggleSection}
        >
          <div className="architecture-grid architecture-grid-wide">
            <article className="architecture-card">
              <h3>Operating Mode</h3>
              <ul>
                {STATUS_SNAPSHOT.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </article>
            <article className="architecture-card">
              <h3>Current Build Slice</h3>
              <ul>
                {CURRENT_SLICE.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </article>
            <article className="architecture-card">
              <h3>Live Runtime Snapshot</h3>
              <p className="architecture-live-note">
                Quick metrics from <strong>/api/providers/health</strong> and <strong>/api/imports/runs</strong>.
              </p>
              <div className="architecture-actions">
                <button type="button" onClick={refreshLiveStatus}>Refresh Live Status</button>
                <button
                  type="button"
                  onClick={() => setAutoRefreshEnabled((current) => !current)}
                >
                  Auto Refresh: {autoRefreshEnabled ? 'On (30s)' : 'Off'}
                </button>
              </div>
              {systemMode && (
                <article className="architecture-status-mini-card architecture-mode-notice">
                  <h4>System Mode</h4>
                  <div className="architecture-mode-badge">
                    <StatusChip 
                      label={systemMode === 'fallback' ? 'Fallback Mode' : 'Full Mode'} 
                      tone={systemMode === 'fallback' ? 'warn' : 'ok'}
                    />
                  </div>
                  <ul className="architecture-live-list">
                    <li>Database: {systemServices.database ? '✓ Connected' : '✗ Not available'}</li>
                    <li>Queue: {systemServices.queue ? '✓ Enabled' : '✗ Disabled'}</li>
                    <li>Redis: {systemServices.redis ? '✓ Connected' : '✗ Not available'}</li>
                  </ul>
                  {systemMode === 'fallback' && (
                    <div className="architecture-mode-help">
                      <p><strong>What this means:</strong></p>
                      <ul>
                        <li>{!systemServices.database && '• Database not configured - using in-memory storage'}</li>
                        <li>{!systemServices.redis && '• Redis not available - queue processing disabled'}</li>
                        <li>• Demo data shown below</li>
                      </ul>
                      <p><strong>Next steps:</strong> Run <code>scripts/setup-local-infra.ps1</code> to install PostgreSQL/Redis</p>
                    </div>
                  )}
                </article>
              )}
              <div className="architecture-grid architecture-grid-wide">
                <article className="architecture-status-mini-card">
                  <h4>API Connectivity</h4>
                  <ul className="architecture-live-list">
                    <li>
                      Provider health:{' '}
                      <StatusChip
                        label={providerHealthQuery.isError ? 'offline' : providerHealthQuery.isLoading || providerHealthQuery.isRefetching ? 'checking' : 'online'}
                        tone={queryConnectivityTone(providerHealthQuery)}
                      />
                    </li>
                    <li>
                      Import runs:{' '}
                      <StatusChip
                        label={importRunsQuery.isError ? 'offline' : importRunsQuery.isLoading || importRunsQuery.isRefetching ? 'checking' : 'online'}
                        tone={queryConnectivityTone(importRunsQuery)}
                      />
                    </li>
                    <li>Last provider check: {formatDateTime(latestProviderCheck)}</li>
                    <li>Last import request: {formatDateTime(latestImportRequest)}</li>
                  </ul>
                </article>

                <article className="architecture-status-mini-card">
                  <h4>Provider Health Mix</h4>
                  {providerHealthQuery.isLoading && <p>Checking provider health...</p>}
                  {providerHealthQuery.error && <p>Provider health is not reachable from this shell yet.</p>}
                  {!providerHealthQuery.isLoading && !providerHealthQuery.error && (
                    <ul className="architecture-live-list">
                      <li>Providers tracked: {providerHealth.length}</li>
                      <li>Healthy: {providerStatusCounts.healthy || 0}</li>
                      <li>Missing credentials: {providerStatusCounts['missing-credentials'] || 0}</li>
                      <li>Other states: {Math.max(providerHealth.length - (providerStatusCounts.healthy || 0) - (providerStatusCounts['missing-credentials'] || 0), 0)}</li>
                    </ul>
                  )}
                </article>

                <article className="architecture-status-mini-card">
                  <h4>Import Pipeline Pulse</h4>
                  {importRunsQuery.isLoading && <p>Loading recent import runs...</p>}
                  {importRunsQuery.error && <p>Recent import runs are not reachable from this shell yet.</p>}
                  {!importRunsQuery.isLoading && !importRunsQuery.error && (
                    <ul className="architecture-live-list">
                      <li>Recent runs loaded: {recentImportRuns.length}</li>
                      <li>Completed: {importRunStatusCounts.completed || 0}</li>
                      <li>Running/queued: {(importRunStatusCounts.running || 0) + (importRunStatusCounts.queued || 0)}</li>
                      <li>Failed: {importRunStatusCounts.failed || 0}</li>
                    </ul>
                  )}
                </article>
              </div>
            </article>
          </div>
        </SectionBlock>
      )}

      {visibleIds.has('tree') && (
        <SectionBlock
          id="tree"
          title="Architecture Tree"
          summary="The React version keeps the same knowledge shape as the mapper: domains, components, contracts, workflows, and verification rules in one place."
          collapsed={collapsedSections.includes('tree')}
          onToggle={toggleSection}
        >
          <div className="architecture-grid architecture-grid-wide">
            <article className="architecture-card">
              <h3>Core Domains</h3>
              <ul>
                {DOMAINS.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </article>
            <article className="architecture-card">
              <h3>System Spine</h3>
              <ol>
                {SYSTEM_SPINE.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ol>
            </article>
          </div>
        </SectionBlock>
      )}

      {visibleIds.has('workflow') && (
        <SectionBlock
          id="workflow"
          title="Decision Workflow"
          summary="Start here before changing code. This keeps new work aligned with existing systems, data contracts, security boundaries, and future UI needs."
          collapsed={collapsedSections.includes('workflow')}
          onToggle={toggleSection}
        >
          <CardGrid cards={DECISION_WORKFLOW} />
        </SectionBlock>
      )}

      {visibleIds.has('matrix') && (
        <SectionBlock
          id="matrix"
          title="Feature Decision Matrix"
          summary="After classifying a change, use this matrix to choose the likely owner and required contract."
          collapsed={collapsedSections.includes('matrix')}
          onToggle={toggleSection}
        >
          <div className="architecture-card architecture-card-full">
            <div className="architecture-table-wrap">
              <table className="architecture-table">
                <thead>
                  <tr>
                    <th>Feature Type</th>
                    <th>Likely Owner</th>
                    <th>Required Contract</th>
                  </tr>
                </thead>
                <tbody>
                  {FEATURE_MATRIX.map((row) => (
                    <tr key={row[0]}>
                      <td>{row[0]}</td>
                      <td>{row[1]}</td>
                      <td>{row[2]}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </SectionBlock>
      )}

      {visibleIds.has('intake') && (
        <SectionBlock
          id="intake"
          title="Intake Template"
          summary="Use this intake before architecture-sensitive work so the owner, data flow, contract, and verification path are explicit."
          collapsed={collapsedSections.includes('intake')}
          onToggle={toggleSection}
        >
          <div className="architecture-grid architecture-grid-wide">
            {INTAKE_TEMPLATE.map((group) => (
              <article className="architecture-card" key={group.title}>
                <h3>{group.title}</h3>
                <ul>
                  {group.items.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </article>
            ))}
          </div>
        </SectionBlock>
      )}

      {visibleIds.has('discovery') && (
        <SectionBlock
          id="discovery"
          title="Discovery And Sources"
          summary="Use discovery to find existing routes, handlers, storage, queues, assets, scoring contracts, and boundary evidence before implementation."
          collapsed={collapsedSections.includes('discovery')}
          onToggle={toggleSection}
        >
          <div className="architecture-grid architecture-grid-wide">
            <article className="architecture-card">
              <h3>Discovery Commands</h3>
              <ul>
                {DISCOVERY_COMMANDS.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </article>
            <article className="architecture-card">
              <h3>Information Sources</h3>
              <ul>
                {INFORMATION_SOURCES.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </article>
          </div>
        </SectionBlock>
      )}

      {visibleIds.has('context') && (
        <SectionBlock
          id="context"
          title="System Context"
          summary="Use these boundaries to decide where work belongs before creating files, routes, storage, queues, or UI components."
          collapsed={collapsedSections.includes('context')}
          onToggle={toggleSection}
        >
          <div className="architecture-grid architecture-grid-wide">
            {SYSTEM_CONTEXTS.map((item) => (
              <article className="architecture-card" key={item[0]}>
                <h3>{item[0]}</h3>
                <p>{item[1]}</p>
              </article>
            ))}
          </div>
        </SectionBlock>
      )}

      {visibleIds.has('owners') && (
        <SectionBlock
          id="owners"
          title="Owner Directory"
          summary="Use this directory to find the first place to inspect or extend before creating new implementation paths."
          collapsed={collapsedSections.includes('owners')}
          onToggle={toggleSection}
        >
          <CardGrid cards={OWNER_DIRECTORY} />
        </SectionBlock>
      )}

      {visibleIds.has('contracts') && (
        <SectionBlock
          id="contracts"
          title="Contract Inventory"
          summary="Use these contract cards when a feature adds or changes routes, queues, storage, UI data modes, or bridge payloads."
          collapsed={collapsedSections.includes('contracts')}
          onToggle={toggleSection}
        >
          <div className="architecture-grid architecture-grid-wide">
            <article className="architecture-card">
              <h3>Contract Types</h3>
              <ul>
                {CONTRACTS.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </article>
          </div>
          <CardGrid cards={CONTRACT_CARDS} />
        </SectionBlock>
      )}

      {visibleIds.has('register') && (
        <SectionBlock
          id="register"
          title="Current Contract Register"
          summary="Concrete contracts already present in the codebase or now established as migration proofs. Update this when routes, payloads, read paths, or response shapes change."
          collapsed={collapsedSections.includes('register')}
          onToggle={toggleSection}
        >
          <div className="architecture-card architecture-card-full">
            <div className="architecture-table-wrap">
              <table className="architecture-table">
                <thead>
                  <tr>
                    <th>Route</th>
                    <th>Method</th>
                    <th>Permission</th>
                    <th>Owner</th>
                    <th>Contract</th>
                  </tr>
                </thead>
                <tbody>
                  {CURRENT_ROUTE_CONTRACTS.map((row) => (
                    <tr key={row.route}>
                      <td>{row.route}</td>
                      <td>{row.method}</td>
                      <td>{row.permission}</td>
                      <td>{row.owner}</td>
                      <td>{row.contract}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <div className="architecture-card architecture-card-full">
            <h3>Live Provider Health Register</h3>
            {providerHealthQuery.isLoading && <p>Loading live provider health...</p>}
            {providerHealthQuery.error && <p>Live provider health is not available from the current API base URL.</p>}
            {!providerHealthQuery.isLoading && !providerHealthQuery.error && providerHealth.length === 0 && (
              <p>No provider health entries have been recorded yet.</p>
            )}
            {!providerHealthQuery.isLoading && !providerHealthQuery.error && providerHealth.length > 0 && (
              <div className="architecture-table-wrap">
                <table className="architecture-table">
                  <thead>
                    <tr>
                      <th>Provider</th>
                      <th>Status</th>
                      <th>Credentials</th>
                      <th>Checked At</th>
                      <th>Message</th>
                    </tr>
                  </thead>
                  <tbody>
                    {providerHealth.map((row) => (
                      <tr key={row.provider}>
                        <td>{row.displayName || row.provider}</td>
                        <td>
                          <StatusChip label={row.status || 'unknown'} tone={providerStatusTone(row.status)} />
                        </td>
                        <td>{row.credentialsConfigured ? 'configured' : 'missing'}</td>
                        <td>{row.checkedAt || 'not yet checked'}</td>
                        <td>{row.message}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
          <div className="architecture-card architecture-card-full">
            <h3>Recent Import Runs</h3>
            {importRunsQuery.isLoading && <p>Loading recent import runs...</p>}
            {importRunsQuery.error && <p>Recent import runs are not reachable from the current API base URL.</p>}
            {!importRunsQuery.isLoading && !importRunsQuery.error && recentImportRuns.length === 0 && (
              <p>No import runs have been recorded yet.</p>
            )}
            {!importRunsQuery.isLoading && !importRunsQuery.error && recentImportRuns.length > 0 && (
              <div className="architecture-table-wrap">
                <table className="architecture-table">
                  <thead>
                    <tr>
                      <th>Symbol</th>
                      <th>Provider</th>
                      <th>Timeframe</th>
                      <th>Status</th>
                      <th>Requested</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recentImportRuns.map((run) => (
                      <tr key={run.id}>
                        <td>{run.symbol?.ticker || run.symbolId}</td>
                        <td>{run.provider}</td>
                        <td>{run.timeframe}</td>
                        <td>
                          <StatusChip label={run.status || 'unknown'} tone={importStatusTone(run.status)} />
                        </td>
                        <td>{run.requestedAt}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
          <div className="architecture-grid architecture-grid-wide">
            {CURRENT_FLOW_CONTRACTS.map((flow) => (
              <article className="architecture-card" key={flow.title}>
                <h3>{flow.title}</h3>
                <ul>
                  {flow.facts.map((fact) => (
                    <li key={fact}>{fact}</li>
                  ))}
                </ul>
              </article>
            ))}
          </div>
        </SectionBlock>
      )}

      {visibleIds.has('queue') && (
        <SectionBlock
          id="queue"
          title="Queue And Provider Contract"
          summary="Concrete rules for provider-backed data so external calls stay behind freshness, queue, adapter, storage, and UI status boundaries."
          collapsed={collapsedSections.includes('queue')}
          onToggle={toggleSection}
        >
          <CardGrid cards={QUEUE_PROVIDER_CARDS} />
          <div className="architecture-card architecture-card-full">
            <h3>Queue And UI Data States</h3>
            <div className="architecture-table-wrap">
              <table className="architecture-table">
                <thead>
                  <tr>
                    <th>State</th>
                    <th>Meaning</th>
                  </tr>
                </thead>
                <tbody>
                  {DATA_STATES.map((row) => (
                    <tr key={row[0]}>
                      <td>{row[0]}</td>
                      <td>{row[1]}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </SectionBlock>
      )}

      {visibleIds.has('scoring') && (
        <SectionBlock
          id="scoring"
          title="Scoring And Strategy Contract"
          summary="Concrete rules for directive, strategy, stored-score, and scoring UI work so score behavior remains testable and explainable."
          collapsed={collapsedSections.includes('scoring')}
          onToggle={toggleSection}
        >
          <CardGrid cards={SCORING_STRATEGY_CARDS} />
        </SectionBlock>
      )}

      {visibleIds.has('governance') && (
        <SectionBlock
          id="governance"
          title="Governance And Guardrails"
          summary="Use these workflow, guardrail, verification, and completion rules to keep architecture-sensitive work reliable."
          collapsed={collapsedSections.includes('governance')}
          onToggle={toggleSection}
        >
          <CardGrid cards={MAINTENANCE_WORKFLOW} />
          <CardGrid cards={AI_GUARDRAILS} />
          <CardGrid cards={VERIFICATION_GOVERNANCE} />
          <div className="architecture-grid architecture-grid-wide">
            <article className="architecture-card">
              <h3>Definition Of Done</h3>
              <ul>
                {DEFINITION_OF_DONE.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </article>
            <article className="architecture-card">
              <h3>Handoff Checklist</h3>
              <ul>
                {HANDOFF_CHECKLIST.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </article>
          </div>
        </SectionBlock>
      )}

      {visibleIds.has('gaps') && (
        <SectionBlock
          id="gaps"
          title="Known Gaps And Revision Log"
          summary="Keep unresolved architecture decisions and local change history visible on the same page as the implementation rules."
          collapsed={collapsedSections.includes('gaps')}
          onToggle={toggleSection}
        >
          <div className="architecture-grid architecture-grid-wide">
            <article className="architecture-card">
              <h3>Known Gaps</h3>
              <ul>
                {KNOWN_GAPS.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </article>
            <article className="architecture-card">
              <h3>Revision Log</h3>
              <ul>
                {REVISION_LOG.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </article>
          </div>
        </SectionBlock>
      )}
    </main>
  )
}

