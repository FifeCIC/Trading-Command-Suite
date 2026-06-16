import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { apiGet } from '../core/api/client'
import LoadingSkeleton from '../components/LoadingSkeleton'
import ApiOfflineBanner from '../components/ApiOfflineBanner'
import {
  ACTIVATION_GATE_SYSTEM,
  AI_GUARDRAILS,
  ALERT_CENTER_ARCHITECTURE,
  ARCHITECTURE_INDEX,
  CALIBRATION_SYSTEM,
  CONTRACTS,
  CONTRACT_CARDS,
  CONTRACT_REGISTER_LAST_UPDATED,
  CURRENT_FLOW_CONTRACTS,
  CURRENT_ROUTE_CONTRACTS,
  CURRENT_SLICE,
  DATABASE_SCHEMA,
  DATA_STATES,
  DECISION_WORKFLOW,
  DEFINITION_OF_DONE,
  DISCOVERY_COMMANDS,
  DOMAINS,
  EXIT_SIGNAL_SYSTEM,
  FEATURE_MATRIX,
  HANDOFF_CHECKLIST,
  INTAKE_TEMPLATE,
  INFORMATION_SOURCES,
  KNOWN_GAPS,
  MAINTENANCE_WORKFLOW,
  OWNER_DIRECTORY,
  QUEUE_PROVIDER_CARDS,
  REVISION_LOG,
  ROADMAP_ITEMS,
  SCORING_STRATEGY_CARDS,
  SECTION_META,
  STATUS_SNAPSHOT,
  SYSTEM_CONTEXTS,
  SYSTEM_SPINE,
  VERIFICATION_GOVERNANCE,
} from './architecture-framework.data'
import './architecture-framework.css'

const LIVE_REFRESH_INTERVAL_MS = 30_000
const EMPTY_OBJ = {}
const DRIFT_STORAGE_KEY = 'architecture-drift-verification'
const COLLAPSED_STORAGE_KEY = 'architecture-collapsed-sections'
const STALE_DAYS = 7
const WARN_DAYS = 3

function getVerificationState() {
  try {
    const raw = localStorage.getItem(DRIFT_STORAGE_KEY)
    return raw ? JSON.parse(raw) : {}
  } catch {
    return {}
  }
}

function setVerificationState(state) {
  try {
    localStorage.setItem(DRIFT_STORAGE_KEY, JSON.stringify(state))
  } catch {
    // localStorage unavailable
  }
}

function daysSince(dateStr) {
  if (!dateStr) return Infinity
  const then = Date.parse(dateStr)
  if (Number.isNaN(then)) return Infinity
  return (Date.now() - then) / (1000 * 60 * 60 * 24)
}

function verificationTone(dateStr) {
  const days = daysSince(dateStr)
  if (days > STALE_DAYS) return 'error'
  if (days > WARN_DAYS) return 'warn'
  return 'ok'
}

