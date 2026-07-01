import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { apiGet } from '../core/api/client'
import LoadingSkeleton from '../components/LoadingSkeleton'
import './trading-platforms.css'
import './sources-accordion.css'

const PLATFORMS = [
  {
    id: 'alpaca',
    name: 'Alpaca Markets',
    description: 'Commission-free stock trading API. Paper trading available.',
    website: 'https://alpaca.markets',
    docs: 'https://docs.alpaca.markets',
    envKey: 'ALPACA_API_KEY',
    capabilities: ['quotes', 'candles', 'account', 'orders'],
    endpoint: 'https://paper-api.alpaca.markets',
  },
  {
    id: 'alphavantage',
    name: 'Alpha Vantage',
    description: 'Free stock APIs for real-time and historical data. Generous free tier.',
    website: 'https://www.alphavantage.co',
    docs: 'https://www.alphavantage.co/documentation/',
    envKey: 'ALPHA_VANTAGE_API_KEY',
    capabilities: ['quotes', 'candles', 'fundamentals', 'forex', 'crypto'],
    endpoint: 'https://www.alphavantage.co',
  },
  {
    id: 'trading212',
    name: 'Trading 212',
    description: 'Commission-free trading platform with API access.',
    website: 'https://www.trading212.com',
    docs: 'https://t212public-api-docs.redoc.ly/',
    envKey: 'TRADING212_API_KEY',
    capabilities: ['quotes', 'candles', 'account', 'orders', 'positions'],
    endpoint: 'https://live.trading212.com',
  },
  {
    id: 'fred',
    name: 'FRED (Federal Reserve)',
    description: 'US macro economic data — GDP, CPI, Fed rate, employment, PCE. Free API key.',
    website: 'https://fred.stlouisfed.org',
    docs: 'https://fred.stlouisfed.org/docs/api/fred/',
    envKey: 'FRED_API_KEY',
    capabilities: ['fundamentals'],
    endpoint: 'https://api.stlouisfed.org/fred',
  },
  {
    id: 'ecb',
    name: 'ECB (European Central Bank)',
    description: 'Eurozone macro data — ECB rate, inflation, GDP. No API key required.',
    website: 'https://data.ecb.europa.eu',
    docs: 'https://data.ecb.europa.eu/help/',
    envKey: '', // No key needed
    capabilities: ['fundamentals'],
    endpoint: 'https://data-api.ecb.europa.eu/service',
  },
]

