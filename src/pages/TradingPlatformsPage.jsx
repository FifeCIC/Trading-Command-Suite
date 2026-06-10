import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { apiGet } from '../core/api/client'
import './trading-platforms.css'

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
]

function ConfigTable({ platform }) {
  return (
    <table className="tp-config-table">
      <tbody>
        <tr><td className="label">Provider ID</td><td><code>{platform.id}</code></td></tr>
        <tr><td className="label">Environment Key</td><td><code>{platform.envKey}</code></td></tr>
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
  )
}

export default function TradingPlatformsPage() {
  const [activePlatform, setActivePlatform] = useState('alpaca')

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

  const activeInfo = PLATFORMS.find((pl) => pl.id === activePlatform)
  const activeHealth = provs.find((pr) => pr.provider === activePlatform)

  return (
    <div className="trading-platforms-page">
      <header className="tp-page-header">
        <p>
          API providers, credentials, and endpoint configuration.
          {svc.databaseConnected ? ' Connected to database.' : ' Database offline.'}
        </p>
      </header>

      <nav className="tp-tabs">
        {PLATFORMS.map((pl) => (
          <button
            key={pl.id}
            type="button"
            className={`tp-tab ${activePlatform === pl.id ? 'active' : ''}`}
            onClick={() => setActivePlatform(pl.id)}
          >
            {pl.name}
          </button>
        ))}
      </nav>

      {isLoading && (
        <section className="tp-banner tp-banner--info">Loading provider and environment status...</section>
      )}

      {hasError && (
        <section className="tp-banner tp-banner--error">
          Could not load provider health. Check backend availability.
          <button type="button" className="tp-banner-retry" onClick={() => { version.refetch(); providers.refetch() }}>Retry</button>
        </section>
      )}

      {activeInfo && (
        <section className="tp-content">
          <div className="tp-platform-header">
            <h2>{activeInfo.name}</h2>
            <p>{activeInfo.description}</p>
            <span className={`tp-chip tp-chip--${activeHealth?.credentialsConfigured ? 'ok' : 'warn'}`}>
              {activeHealth?.credentialsConfigured ? 'Credentials Configured' : 'No Credentials'}
            </span>
          </div>

          <div className="tp-grid">
            <div className="tp-card">
              <h3>Configuration</h3>
              <ConfigTable platform={activeInfo} />
            </div>

            <div className="tp-card">
              <h3>Health Status</h3>
              {activeHealth ? (
                <table className="tp-config-table">
                  <tbody>
                    <tr><td className="label">Status</td><td><span className={`tp-chip tp-chip--${activeHealth.status === 'healthy' ? 'ok' : activeHealth.status === 'missing-credentials' ? 'warn' : 'neutral'}`}>{activeHealth.status}</span></td></tr>
                    <tr><td className="label">Message</td><td>{activeHealth.message || '—'}</td></tr>
                    <tr><td className="label">Last Checked</td><td>{activeHealth.checkedAt ? new Date(activeHealth.checkedAt).toLocaleString() : 'Never'}</td></tr>
                    <tr><td className="label">Latency</td><td>{activeHealth.latencyMs != null ? `${activeHealth.latencyMs} ms` : '—'}</td></tr>
                  </tbody>
                </table>
              ) : (
                <p className="tp-hint">No health data available. Run a provider health check.</p>
              )}
            </div>

            <div className="tp-card">
              <h3>Adapter Status</h3>
              <table className="tp-config-table">
                <tbody>
                  <tr><td className="label">Adapter</td><td><code>{activeInfo.id}.adapter.ts</code></td></tr>
                  <tr><td className="label">Status</td><td><span className="tp-chip tp-chip--warn">PLACEHOLDER</span></td></tr>
                  <tr><td className="label">Task</td><td><a href="#/architecture-framework" onClick={() => {}}>Task 3 — Provider Adapters</a></td></tr>
                </tbody>
              </table>
            </div>
          </div>
        </section>
      )}
    </div>
  )
}