function verificationLabel(dateStr) {
  const days = daysSince(dateStr)
  if (days > STALE_DAYS) return 'Stale'
  if (days > WARN_DAYS) return 'Review'
  return 'Verified'
}

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
  const [collapsedSections, setCollapsedSections] = useState(() => {
    try {
      const raw = localStorage.getItem(COLLAPSED_STORAGE_KEY)
      return raw ? JSON.parse(raw) : []
    } catch {
      return []
    }
  })
  const [autoRefreshEnabled, setAutoRefreshEnabled] = useState(true)
  const [viewMode, setViewMode] = useState('framework')
  const [dodChecked, setDodChecked] = useState(() => new Set())
  const [verificationState, setVerificationState_] = useState(() => getVerificationState())

  function updateVerification(itemKey, dateStr) {
    setVerificationState_((prev) => {
      const next = { ...prev, [itemKey]: dateStr || new Date().toISOString().slice(0, 10) }
      setVerificationState(next)
      return next
    })
  }

  function markAllVerified(items) {
    const today = new Date().toISOString().slice(0, 10)
    setVerificationState_((prev) => {
      const next = { ...prev }
      items.forEach((key) => { next[key] = today })
      setVerificationState(next)
      return next
    })
  }

  function getVerifiedDate(itemKey) {
    return verificationState[itemKey] || null
  }

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

  const systemHealthQuery = useQuery({
    queryKey: ['architecture', 'system-health'],
    queryFn: () => apiGet('/api/health'),
    refetchInterval: autoRefreshEnabled ? LIVE_REFRESH_INTERVAL_MS : false,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
  })

  const alertsCountQuery = useQuery({
    queryKey: ['architecture', 'alerts-count'],
    queryFn: () => apiGet('/api/alerts/count'),
    refetchInterval: autoRefreshEnabled ? LIVE_REFRESH_INTERVAL_MS : false,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
  })

  const calibrationsQuery = useQuery({
    queryKey: ['architecture', 'calibrations'],
    queryFn: () => apiGet('/api/calibrations'),
    refetchInterval: autoRefreshEnabled ? LIVE_REFRESH_INTERVAL_MS : false,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
  })

  const providerHealthData = providerHealthQuery.data ?? EMPTY_OBJ
  const importRunsData = importRunsQuery.data ?? EMPTY_OBJ
  const systemHealthData = systemHealthQuery.data ?? EMPTY_OBJ
  const alertsCountData = alertsCountQuery.data ?? EMPTY_OBJ
  const calibrationsData = calibrationsQuery.data ?? EMPTY_OBJ
  
  const systemMode = providerHealthData.mode || importRunsData.mode || systemHealthData.mode || null
  const systemServices = providerHealthData.services || importRunsData.services || systemHealthData.subsystems || {}
  
  const providerHealth = useMemo(() => {
    return Array.isArray(providerHealthData.providers) ? providerHealthData.providers : Array.isArray(providerHealthData) ? providerHealthData : []
  }, [providerHealthData])
  const recentImportRuns = useMemo(() => {
    return Array.isArray(importRunsData.runs) ? importRunsData.runs : Array.isArray(importRunsData) ? importRunsData : []
  }, [importRunsData])
  const calibrationsList = useMemo(() => {
    return Array.isArray(calibrationsData) ? calibrationsData : []
  }, [calibrationsData])

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

  function persistCollapsed(ids) {
    try { localStorage.setItem(COLLAPSED_STORAGE_KEY, JSON.stringify(ids)) } catch { /* ignore */ }
  }

  function toggleSection(sectionId) {
    setCollapsedSections((current) => {
      const next = current.includes(sectionId)
        ? current.filter((item) => item !== sectionId)
        : [...current, sectionId]
      persistCollapsed(next)
      return next
    })
  }

  function collapseAll() {
    const all = SECTION_META.map((section) => section.id)
    persistCollapsed(all)
    setCollapsedSections(all)
  }

  function expandAll() {
    persistCollapsed([])
    setCollapsedSections([])
  }

  function refreshLiveStatus() {
    void Promise.all([
      providerHealthQuery.refetch(),
      importRunsQuery.refetch(),
      systemHealthQuery.refetch(),
      alertsCountQuery.refetch(),
      calibrationsQuery.refetch(),
    ])
  }

  return (
    <main className="architecture-page">
      <section className="architecture-hero">
        <div>
          <p className="eyebrow">Trading Command Suite</p>
          <div className="architecture-view-toggle">
            <button type="button" className={viewMode === 'framework' ? 'active' : ''} onClick={() => setViewMode('framework')} aria-label="Switch to framework view">Framework</button>
            <button type="button" className={viewMode === 'roadmap' ? 'active' : ''} onClick={() => setViewMode('roadmap')} aria-label="Switch to roadmap view">Roadmap</button>
          </div>
        </div>
        <div className="architecture-status-card">
          <p><strong>Priority:</strong> P0 foundation</p>
          <p><strong>Role:</strong> active decision reference</p>
          <p><strong>Mode:</strong> {viewMode === 'roadmap' ? 'roadmap overlay' : 'framework'}</p>
        </div>
      </section>

      {viewMode === 'roadmap' && (
        <section className="architecture-section" id="roadmap">
          <h2>Roadmap — Sorted by Architecture Domain</h2>
          <p className="architecture-subcopy">
            Tasks and GitHub Issues mapped to the domains they implement. Status is updated from SPRINT.md.
          </p>

          <div className="architecture-grid architecture-grid-wide">
            {ROADMAP_ITEMS.map((domain) => (
              <article className="architecture-card" key={domain.domain}>
                <h3>{domain.domain}</h3>
                <ul>
                  {domain.items.map((item) => (
                    <li key={item.issue}>
                      <span className={`architecture-chip architecture-chip-${item.status === 'done' ? 'ok' : item.status === 'active' ? 'info' : 'neutral'}`}>
                        {item.status}
                      </span>{' '}
                      {item.gh ? (
                        <a href={item.gh} target="_blank" rel="noreferrer">{item.issue}: {item.label}</a>
                      ) : (
                        <span>{item.issue}: {item.label}</span>
                      )}
                    </li>
                  ))}
                </ul>
              </article>
            ))}
          </div>
        </section>
      )}

      {viewMode !== 'roadmap' && (<>

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
            Alerts:{' '}
            <StatusChip
              label={alertsCountQuery.isLoading ? '…' : `${alertsCountData.active ?? '?'}`}
              tone={alertsCountData.critical > 0 ? 'error' : alertsCountData.active > 0 ? 'warn' : 'ok'}
            />
          </span>
          <span className="architecture-status-item">
            Calibrations: {calibrationsList.length > 0 ? calibrationsList.length : '—'}
          </span>
          <span className="architecture-status-item">
            Uptime: {systemHealthData.uptime ? `${Math.floor(systemHealthData.uptime / 60)}m` : '—'}
          </span>
          <span className="architecture-status-item">
            {(() => {
              const staleCount = CURRENT_ROUTE_CONTRACTS.filter((r) => {
                const v = getVerifiedDate(`route:${r.route}`)
                return !v || daysSince(v) > STALE_DAYS
              }).length
              const total = CURRENT_ROUTE_CONTRACTS.length
              return staleCount > 0 ? (
                <StatusChip label={`${staleCount}/${total} stale`} tone="warn" />
              ) : (
                <StatusChip label={`${total} verified`} tone="ok" />
              )
            })()}
          </span>
          <span className="architecture-status-item">
            {providerHealthQuery.isFetching ? '⟳ refreshing' : `✓ ${formatDateTime(latestProviderCheck)}`}
          </span>
        </div>
        <div className="architecture-search">
          <label htmlFor="arch-section-search">
            <span className="architecture-sr-only">Filter Sections</span>
            <span aria-hidden="true">Filter Sections</span>
          </label>
          <input
            id="arch-section-search"
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search workflow, contracts, owners, queues..."
            aria-label="Filter architecture sections by keyword"
          />
        </div>
        <div className="architecture-actions">
          <button type="button" onClick={expandAll} aria-label="Expand all sections">Expand All</button>
          <button type="button" onClick={collapseAll} aria-label="Collapse all sections">Collapse All</button>
        </div>
      </section>

      <section className="architecture-index-shell">
        <div className="architecture-index-header">
          <h2>Architecture Index</h2>
          <div className="architecture-actions" style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            {(() => {
              const staleSectionCount = SECTION_META.filter((s) => {
                const v = getVerifiedDate(`section:${s.id}`)
                return !v || daysSince(v) > STALE_DAYS
              }).length
              const total = SECTION_META.length
              return staleSectionCount > 0 ? (
                <>
                  <span className="architecture-chip architecture-chip-warn">{staleSectionCount} section{staleSectionCount > 1 ? 's' : ''} need review</span>
                  <button type="button" onClick={() => markAllVerified(SECTION_META.map((s) => `section:${s.id}`))} aria-label="Mark all sections as verified">
                    Mark Sections Verified
                  </button>
                </>
              ) : (
                <span className="architecture-chip architecture-chip-ok">All {total} sections verified</span>
              )
            })()}
          </div>
        </div>
        <div className="architecture-index-grid">
          {visibleSections.map((section) => {
            const secKey = `section:${section.id}`
            const verifiedDate = getVerifiedDate(secKey)
            const vTone = verificationTone(verifiedDate)
            return (
            <button
              key={section.id}
              type="button"
              className="architecture-index-chip"
              onClick={() => scrollToSection(section.id)}
            >
              {section.title}
              {vTone !== 'ok' && (
                <span className={`architecture-chip architecture-chip-${vTone}`} style={{ marginLeft: 6, fontSize: 9 }}>
                  {vTone === 'error' ? 'stale' : 'review'}
                </span>
              )}
              {vTone === 'ok' && verifiedDate && (
                <span className="architecture-chip architecture-chip-ok" style={{ marginLeft: 6, fontSize: 9 }}>
                  ✓
                </span>
              )}
            </button>
            )
          })}
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
                Quick metrics from <strong>/api/providers/health</strong>, <strong>/api/imports/runs</strong>, <strong>/api/health</strong>, <strong>/api/alerts/count</strong>, and <strong>/api/calibrations</strong>.
              </p>
              <div className="architecture-actions">
                <button type="button" onClick={refreshLiveStatus} aria-label="Refresh all live status indicators">Refresh Live Status</button>
                <button
                  type="button"
                  onClick={() => setAutoRefreshEnabled((current) => !current)}
                  aria-label={autoRefreshEnabled ? 'Disable auto refresh' : 'Enable auto refresh'}
                >
                  Auto Refresh: {autoRefreshEnabled ? 'On (30s)' : 'Off'}
                </button>
              </div>
              {systemMode && (
                <article className="architecture-status-mini-card architecture-mode-notice">
                  <h4 id="system-mode-heading">System Mode</h4>
                  <div aria-labelledby="system-mode-heading">
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
                  {providerHealthQuery.isLoading && <LoadingSkeleton variant="text" lines={4} />}
                  {providerHealthQuery.error && <ApiOfflineBanner compact />}
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
                  {importRunsQuery.isLoading && <LoadingSkeleton variant="text" lines={4} />}
                  {importRunsQuery.error && <ApiOfflineBanner compact />}
                  {!importRunsQuery.isLoading && !importRunsQuery.error && (
                    <ul className="architecture-live-list">
                      <li>Recent runs loaded: {recentImportRuns.length}</li>
                      <li>Completed: {importRunStatusCounts.completed || 0}</li>
                      <li>Running/queued: {(importRunStatusCounts.running || 0) + (importRunStatusCounts.queued || 0)}</li>
                      <li>Failed: {importRunStatusCounts.failed || 0}</li>
                    </ul>
                  )}
                </article>

                <article className="architecture-status-mini-card">
                  <h4>System Health</h4>
                  {systemHealthQuery.isLoading && <LoadingSkeleton variant="text" lines={4} />}
                  {systemHealthQuery.error && <ApiOfflineBanner compact />}
                  {!systemHealthQuery.isLoading && !systemHealthQuery.error && (
                    <ul className="architecture-live-list">
                      <li>
                        Status:{' '}
                        <StatusChip
                          label={systemHealthData.status || 'unknown'}
                          tone={systemHealthData.status === 'ok' ? 'ok' : systemHealthData.status === 'degraded' ? 'warn' : 'error'}
                        />
                      </li>
                      <li>Uptime: {systemHealthData.uptime ? `${Math.floor(systemHealthData.uptime / 60)}m ${Math.floor(systemHealthData.uptime % 60)}s` : '—'}</li>
                      <li>DB latency: {systemHealthData.subsystems?.database?.latency != null ? `${systemHealthData.subsystems.database.latency}ms` : '—'}</li>
                      <li>Queue: {systemHealthData.subsystems?.queue?.status || '—'}</li>
                    </ul>
                  )}
                </article>

                <article className="architecture-status-mini-card">
                  <h4>Alert Center Status</h4>
                  {alertsCountQuery.isLoading && <LoadingSkeleton variant="text" lines={3} />}
                  {alertsCountQuery.error && <ApiOfflineBanner compact />}
                  {!alertsCountQuery.isLoading && !alertsCountQuery.error && (
                    <ul className="architecture-live-list">
                      <li>
                        Active alerts:{' '}
                        <StatusChip
                          label={String(alertsCountData.active ?? 0)}
                          tone={alertsCountData.critical > 0 ? 'error' : alertsCountData.active > 0 ? 'warn' : 'ok'}
                        />
                      </li>
                      <li>
                        Critical:{' '}
                        <StatusChip
                          label={String(alertsCountData.critical ?? 0)}
                          tone={alertsCountData.critical > 0 ? 'error' : 'ok'}
                        />
                      </li>
                      <li>
                        Alert API:{' '}
                        <StatusChip
                          label={alertsCountQuery.isError ? 'offline' : 'online'}
                          tone={queryConnectivityTone(alertsCountQuery)}
                        />
                      </li>
                    </ul>
                  )}
                </article>

                <article className="architecture-status-mini-card">
                  <h4>Calibration Status</h4>
                  {calibrationsQuery.isLoading && <LoadingSkeleton variant="text" lines={3} />}
                  {calibrationsQuery.error && <ApiOfflineBanner compact />}
                  {!calibrationsQuery.isLoading && !calibrationsQuery.error && (
                    <ul className="architecture-live-list">
                      <li>Total calibrations: {calibrationsList.length}</li>
                      <li>
                        Calibration API:{' '}
                        <StatusChip
                          label={calibrationsQuery.isError ? 'offline' : 'online'}
                          tone={queryConnectivityTone(calibrationsQuery)}
                        />
                      </li>
                    </ul>
                  )}
                </article>
              </div>
            </article>
          </div>
        </SectionBlock>
      )}

      {visibleIds.has('index') && (
        <SectionBlock
          id="index"
          title="Architecture Index — 24-Section Parity"
          summary="Table of contents showing all 24 architecture sections and their implementation status."
          collapsed={collapsedSections.includes('index')}
          onToggle={toggleSection}
        >
          <div className="architecture-card architecture-card-full">
            <div className="architecture-table-wrap">
              <table className="architecture-table">
                <thead><tr><th>#</th><th>Section</th><th>Status</th></tr></thead>
                <tbody>
                  {ARCHITECTURE_INDEX.map((item, i) => (
                    <tr key={item.name}>
                      <td>{i + 1}</td>
                      <td>{item.name}</td>
                      <td>
                        <span className={`architecture-mode-badge architecture-badge-${item.status === 'done' ? 'ok' : item.status === 'partial' ? 'warn' : 'neutral'}`}>
                          {item.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="hint" style={{ marginTop: 12 }}>24 sections documented. 20 established + 4 new subsystem deep-dives.</p>
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

      {visibleIds.has('schema') && (
        <SectionBlock
          id="schema"
          title="Database Schema"
          summary="Complete entity-relationship diagram for AI guidance. Shows all current and planned tables with relationships to guide implementation decisions."
          collapsed={collapsedSections.includes('schema')}
          onToggle={toggleSection}
        >
          <div className="architecture-card architecture-card-full">
            <h3>Core Trading Entities (Implemented)</h3>
            <div className="architecture-schema-grid">
              {DATABASE_SCHEMA.coreEntities.map((entity) => (
                <article className="architecture-schema-card" key={entity.table}>
                  <h4>{entity.table}</h4>
                  <p className="architecture-schema-desc">{entity.description}</p>
                  <div className="architecture-schema-section">
                    <strong>Fields:</strong>
                    <ul>
                      {entity.fields.map((field) => (
                        <li key={field}>{field}</li>
                      ))}
                    </ul>
                  </div>
                  {entity.relationships.length > 0 && (
                    <div className="architecture-schema-section">
                      <strong>Relationships:</strong>
                      <ul>
                        {entity.relationships.map((rel) => (
                          <li key={rel}>{rel}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </article>
              ))}
            </div>
          </div>

          <div className="architecture-card architecture-card-full">
            <h3>Market Data Entities (Implemented)</h3>
            <div className="architecture-schema-grid">
              {DATABASE_SCHEMA.marketDataEntities.map((entity) => (
                <article className="architecture-schema-card" key={entity.table}>
                  <h4>{entity.table}</h4>
                  <p className="architecture-schema-desc">{entity.description}</p>
                  <div className="architecture-schema-section">
                    <strong>Fields:</strong>
                    <ul>
                      {entity.fields.map((field) => (
                        <li key={field}>{field}</li>
                      ))}
                    </ul>
                  </div>
                  {entity.relationships.length > 0 && (
                    <div className="architecture-schema-section">
                      <strong>Relationships:</strong>
                      <ul>
                        {entity.relationships.map((rel) => (
                          <li key={rel}>{rel}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {entity.indexes && (
                    <div className="architecture-schema-section">
                      <strong>Indexes:</strong>
                      <ul>
                        {entity.indexes.map((idx) => (
                          <li key={idx}>{idx}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </article>
              ))}
            </div>
          </div>

          <div className="architecture-card architecture-card-full">
            <h3>Planned Meta & Extension Tables</h3>
            <div className="architecture-schema-grid architecture-schema-grid-compact">
              {DATABASE_SCHEMA.plannedMetaTables.map((entity) => (
                <article className="architecture-schema-card architecture-schema-card-planned" key={entity.table}>
                  <h4>{entity.table}</h4>
                  <p className="architecture-schema-desc">{entity.description}</p>
                  <div className="architecture-schema-section">
                    <strong>Key Fields:</strong>
                    <ul>
                      {entity.fields.slice(0, 5).map((field) => (
                        <li key={field}>{field}</li>
                      ))}
                      {entity.fields.length > 5 && <li>... +{entity.fields.length - 5} more</li>}
                    </ul>
                  </div>
                  {entity.relationships.length > 0 && (
                    <div className="architecture-schema-section">
                      <strong>Relations:</strong>
                      <ul>
                        {entity.relationships.map((rel) => (
                          <li key={rel}>{rel}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </article>
              ))}
            </div>
          </div>

          <div className="architecture-grid architecture-grid-wide">
            <article className="architecture-card">
              <h3>Key Relationships</h3>
              <ul>
                {DATABASE_SCHEMA.keyRelationships.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </article>
            <article className="architecture-card">
              <h3>Data Flow Pattern</h3>
              <ul>
                {DATABASE_SCHEMA.dataFlow.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
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
                    <th>Status</th>
                    <th>Contract</th>
                    <th>Verified</th>
                  </tr>
                </thead>
                <tbody>
                  {CURRENT_ROUTE_CONTRACTS.map((row) => {
                    const statusClass = `architecture-mode-badge architecture-badge-${row.status === 'active' ? 'ok' : row.status === 'migration' ? 'warn' : 'neutral'}`
                    const statusStyle = {}
                    const routeKey = `route:${row.route}`
                    const verifiedDate = getVerifiedDate(routeKey)
                    const vTone = verificationTone(verifiedDate)
                    const vLabel = verificationLabel(verifiedDate)
                    return (
                    <tr key={row.route}>
                      <td>{row.route}</td>
                      <td>{row.method}</td>
                      <td>{row.permission}</td>
                      <td>{row.owner}</td>
                      <td><span className={statusClass} style={statusStyle}>{row.status || 'active'}</span></td>
                      <td>{row.contract}</td>
                      <td>
                        <span className="architecture-verify-cell">
                          <StatusChip label={vLabel} tone={vTone} />
                          {vTone !== 'ok' && (
                            <button
                              type="button"
                              className="architecture-verify-btn"
                              onClick={() => updateVerification(routeKey)}
                              title="Mark as verified"
                            >
                              ✓
                            </button>
                          )}
                          {verifiedDate && <span className="architecture-verify-date">{verifiedDate}</span>}
                        </span>
                      </td>
                    </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            <div className="architecture-actions" style={{ marginTop: 8 }}>
              <button type="button" onClick={() => markAllVerified(CURRENT_ROUTE_CONTRACTS.map((r) => `route:${r.route}`))} aria-label="Mark all route contracts as verified">
                Mark All Verified
              </button>
            </div>
            <p className="hint" style={{ marginTop: 12 }}>Last updated: {CONTRACT_REGISTER_LAST_UPDATED}. Update this register when routes, payloads, read paths, or response shapes change.</p>
          </div>
          <div className="architecture-card architecture-card-full">
            <h3>Live Provider Health Register</h3>
            {providerHealthQuery.isLoading && <LoadingSkeleton variant="table" rows={4} cols={2} />}
            {providerHealthQuery.error && <ApiOfflineBanner compact />}
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
            {importRunsQuery.isLoading && <LoadingSkeleton variant="table" rows={4} cols={3} />}
            {importRunsQuery.error && <ApiOfflineBanner compact />}
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

      {visibleIds.has('calibration') && (
        <SectionBlock
          id="calibration"
          title="Calibration System"
          summary="Symbol-specific weight overrides that adjust directive scores before aggregation in the scoring pipeline."
          collapsed={collapsedSections.includes('calibration')}
          onToggle={toggleSection}
        >
          <CardGrid cards={CALIBRATION_SYSTEM} />
        </SectionBlock>
      )}

      {visibleIds.has('activation-gate') && (
        <SectionBlock
          id="activation-gate"
          title="Activation Gate And Conditions"
          summary="Pre-scoring condition detection and directive suitability evaluation that adjusts how directives fire based on market regime."
          collapsed={collapsedSections.includes('activation-gate')}
          onToggle={toggleSection}
        >
          <CardGrid cards={ACTIVATION_GATE_SYSTEM} />
        </SectionBlock>
      )}

      {visibleIds.has('exit-signals') && (
        <SectionBlock
          id="exit-signals"
          title="Exit Signal System"
          summary="Four exit-focused directives that evaluate stored market data to determine when to close positions."
          collapsed={collapsedSections.includes('exit-signals')}
          onToggle={toggleSection}
        >
          <CardGrid cards={EXIT_SIGNAL_SYSTEM} />
        </SectionBlock>
      )}

      {visibleIds.has('alerts') && (
        <SectionBlock
          id="alerts"
          title="Alert Center Architecture"
          summary="Centralized alert and notification system with severity levels, lifecycle management, and live polling."
          collapsed={collapsedSections.includes('alerts')}
          onToggle={toggleSection}
        >
          <CardGrid cards={ALERT_CENTER_ARCHITECTURE} />
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
              <ul className="architecture-dod-list">
                {DEFINITION_OF_DONE.map((item, i) => (
                  <li key={i} className="architecture-dod-item">
                    <label>
                      <input
                        type="checkbox"
                        checked={dodChecked.has(i)}
                        onChange={() => {
                          setDodChecked((prev) => {
                            const next = new Set(prev)
                            if (next.has(i)) next.delete(i); else next.add(i)
                            return next
                          })
                        }}
                      />{' '}
                      <span className={dodChecked.has(i) ? 'architecture-dod-done' : ''}>{item}</span>
                    </label>
                  </li>
                ))}
              </ul>
              <p className="architecture-dod-progress">
                {dodChecked.size} of {DEFINITION_OF_DONE.length} complete
              </p>
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
      </>
      )}
    </main>
  )
}