function AccordionRow({ platform, health, expanded, onToggle }) {
  const credOk = health?.credentialsConfigured
  const healthy = health?.status === 'healthy'
  const statusLabel = !health ? 'Unknown'
    : health.status === 'healthy' ? 'Healthy'
    : health.status === 'missing-credentials' ? 'No Credentials'
    : health.status || 'Unknown'

  return (
    <div className={`sa-row ${expanded ? 'sa-row--open' : ''}`}>
      <button
        type="button"
        className="sa-row-header"
        onClick={onToggle}
        aria-expanded={expanded}
      >
        <span className="sa-caret">{expanded ? '▾' : '▸'}</span>
        <span className="sa-name">{platform.name}</span>
        <span className="sa-id"><code>{platform.id}</code></span>
        <span className={`tp-chip tp-chip--${credOk ? 'ok' : 'warn'}`}>
          {credOk ? 'Credentials OK' : 'No Credentials'}
        </span>
        <span className={`tp-chip tp-chip--${healthy ? 'ok' : health ? 'warn' : 'neutral'}`}>
          {statusLabel}
        </span>
        <span className="sa-latency">
          {health?.latencyMs != null ? `${health.latencyMs}ms` : '—'}
        </span>
      </button>
      {expanded && (
        <div className="sa-row-body">
          <div className="sa-grid">
            {/* Configuration */}
            <div className="sa-card">
              <h4>Configuration</h4>
              <table className="tp-config-table">
                <tbody>
                  <tr><td className="label">Provider ID</td><td><code>{platform.id}</code></td></tr>
                  <tr><td className="label">Environment Key</td><td><code>{platform.envKey || '(none)'}</code></td></tr>
                  <tr><td className="label">Endpoint</td><td><code>{platform.endpoint}</code></td></tr>
                  <tr><td className="label">Documentation</td><td><a href={platform.docs} target="_blank" rel="noreferrer">{platform.docs}</a></td></tr>
                  <tr><td className="label">Website</td><td><a href={platform.website} target="_blank" rel="noreferrer">{platform.website}</a></td></tr>
                  <tr>
                    <td className="label">Capabilities</td>
                    <td>
                      <div className="tp-chips">
                        {platform.capabilities.map((c) => (
                          <span key={c} className="tp-chip tp-chip--ok">{c}</span>
                        ))}
                      </div>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            {/* Health */}
            <div className="sa-card">
              <h4>Health Status</h4>
              {health ? (
                <table className="tp-config-table">
                  <tbody>
                    <tr><td className="label">Status</td><td><span className={`tp-chip tp-chip--${health.status === 'healthy' ? 'ok' : health.status === 'missing-credentials' ? 'warn' : 'neutral'}`}>{health.status}</span></td></tr>
                    <tr><td className="label">Message</td><td>{health.message || '—'}</td></tr>
                    <tr><td className="label">Last Checked</td><td>{health.checkedAt ? new Date(health.checkedAt).toLocaleString() : 'Never'}</td></tr>
                    <tr><td className="label">Latency</td><td>{health.latencyMs != null ? `${health.latencyMs} ms` : '—'}</td></tr>
                  </tbody>
                </table>
              ) : (
                <p className="tp-hint">No health data available.</p>
              )}
            </div>

            {/* Adapter */}
            <div className="sa-card">
              <h4>Adapter Status</h4>
              <table className="tp-config-table">
                <tbody>
                  <tr><td className="label">Adapter</td><td><code>{platform.id}.adapter.ts</code></td></tr>
                  <tr><td className="label">Status</td><td><span className="tp-chip tp-chip--warn">PLACEHOLDER</span></td></tr>
                  <tr><td className="label">Task</td><td><a href="#/architecture-framework">Task 3 — Provider Adapters</a></td></tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default function SourcesPage() {
  const [expandedId, setExpandedId] = useState(null)

  const version = useQuery({
    queryKey: ['tp-version'],
    queryFn: () => apiGet('/api/version'),
  })

  const providers = useQuery({
    queryKey: ['tp-providers'],
    queryFn: () => apiGet('/api/providers/health'),
    refetchInterval: 30_000,
  })

  const v = version.data ?? {}
  const svc = v.services ?? {}
  const p = providers.data ?? {}
  const provs = Array.isArray(p.providers) ? p.providers : []
  const isLoading = version.isLoading || providers.isLoading
  const hasError = version.isError || providers.isError

  return (
    <div className="trading-platforms-page sources-accordion-page">
      <header className="tp-page-header">
        <h1>Sources</h1>
        <p>
          API providers, credentials, and endpoint configuration.
          {svc.databaseConnected ? ' Connected to database.' : ' Database offline.'}
        </p>
      </header>

      {isLoading && (
        <div style={{ marginBottom: '1rem' }}>
          <LoadingSkeleton variant="card" count={5} />
        </div>
      )}

      {hasError && (
        <section className="tp-banner tp-banner--error">
          Could not load provider health. Check backend availability.
          <button type="button" className="tp-banner-retry" onClick={() => { version.refetch(); providers.refetch() }}>Retry</button>
        </section>
      )}

      {/* Accordion list — table-row style header, then rows */}
      <div className="sa-table-header">
        <span className="sa-th-caret"></span>
        <span className="sa-th-name">Name</span>
        <span className="sa-th-id">ID</span>
        <span className="sa-th-cred">Credentials</span>
        <span className="sa-th-status">Status</span>
        <span className="sa-th-latency">Latency</span>
      </div>

      <div className="sa-list">
        {PLATFORMS.map((platform) => {
          const health = provs.find((pr) => pr.provider === platform.id)
          return (
            <AccordionRow
              key={platform.id}
              platform={platform}
              health={health}
              expanded={expandedId === platform.id}
              onToggle={() => setExpandedId(expandedId === platform.id ? null : platform.id)}
            />
          )
        })}
      </div>
    </div>
  )
}
