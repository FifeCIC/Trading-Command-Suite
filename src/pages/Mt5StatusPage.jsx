/**
 * Mt5StatusPage
 * =============
 * MT5 bridge diagnostic dashboard showing connection status, live data preview,
 * and connection log.
 *
 * Route: /trading/mt5-status
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import { apiGet, apiPost } from '../core/api/client'
import LoadingSkeleton from '../components/LoadingSkeleton'
import './mt5-status.css'

const FOREX_PAIRS = ['EURUSD', 'GBPUSD', 'USDJPY', 'AUDUSD', 'USDCAD', 'NZDUSD']
const STATUS_QUERY_INTERVAL = 5_000

function formatTime(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleTimeString()
}

function timeAgo(iso) {
  if (!iso) return '—'
  const secs = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
  if (secs < 5) return 'Just now'
  if (secs < 60) return `${secs}s ago`
  return `${Math.floor(secs / 60)}m ago`
}

export default function Mt5StatusPage() {
  const [selectedSymbol, setSelectedSymbol] = useState('EURUSD')
  const [logEntries, setLogEntries] = useState([])
  const [accounts, setAccounts] = useState([])
  const [activeAccount, setActiveAccount] = useState(null)
  const [switching, setSwitching] = useState(false)
  const logEndRef = useRef(null)

  // Fetch MT5 accounts
  const accountsQuery = useQuery({
    queryKey: ['mt5-accounts'],
    queryFn: () => apiGet('/api/providers/mt5/accounts'),
    refetchInterval: 30_000,
    retry: 1,
  })

  // Fetch MT5 diagnostics
  const diagQuery = useQuery({
    queryKey: ['mt5-diag'],
    queryFn: () => apiGet('/api/providers/mt5/diagnostics'),
    refetchInterval: STATUS_QUERY_INTERVAL,
    retry: 1,
  })

  // Fetch live quote
  const quoteQuery = useQuery({
    queryKey: ['mt5-quote', selectedSymbol],
    queryFn: () => apiGet(`/api/providers/mt5/diagnostics`),
    refetchInterval: STATUS_QUERY_INTERVAL,
    enabled: diagQuery.data?.connected,
  })

  const diagnostics = diagQuery.data ?? {}
  const connected = diagnostics.connected === true

  // Connection log
  useEffect(() => {
    const now = new Date().toLocaleTimeString()
    if (connected) {
      setLogEntries((prev) => {
        const last = prev[prev.length - 1]
        if (last?.msg === 'Connected') return prev
        return [...prev.slice(-49), { time: now, msg: 'Connected', type: 'ok' }]
      })
    } else if (diagQuery.isError) {
      setLogEntries((prev) => {
        const last = prev[prev.length - 1]
        if (last?.msg === 'Connection lost') return prev
        return [...prev.slice(-49), { time: now, msg: 'Connection lost', type: 'error' }]
      })
    }
  }, [connected, diagQuery.isError])

  // Auto-scroll log
  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [logEntries])

  const handleTestConnection = useCallback(() => {
    diagQuery.refetch()
    const now = new Date().toLocaleTimeString()
    setLogEntries((prev) => [
      ...prev.slice(-49),
      { time: now, msg: 'Manual health check triggered', type: 'info' },
    ])
  }, [])

  const handleRestartBridge = useCallback(async () => {
    try {
      const now = new Date().toLocaleTimeString()
      setLogEntries((prev) => [
        ...prev.slice(-49),
        { time: now, msg: 'Restarting bridge...', type: 'warn' },
      ])
      await apiPost('/api/providers/mt5/restart-bridge', {})
      setTimeout(() => diagQuery.refetch(), 2000)
    } catch {
      // ignore
    }
  }, [])

  const handleRefreshData = useCallback(async () => {
    try {
      const now = new Date().toLocaleTimeString()
      setLogEntries((prev) => [
        ...prev.slice(-49),
        { time: now, msg: 'Refreshing MT5 data from broker...', type: 'info' },
      ])
      const res = await apiPost('/api/providers/mt5/refresh', {})
      const data = res ?? {}
      const now2 = new Date().toLocaleTimeString()
      if (data.refreshed) {
        setLogEntries((prev) => [
          ...prev.slice(-49),
          { time: now2, msg: `Refreshed ${data.refreshed}/${data.total} symbols`, type: 'ok' },
        ])
      } else {
        setLogEntries((prev) => [
          ...prev.slice(-49),
          { time: now2, msg: `Refresh failed: ${data.error || 'unknown'}`, type: 'error' },
        ])
      }
      setTimeout(() => diagQuery.refetch(), 1000)
    } catch {
      // ignore
    }
  }, [])

  const handleReconnect = useCallback(async () => {
    try {
      const now = new Date().toLocaleTimeString()
      setLogEntries((prev) => [
        ...prev.slice(-49),
        { time: now, msg: 'Reconnecting to MT5 terminal...', type: 'warn' },
      ])
      const res = await apiPost('/api/providers/mt5/reconnect', {})
      const data = res ?? {}
      const now2 = new Date().toLocaleTimeString()
      if (data.success) {
        setLogEntries((prev) => [
          ...prev.slice(-49),
          { time: now2, msg: `Reconnected — balance: $${Number(data.balance).toLocaleString()}`, type: 'ok' },
        ])
      } else {
        setLogEntries((prev) => [
          ...prev.slice(-49),
          { time: now2, msg: `Reconnect failed: ${data.error || 'unknown'}`, type: 'error' },
        ])
      }
      setTimeout(() => diagQuery.refetch(), 2000)
    } catch {
      // ignore
    }
  }, [])

  const handleSwitchAccount = useCallback(async (accountNum) => {
    setSwitching(true)
    try {
      const now = new Date().toLocaleTimeString()
      setLogEntries((prev) => [
        ...prev.slice(-49),
        { time: now, msg: `Switching to account #${accountNum}...`, type: 'warn' },
      ])
      const res = await apiPost(`/api/providers/mt5/switch/${accountNum}`, {})
      const data = res ?? {}
      const now2 = new Date().toLocaleTimeString()
      if (data.success) {
        setActiveAccount(data.activeAccount)
        setLogEntries((prev) => [
          ...prev.slice(-49),
          { time: now2, msg: `Switched to #${accountNum}: ${data.account} @ ${data.server} — $${Number(data.balance).toLocaleString()}`, type: 'ok' },
        ])
        setTimeout(() => { diagQuery.refetch(); accountsQuery.refetch() }, 1000)
      } else {
        setLogEntries((prev) => [
          ...prev.slice(-49),
          { time: now2, msg: `Switch failed: ${data.error || 'unknown'}`, type: 'error' },
        ])
      }
    } catch {
      setLogEntries((prev) => [
        ...prev.slice(-49),
        { time: new Date().toLocaleTimeString(), msg: 'Switch failed — bridge unreachable', type: 'error' },
      ])
    } finally {
      setSwitching(false)
    }
  }, [])

  // ---- Loading state ----
  if (diagQuery.isLoading) {
    return (
      <div className="mt5-page">
        <header className="mt5-header"><h1>MT5 Bridge Status</h1></header>
        <LoadingSkeleton variant="card" count={4} />
      </div>
    )
  }

  const quote = diagnostics.lastQuote
  const spread = quote?.spread ?? null

  return (
    <div className="mt5-page">
      <header className="mt5-header">
        <h1>MT5 Bridge Status</h1>
        <p>Diagnostic dashboard for MetaTrader 5 bridge connection.</p>
      </header>

      {/* Section 1: Connection Status */}
      <section className="mt5-section mt5-status-hero">
        <div className={`mt5-status-indicator ${connected ? 'mt5-connected' : diagnostics.bridgeRunning ? 'mt5-connecting' : 'mt5-disconnected'}`}>
          <span className="mt5-status-dot" />
          <span className="mt5-status-text">
            {connected ? 'Connected' : diagnostics.bridgeRunning ? 'Bridge Running — MT5 Not Connected' : 'Disconnected'}
          </span>
        </div>

        <div className="mt5-status-details">
          <div className="mt5-stat">
            <span className="mt5-stat-label">Bridge</span>
            <span className="mt5-stat-value">{diagnostics.adapterName || 'MT5'}</span>
          </div>
          <div className="mt5-stat">
            <span className="mt5-stat-label">Last Quote</span>
            <span className="mt5-stat-value">{quote ? `${quote.symbol} ${quote.bid}` : '—'}</span>
          </div>
          <div className="mt5-stat">
            <span className="mt5-stat-label">Last Updated</span>
            <span className="mt5-stat-value">{timeAgo(quote?.timestamp)}</span>
          </div>
        </div>

        {/* Account info when connected */}
        {diagnostics.account && (
          <div className="mt5-account-info">
            <div className="mt5-stat"><span className="mt5-stat-label">Account</span>
              <span className="mt5-stat-value">{diagnostics.account}</span></div>
            <div className="mt5-stat"><span className="mt5-stat-label">Server</span>
              <span className="mt5-stat-value">{diagnostics.server}</span></div>
            <div className="mt5-stat"><span className="mt5-stat-label">Balance</span>
              <span className="mt5-stat-value">{diagnostics.balance !== undefined ? `$${Number(diagnostics.balance).toLocaleString()}` : '—'}</span></div>
            <div className="mt5-stat"><span className="mt5-stat-label">Equity</span>
              <span className="mt5-stat-value">{diagnostics.equity !== undefined ? `$${Number(diagnostics.equity).toLocaleString()}` : '—'}</span></div>
          </div>
        )}

        {/* Instructions when not connected */}
        {!connected && diagnostics.instructions && (
          <div className="mt5-instructions">
            <p><strong>Diagnosis:</strong> {diagnostics.instructions}</p>
            {diagnostics.bridgeError && (
              <p><strong>Error:</strong> {diagnostics.bridgeError}</p>
            )}
            {diagnostics.circuitBreakerTripped && (
              <p className="mt5-warn"><strong>Circuit breaker tripped</strong> — {diagnostics.consecutiveErrors} consecutive errors. Click "Restart Bridge" to reset.</p>
            )}
          </div>
        )}

        <div className="mt5-status-actions">
          <button type="button" className="btn btn-primary" onClick={handleTestConnection}>
            Test Connection
          </button>
          <button type="button" className="btn btn-primary" onClick={handleRefreshData}>
            Refresh Data
          </button>
          <button type="button" className="btn" onClick={handleReconnect}>
            Reconnect MT5
          </button>
          <button type="button" className="btn" onClick={handleRestartBridge}>
            Reset Circuit Breaker
          </button>
        </div>
      </section>

      {/* Section: Account Switcher */}
      {accountsQuery.data?.accounts?.length > 0 && (
        <section className="mt5-section">
          <h2>Accounts</h2>
          <div className="mt5-accounts-grid">
            {accountsQuery.data.accounts.map((acc) => (
              <div key={acc.number} className={`mt5-account-card ${acc.active ? 'mt5-account-active' : ''}`}>
                <div className="mt5-account-header">
                  <span className="mt5-account-num">#{acc.number}</span>
                  {acc.active && <span className="mt5-account-badge">Active</span>}
                </div>
                <div className="mt5-account-login">{acc.login}</div>
                <div className="mt5-account-server">{acc.server}</div>
                {!acc.active && (
                  <button
                    type="button"
                    className="btn btn-sm"
                    onClick={() => handleSwitchAccount(acc.number)}
                    disabled={switching}
                  >
                    {switching ? 'Switching...' : 'Switch'}
                  </button>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Section 2: Live Data Preview */}
      <section className="mt5-section">
        <div className="mt5-section-header">
          <h2>Live Data Preview</h2>
          <div className="mt5-symbol-selector">
            <label htmlFor="mt5-symbol">Symbol:</label>
            <select id="mt5-symbol" value={selectedSymbol} onChange={(e) => setSelectedSymbol(e.target.value)}>
              {FOREX_PAIRS.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>
        </div>

        {!connected ? (
          <div className="mt5-no-data">
            <p>MT5 not connected. Start the bridge to see live data.</p>
          </div>
        ) : quote ? (
          <div className="mt5-live-grid">
            <div className="mt5-live-card">
              <span className="mt5-live-label">Bid</span>
              <span className="mt5-live-value">{quote.bid?.toFixed(5) ?? '—'}</span>
            </div>
            <div className="mt5-live-card">
              <span className="mt5-live-label">Ask</span>
              <span className="mt5-live-value">{quote.ask?.toFixed(5) ?? '—'}</span>
            </div>
            <div className="mt5-live-card">
              <span className="mt5-live-label">Spread</span>
              <span className="mt5-live-value">{spread !== null ? `${spread} pips` : '—'}</span>
            </div>
            <div className="mt5-live-card">
              <span className="mt5-live-label">Updated</span>
              <span className="mt5-live-value">{formatTime(quote.timestamp)}</span>
            </div>
          </div>
        ) : (
          <div className="mt5-no-data"><p>Fetching data...</p></div>
        )}
      </section>

      {/* Section 3: Connection Log */}
      <section className="mt5-section">
        <h2>Connection Log</h2>
        <div className="mt5-log">
          {logEntries.length === 0 ? (
            <p className="mt5-log-empty">No connection events yet.</p>
          ) : (
            <table className="mt5-log-table">
              <tbody>
                {logEntries.map((entry, i) => (
                  <tr key={i} className={`mt5-log-row mt5-log--${entry.type}`}>
                    <td className="mt5-log-time">{entry.time}</td>
                    <td className="mt5-log-msg">{entry.msg}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <div ref={logEndRef} />
        </div>
      </section>

      {/* Section 4: Bridge Diagnostics */}
      <section className="mt5-section">
        <h2>Bridge Diagnostics</h2>
        <div className="mt5-diag-grid">
          <div className="mt5-diag-item">
            <span className="mt5-diag-label">API Status</span>
            <span className={`mt5-diag-value ${connected ? 'mt5-ok' : 'mt5-err'}`}>
              {connected ? 'Online' : 'Offline'}
            </span>
          </div>
          <div className="mt5-diag-item">
            <span className="mt5-diag-label">Bridge Running</span>
            <span className={`mt5-diag-value ${diagnostics.bridgeRunning ? 'mt5-ok' : 'mt5-err'}`}>
              {diagnostics.bridgeRunning ? 'Yes' : 'No'}
            </span>
          </div>
          <div className="mt5-diag-item">
            <span className="mt5-diag-label">MT5 Package</span>
            <span className={`mt5-diag-value ${diagnostics.mt5PackageAvailable ? 'mt5-ok' : 'mt5-warn'}`}>
              {diagnostics.mt5PackageAvailable ? 'Installed' : diagnostics.mt5PackageAvailable === false ? 'Not Installed' : 'Unknown'}
            </span>
          </div>
          <div className="mt5-diag-item">
            <span className="mt5-diag-label">MT5 Logged In</span>
            <span className={`mt5-diag-value ${diagnostics.mt5LoggedIn ? 'mt5-ok' : 'mt5-err'}`}>
              {diagnostics.mt5LoggedIn ? 'Yes' : 'No'}
            </span>
          </div>
          <div className="mt5-diag-item">
            <span className="mt5-diag-label">Circuit Breaker</span>
            <span className={`mt5-diag-value ${diagnostics.circuitBreakerTripped ? 'mt5-err' : 'mt5-ok'}`}>
              {diagnostics.circuitBreakerTripped ? `TRIPPED (${diagnostics.consecutiveErrors} errors)` : 'OK'}
            </span>
          </div>
          <div className="mt5-diag-item">
            <span className="mt5-diag-label">Data Available</span>
            <span className="mt5-diag-value">{quote ? 'Yes' : 'No'}</span>
          </div>
          <div className="mt5-diag-item">
            <span className="mt5-diag-label">Last Check</span>
            <span className="mt5-diag-value">{formatTime(diagnostics.timestamp)}</span>
          </div>
          <div className="mt5-diag-item">
            <span className="mt5-diag-label">Refresh</span>
            <span className="mt5-diag-value">Every 5s</span>
          </div>
        </div>
      </section>
    </div>
  )
}
