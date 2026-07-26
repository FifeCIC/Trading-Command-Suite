import { useQuery } from '@tanstack/react-query'
import { useState, useEffect, useCallback } from 'react'
import { apiGet } from '../core/api/client'
import './system-status.css'

const REFRESH_MS = 15_000

function StatusDot({ ok, label }) {
  return (
    <span className={`status-dot ${ok ? 'ok' : 'warn'}`} title={label}>
      <span className="dot" />
      {ok ? 'Online' : 'Offline'}
    </span>
  )
}

function StatusCard({ title, children, variant = 'neutral' }) {
  return (
    <article className={`status-card status-card--${variant}`}>
      <h3>{title}</h3>
      <div className="status-card-body">{children}</div>
    </article>
  )
}

function MetricRow({ label, value, ok }) {
  return (
    <div className="metric-row">
      <span className="metric-label">{label}</span>
      <span className="metric-value">
        {ok !== undefined && <StatusDot ok={ok} label={label} />}
        {value}
      </span>
    </div>
  )
}

export default function SystemStatusPage() {
  const version = useQuery({
    queryKey: ['status-version'],
    queryFn: () => apiGet('/api/version'),
    refetchInterval: REFRESH_MS,
  })

  const providers = useQuery({
    queryKey: ['status-providers'],
    queryFn: () => apiGet('/api/providers/health'),
    refetchInterval: REFRESH_MS,
  })

  // ── MT5 Bridge ────────────────────────────────────────
  const mt5Diag = useQuery({
    queryKey: ['status-mt5-diag'],
    queryFn: () => apiGet('/api/providers/mt5/diagnostics').catch(() => null),
    refetchInterval: REFRESH_MS,
    placeholderData: (prev) => prev,
  })
  const mt5Accounts = useQuery({
    queryKey: ['status-mt5-accounts'],
    queryFn: () => apiGet('/api/providers/mt5/accounts').catch(() => null),
    refetchInterval: 30_000,
  })

  const v = version.data ?? {}
  const svc = v.services ?? {}
  const p = providers.data ?? {}
  const provs = Array.isArray(p.providers) ? p.providers : []
  const activeProvs = provs.filter((pr) => pr.credentialsConfigured)

  const apiOk = Boolean(v.version)
  const dbOk = svc.databaseConnected === true
  const dbConfigured = svc.database === true
  const queueOk = svc.queue === true
  const redisOk = svc.redis === true
  const mode = v.mode ?? 'unknown'

  const overallOk = apiOk && (dbOk || !dbConfigured)

  // MT5 derived
  const mt5 = mt5Diag.data ?? {}
  const mt5Connected = mt5.connected === true
  const mt5Accs = mt5Accounts.data?.accounts ?? []
  const mt5ActiveAcc = mt5Accs.find(a => a.isActive) ?? mt5Accs[0]
  // Fallback to diagnostics when accounts endpoint returns empty
  const mt5AccountInfo = mt5ActiveAcc || (mt5.account ? {
    accountNumber: mt5.account,
    server: mt5.server,
    balance: mt5.balance,
    equity: mt5.equity,
    isActive: true,
  } : null)

  return (
    <div className="system-status-page">
      <header className="status-page-header">
        <div className="overall-status">
          <StatusDot ok={overallOk} label="Overall" />
          <span className="mode-badge">{mode}</span>
        </div>
      </header>

      <div className="status-grid">
        <StatusCard
          title="API"
          variant={apiOk ? 'ok' : 'warn'}
        >
          <MetricRow label="Version" value={v.version || '—'} ok={apiOk} />
          <MetricRow label="Timestamp" value={v.timestamp ? new Date(v.timestamp).toLocaleTimeString() : '—'} />
        </StatusCard>

        <StatusCard
          title="Database"
          variant={dbOk ? 'ok' : dbConfigured ? 'warn' : 'neutral'}
        >
          <MetricRow label="Configured" value={dbConfigured ? 'Yes' : 'No'} ok={dbConfigured} />
          <MetricRow label="Connected" value={dbOk ? 'Yes' : 'No'} ok={dbOk} />
          {!dbOk && dbConfigured && (
            <p className="status-hint">
              Database is configured but not reachable. Check your .env DATABASE_URL and that the database server is running.
            </p>
          )}
          {!dbConfigured && (
            <p className="status-hint">
              DATABASE_URL is not set. Create a .env file in the nest/ folder.
            </p>
          )}
        </StatusCard>

        <StatusCard
          title="Queue"
          variant={queueOk ? 'ok' : 'neutral'}
        >
          <MetricRow label="Enabled" value={queueOk ? 'Yes' : 'No'} ok={queueOk} />
          <MetricRow label="Redis" value={redisOk ? 'Connected' : 'Not configured'} ok={redisOk} />
          {!queueOk && (
            <p className="status-hint">
              Queue is disabled. Set QUEUE_MODE=local and configure REDIS_HOST in .env to enable background processing.
            </p>
          )}
        </StatusCard>

        <StatusCard
          title="Active Providers"
          variant={activeProvs.length > 0 ? 'ok' : 'warn'}
        >
          {activeProvs.length === 0 ? (
            <p className="status-hint">No providers configured with credentials.</p>
          ) : (
            <ul className="provider-list">
              {activeProvs.map((pr, i) => (
                <li key={pr.provider || i}>
                  <span>{pr.displayName}</span>
                  <span className={`ss-chip ss-chip--${pr.status === 'healthy' ? 'ok' : pr.status === 'missing-credentials' ? 'warn' : 'neutral'}`}>
                    {pr.status}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </StatusCard>

      </div>

      <footer className="status-footer">
        <span>Auto-refresh every {REFRESH_MS / 1000}s</span>
        <span>Last check: {new Date().toLocaleTimeString()}</span>
      </footer>

      {/* ── MT5 Bridge Status ────────────────────────── */}
      <section className="status-section">
        <h2>MT5 Bridge</h2>
        <div className="status-grid status-grid--mt5">
          <StatusCard title="Connection" variant={mt5Connected ? 'ok' : 'warn'}>
            <StatusDot ok={mt5Connected} label="MT5" />
            <p className="status-hint" style={{ marginTop: 8 }}>
              {mt5Connected ? 'MT5 terminal connected and streaming.' : 'MT5 terminal not connected. Open MetaTrader 5 and enable the bridge.'}
            </p>
            {mt5.bridgeName && <MetricRow label="Bridge" value={mt5.bridgeName} />}
            {mt5.lastCheck && <MetricRow label="Last Check" value={new Date(mt5.lastCheck).toLocaleTimeString()} />}
          </StatusCard>

          <StatusCard title="Diagnostics" variant={mt5Connected ? 'ok' : 'neutral'}>
            <MetricRow label="API" value={mt5.apiStatus ?? '—'} ok={mt5.apiStatus === 'online'} />
            <MetricRow label="Bridge" value={mt5.bridgeRunning ? 'Running' : 'Stopped'} ok={mt5.bridgeRunning} />
            <MetricRow label="Data" value={mt5.dataAvailable ? 'Yes' : 'No'} ok={mt5.dataAvailable} />
            {mt5.circuitBreakerTripped && (
              <p className="status-hint">⚠ Circuit breaker tripped ({mt5.circuitErrorCount} errors)</p>
            )}
          </StatusCard>

          {mt5AccountInfo && (
            <StatusCard title="Active Account" variant="ok">
              <MetricRow label="Account" value={`#${mt5AccountInfo.accountNumber ?? '—'}`} />
              <MetricRow label="Server" value={mt5AccountInfo.server ?? '—'} />
              <MetricRow label="Balance" value={mt5AccountInfo.balance != null ? `$${Number(mt5AccountInfo.balance).toLocaleString()}` : '—'} />
              <MetricRow label="Equity" value={mt5AccountInfo.equity != null ? `$${Number(mt5AccountInfo.equity).toLocaleString()}` : '—'} />
            </StatusCard>
          )}

          {mt5Accs.length > 0 && (
            <StatusCard title="All Accounts" variant="neutral">
              <ul className="provider-list">
                {mt5Accs.map((a, i) => (
                  <li key={a.accountNumber || i}>
                    <span>#{a.accountNumber}</span>
                    <span className={`ss-chip ss-chip--${a.isActive ? 'ok' : 'neutral'}`}>
                      {a.isActive ? 'Active' : 'Inactive'}
                    </span>
                    <span>{a.server}</span>
                  </li>
                ))}
              </ul>
            </StatusCard>
          )}
        </div>
      </section>

      {/* ── Server Controls — Direct Health Checks ── */}
      <ServerStatusPanel />
    </div>
  )
}

/**
 * ServerStatusPanel — direct health checks for all TCS servers.
 * No dependency on Intranet process manager.
 */
function ServerStatusPanel() {
  const [apiStatus, setApiStatus] = useState({ checking: true, online: false, version: '', mode: '' });
  const [mt5Status, setMt5Status] = useState({ checking: true, online: false });
  const [frontendStatus] = useState({ online: true, port: 5173 }); // you're looking at it
  const [copied, setCopied] = useState(false);

  const STARTUP_COMMANDS = [
    '# ── Unified Launcher (all services) ──',
    'pwsh -File C:\\wamp64\\www\\trading-command-suite\\scripts\\tcs-launch.ps1',
    '',
    '# ── Individual services (when needed) ──',
    '',
    '# NestJS API only (port 3201):',
    '$env:DATABASE_URL = "mysql://tradingcs:tradingcs_dev_2026@localhost:3306/tradingcs"',
    'npm --prefix C:\\wamp64\\www\\trading-command-suite\\nest run start',
    '',
    '# MT5 Bridge only (port 5000):',
    'cd C:\\wamp64\\www\\trading-command-suite\\scripts\\mt5-bridge',
    'python mt5_bridge_v2.py',
    '',
    '# Vite Frontend only (port 5173):',
    'npm --prefix C:\\wamp64\\www\\trading-command-suite run dev',
  ].join('\n');

  const checkApi = useCallback(async () => {
    try {
      const res = await fetch('http://localhost:3201/api/version', { signal: AbortSignal.timeout(3000) });
      const data = await res.json();
      setApiStatus({ checking: false, online: true, version: data.version ?? '', mode: data.mode ?? '' });
    } catch {
      setApiStatus({ checking: false, online: false, version: '', mode: '' });
    }
  }, []);

  const checkMt5 = useCallback(async () => {
    try {
      // Route through NestJS — the Python bridge has no CORS headers,
      // so the browser can't fetch localhost:5000 directly from localhost:5173.
      const res = await fetch('http://localhost:3201/api/providers/mt5/diagnostics', { signal: AbortSignal.timeout(3000) });
      const data = await res.json();
      const online = data.connected === true;
      setMt5Status({ checking: false, online, account: data.account, server: data.server });
      // Auto-reconnect if bridge running but MT5 disconnected
      if (!online && data.bridgeRunning) {
        try { await fetch('http://localhost:3201/api/providers/mt5/reconnect', { method: 'POST' }); } catch {}
      }
    } catch {
      setMt5Status({ checking: false, online: false });
    }
  }, []);

  useEffect(() => {
    checkApi();
    checkMt5();
    const interval = setInterval(() => { checkApi(); checkMt5(); }, 10_000);
    return () => clearInterval(interval);
  }, [checkApi, checkMt5]);

  const handleCopy = () => {
    navigator.clipboard.writeText(STARTUP_COMMANDS);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const servers = [
    {
      id: 'frontend',
      label: 'Frontend (Vite)',
      port: frontendStatus.port,
      online: frontendStatus.online,
      url: `http://localhost:${frontendStatus.port}`,
      hint: 'This page — already running',
    },
    {
      id: 'api',
      label: 'NestJS API',
      port: 3201,
      online: apiStatus.online,
      checking: apiStatus.checking,
      version: apiStatus.version,
      mode: apiStatus.mode,
      url: 'http://localhost:3201/api',
      hint: apiStatus.online ? `v${apiStatus.version} · ${apiStatus.mode}` : 'Run command #1 below',
    },
    {
      id: 'mt5',
      label: 'MT5 Bridge',
      port: 5000,
      online: mt5Status.online,
      checking: mt5Status.checking,
      url: 'http://localhost:5000',
      hint: mt5Status.online
        ? `Connected · #${mt5Status.account ?? '—'}`
        : 'Run command #2 below',
    },
  ];

  return (
    <section className="status-section">
      <div className="status-section-header">
        <h2>Server Controls</h2>
        <button className="ss-btn" onClick={handleCopy}>
          {copied ? '✓ Copied' : '📋 Copy Startup Commands'}
        </button>
      </div>

      <div className="status-grid status-grid--servers">
        {servers.map((srv) => (
          <StatusCard
            key={srv.id}
            title={srv.label}
            variant={srv.online ? 'ok' : 'warn'}
          >
            <StatusDot ok={srv.online} label={srv.label} />
            <MetricRow label="Port" value={srv.port} />
            {srv.version && <MetricRow label="Version" value={srv.version} />}
            {srv.mode && <MetricRow label="Mode" value={srv.mode} />}
            <p className="status-hint status-hint-mt-6">{srv.hint}</p>
            <div className="status-actions status-actions-row">
              <button
                className="ss-btn ss-btn--open"
                disabled={!srv.online}
                onClick={() => window.open(srv.url, '_blank')}
              >
                Open
              </button>
            </div>
          </StatusCard>
        ))}
      </div>

      {/* Startup commands (always visible for clarity) */}
      <details className="status-details-section">
        <summary style={{ cursor: 'pointer', color: '#94a3b8', fontSize: '0.8rem' }}>
          Terminal startup commands (PowerShell)
        </summary>
        <pre className="ss-commands">{STARTUP_COMMANDS}</pre>
      </details>
    </section>
  );
}
