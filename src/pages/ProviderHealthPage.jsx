/**
 * ProviderHealthPage — Standalone provider health monitoring dashboard.
 * Consumes GET /api/providers/health with TanStack Query (30s refresh).
 * Route: /data/provider-health
 */
import { useMemo } from 'react';
import { motion } from 'motion/react';
import { useQuery } from '@tanstack/react-query';
import { apiGet } from '../core/api/client';
import LoadingSkeleton from '../components/LoadingSkeleton';
import ApiOfflineBanner from '../components/ApiOfflineBanner';
import './provider-health.css';

const STATUS_CONFIG = {
  healthy:           { label: 'Healthy',           color: '#22c55e', bg: '#22c55e18', icon: '✅' },
  degraded:          { label: 'Degraded',          color: '#f59e0b', bg: '#f59e0b18', icon: '⚠️' },
  failed:            { label: 'Failed',            color: '#ef4444', bg: '#ef444418', icon: '❌' },
  'missing-credentials': { label: 'No Credentials', color: '#94a3b8', bg: '#94a3b818', icon: '🔒' },
  unknown:           { label: 'Unknown',           color: '#64748b', bg: '#64748b18', icon: '❓' },
};

function formatTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  const now = Date.now();
  const diff = now - d.getTime();
  if (diff < 60_000) return 'Just now';
  if (diff < 3600_000) return `${Math.round(diff / 60_000)}m ago`;
  if (diff < 86400_000) return `${Math.round(diff / 3600_000)}h ago`;
  return d.toLocaleDateString();
}

function ProviderCard({ provider, isActive }) {
  const cfg = STATUS_CONFIG[provider.status] || STATUS_CONFIG.unknown;
  const credOk = provider.credentialsConfigured;

  return (
    <motion.div
      className={`ph-card ${isActive ? 'ph-card--active' : ''}`}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
    >
      <div className="ph-card-head">
        <div className="ph-card-name-row">
          <span className="ph-card-icon">{cfg.icon}</span>
          <h3 className="ph-card-name">{provider.displayName}</h3>
          {isActive && <span className="ph-active-badge">ACTIVE</span>}
        </div>
        <span className="ph-status-badge" style={{ color: cfg.color, background: cfg.bg }}>
          {cfg.label}
        </span>
      </div>

      <div className="ph-card-body">
        <div className="ph-card-row">
          <span className="ph-card-key">Adapter</span>
          <span className="ph-card-val">{provider.adapterType}</span>
        </div>
        <div className="ph-card-row">
          <span className="ph-card-key">Endpoint</span>
          <span className="ph-card-val ph-endpoint">{provider.endpoint || '—'}</span>
        </div>
        <div className="ph-card-row">
          <span className="ph-card-key">Provider ID</span>
          <span className="ph-card-val ph-mono">{provider.provider}</span>
        </div>
        <div className="ph-card-row">
          <span className="ph-card-key">Credentials</span>
          <span className={`ph-card-val ${credOk ? 'ph-cred-ok' : 'ph-cred-missing'}`}>
            {credOk ? '✓ Configured' : '✗ Missing'}
          </span>
        </div>
        <div className="ph-card-row">
          <span className="ph-card-key">Last Check</span>
          <span className="ph-card-val">{formatTime(provider.checkedAt)}</span>
        </div>
        {provider.latencyMs != null && (
          <div className="ph-card-row">
            <span className="ph-card-key">Latency</span>
            <span className="ph-card-val">{provider.latencyMs}ms</span>
          </div>
        )}
      </div>

      {provider.message && (
        <div className="ph-card-msg">{provider.message}</div>
      )}
    </motion.div>
  );
}

export default function ProviderHealthPage() {
  const { data, isLoading, isError, isFetching, refetch } = useQuery({
    queryKey: ['provider-health-page'],
    queryFn: () => apiGet('/api/providers/health'),
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
  });

  const providers = useMemo(() => {
    if (Array.isArray(data?.providers)) return data.providers;
    if (Array.isArray(data)) return data;
    return [];
  }, [data]);

  const mode = data?.mode ?? '...';
  const services = data?.services ?? {};
  const activeProvider = data?.activeProvider ?? null;

  const statusCounts = useMemo(() => {
    const counts = { total: providers.length };
    for (const p of providers) {
      const s = p.status || 'unknown';
      counts[s] = (counts[s] || 0) + 1;
    }
    return counts;
  }, [providers]);

  if (isLoading) return (
    <div className="ph-page">
      <header className="ph-header"><h1>Provider Health</h1></header>
      <LoadingSkeleton variant="card" count={7} />
    </div>
  );

  return (
    <div className="ph-page">
      <header className="ph-header">
        <div>
          <h1>Provider Health</h1>
          <p className="ph-subtitle">
            Real-time status of all configured data providers.
            Mode: <strong>{mode}</strong>
            {activeProvider && <> · Active: <strong>{activeProvider}</strong></>}
          </p>
        </div>
        <button className="ph-refresh-btn" onClick={() => refetch()} disabled={isFetching}>
          {isFetching ? '⟳ Refreshing…' : '↻ Refresh'}
        </button>
      </header>

      {isError && <ApiOfflineBanner />}

      {/* Status summary chips */}
      <div className="ph-summary-row">
        {Object.entries(STATUS_CONFIG).map(([key, cfg]) => {
          const count = statusCounts[key] || 0;
          if (count === 0) return null;
          return (
            <span key={key} className="ph-summary-chip" style={{ color: cfg.color, background: cfg.bg }}>
              {cfg.icon} {cfg.label}: {count}
            </span>
          );
        })}
        <span className="ph-summary-chip ph-summary-total">
          Total: {providers.length}
        </span>
      </div>

      {/* Services row */}
      <div className="ph-services-row">
        {Object.entries(services).map(([name, ok]) => (
          <span key={name} className={`ph-service-chip ${ok ? 'ph-svc-up' : 'ph-svc-down'}`}>
            {name}: {ok ? 'UP' : 'DOWN'}
          </span>
        ))}
      </div>

      {/* Provider cards grid */}
      {providers.length === 0 ? (
        <div className="ph-empty">
          <p>No provider health data available.</p>
          <p className="ph-empty-hint">Start the NestJS backend and ensure provider checks have run.</p>
        </div>
      ) : (
        <div className="ph-grid">
          {providers.map((p) => (
            <ProviderCard
              key={p.provider}
              provider={p}
              isActive={p.provider === activeProvider || p.displayName === activeProvider}
            />
          ))}
        </div>
      )}
    </div>
  );
}
