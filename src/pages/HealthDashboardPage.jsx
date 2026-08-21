import { useMemo } from 'react';
import { motion } from 'motion/react';
import { useQuery } from '@tanstack/react-query';
import { apiGet } from '../core/api/client';
import LoadingSkeleton from '../components/LoadingSkeleton';
import ApiOfflineBanner from '../components/ApiOfflineBanner';
import './health-dashboard.css';
import PageInfoPopover from '../components/PageInfoPopover';

// ── Helpers ──────────────────────────────────────────────

import { timeAgo, formatMs, formatMb, formatCount } from '../core/format-utils';
const STATUS_EMOJI = { ok: '✅', warn: '⚠️', critical: '🔴' };
const PROVIDER_STATUS = { healthy: '🟢', degraded: '🟡', unhealthy: '🔴', unknown: '⚪' };
const METHOD_COLOR = { GET: '#22c55e', POST: '#3b82f6', PUT: '#f59e0b', DELETE: '#ef4444' };

// ── Section Components ───────────────────────────────────

function VitalsCard({ vitals }) {
  if (!vitals) return null;
  const memColor = vitals.memUsagePct > 85 ? 'var(--color-loss)' : vitals.memUsagePct > 65 ? 'var(--color-warning)' : 'var(--color-profit)';
  const cpuColor = vitals.cpuLoad1m > vitals.cpuCores * 0.8 ? 'var(--color-loss)' : 'var(--color-profit)';
  return (
    <div className="hd-vitals-grid">
      <div className="hd-card">
        <div className="hd-card-label">CPU Load</div>
        <div className="hd-card-value" style={{ color: cpuColor }}>{vitals.cpuLoad1m} / {vitals.cpuCores} cores</div>
        <div className="hd-card-sub">{vitals.cpuModel}</div>
      </div>
      <div className="hd-card">
        <div className="hd-card-label">Memory</div>
        <div className="hd-card-value" style={{ color: memColor }}>{vitals.memUsagePct}%</div>
        <div className="hd-card-sub">{vitals.memUsedGb} / {vitals.memTotalGb} GB</div>
      </div>
      <div className="hd-card">
        <div className="hd-card-label">Uptime</div>
        <div className="hd-card-value">{vitals.uptimeHours}h</div>
        <div className="hd-card-sub">Node {vitals.nodeVersion}</div>
      </div>
      <div className="hd-card">
        <div className="hd-card-label">Heap</div>
        <div className="hd-card-value">{vitals.heapUsedMb} MB</div>
        <div className="hd-card-sub">of {vitals.heapTotalMb} MB</div>
      </div>
      <div className="hd-card">
        <div className="hd-card-label">Platform</div>
        <div className="hd-card-value il-fs-075">{vitals.platform}</div>
        <div className="hd-card-sub">PID {vitals.pid}</div>
      </div>
    </div>
  );
}

function DbTableRow({ t }) {
  const statusIcon = STATUS_EMOJI[t.status] || '';
  return (
    <tr className={`hd-tr-${t.status}`}>
      <td className="hd-td-name">{statusIcon} {t.tableName}</td>
      <td className="hd-td-num">{formatCount(t.rowCount)}</td>
      <td className="hd-td-num">{formatMb(t.dataSizeMb)}</td>
      <td className="hd-td-num">{t.retentionDays ? `${t.retentionDays}d` : '—'}</td>
      <td className="hd-td-hint" title={t.hint}>{t.hint || '—'}</td>
    </tr>
  );
}

function ProviderChip({ p }) {
  const icon = PROVIDER_STATUS[p.status] || '⚪';
  return (
    <div className={`hd-provider-chip hd-provider-${p.status}`}>
      <span className="hd-provider-icon">{icon}</span>
      <span className="hd-provider-name">{p.provider}</span>
      <span className="hd-provider-latency">{p.latencyMs ? `${p.latencyMs}ms` : '—'}</span>
      {!p.credentialsOk && <span className="hd-provider-cred" title="Credentials invalid">🔑</span>}
      <span className="hd-provider-age">{timeAgo(p.checkedAt)}</span>
    </div>
  );
}

function TrendBar({ point, maxAvg }) {
  const pct = maxAvg > 0 ? (point.avgMs / maxAvg) * 100 : 0;
  const color = point.avgMs > 2000 ? 'var(--color-loss)' : point.avgMs > 500 ? 'var(--color-warning)' : 'var(--color-profit)';
  return (
    <div className="hd-trend-row">
      <span className="hd-trend-hour">{point.hour?.slice(11) || point.hour}</span>
      <div className="hd-trend-bar-wrap">
        <span className="hd-trend-bar" style={{ width: `${Math.min(pct, 100)}%`, background: color }} />
      </div>
      <span className="hd-trend-val" style={{ color }}>{point.avgMs}ms</span>
      <span className="hd-trend-count">{point.count}</span>
    </div>
  );
}

// ── Main Page ────────────────────────────────────────────

export default function HealthDashboardPage() {
  const dashQuery = useQuery({
    queryKey: ['health-dashboard'],
    queryFn: () => apiGet('/api/system/health-dashboard'),
    refetchInterval: 15000,
  });

  const data = dashQuery.data;
  const apiOnline = !dashQuery.isError;

  const maxAvgMs = useMemo(() => {
    if (!data?.apiTrends?.length) return 1;
    return Math.max(...data.apiTrends.map(p => p.avgMs), 1);
  }, [data?.apiTrends]);

  if (dashQuery.isLoading) return <div className="hd-page"><LoadingSkeleton variant="card" count={4} /></div>;

  return (
    <div className="hd-page">
      <motion.header className="hd-header" initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }}>
        <h1>Health & Diagnostics
          <PageInfoPopover>
            System vitals, DB health, slow queries, API trends, provider status, and trace correlation — refreshed every 15s.
          </PageInfoPopover>
        </h1>
      </motion.header>

      {!apiOnline && <ApiOfflineBanner />}

      {/* ── 1. System Vitals ── */}
      <motion.section className="hd-section" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.04 }}>
        <h2 className="hd-section-title">💻 System Vitals</h2>
        <VitalsCard vitals={data?.vitals} />
      </motion.section>

      {/* ── 2. Provider Health Grid ── */}
      <motion.section className="hd-section" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.08 }}>
        <h2 className="hd-section-title">📡 Provider Health</h2>
        <div className="hd-provider-grid">
          {(data?.providerGrid || []).map(p => <ProviderChip key={p.provider} p={p} />)}
          {(!data?.providerGrid || data.providerGrid.length === 0) && <span className="hd-empty">No provider data</span>}
        </div>
      </motion.section>

      {/* ── 3. API Trends ── */}
      <motion.section className="hd-section" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.12 }}>
        <h2 className="hd-section-title">📊 API Response Times (24h)</h2>
        <div className="hd-trend-chart">
          {(data?.apiTrends || []).slice(0, 24).map(p => <TrendBar key={p.hour} point={p} maxAvg={maxAvgMs} />)}
          {(!data?.apiTrends || data.apiTrends.length === 0) && <span className="hd-empty">No API trend data</span>}
        </div>
      </motion.section>

      {/* ── 4. DB Table Sizes ── */}
      <motion.section className="hd-section" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.16 }}>
        <h2 className="hd-section-title">🗄️ Database Tables vs Retention</h2>
        <div className="hd-table-wrap">
          <table className="hd-table">
            <thead>
              <tr>
                <th>Table</th>
                <th>Rows</th>
                <th>Size</th>
                <th>Retention</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {(data?.dbDiagnostics || []).map(t => <DbTableRow key={t.tableName} t={t} />)}
            </tbody>
          </table>
          {(!data?.dbDiagnostics || data.dbDiagnostics.length === 0) && <span className="hd-empty">No DB data</span>}
        </div>
      </motion.section>

      {/* ── 5. Slow Queries ── */}
      <motion.section className="hd-section" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.20 }}>
        <h2 className="hd-section-title">🐢 Slow Queries (&gt;1s)</h2>
        <div className="hd-table-wrap">
          <table className="hd-table hd-table-sm">
            <thead>
              <tr>
                <th>Endpoint</th>
                <th>Method</th>
                <th>Duration</th>
                <th>Status</th>
                <th>When</th>
              </tr>
            </thead>
            <tbody>
              {(data?.slowQueries || []).map(q => (
                <tr key={q.id}>
                  <td className="hd-td-name" title={q.endpoint}>{q.endpoint?.slice(-60)}</td>
                  <td><span className="hd-method-badge" style={{ color: METHOD_COLOR[q.method] || '#94a3b8' }}>{q.method}</span></td>
                  <td className="hd-td-num" style={{ color: q.durationMs > 3000 ? 'var(--color-loss)' : 'var(--color-warning)' }}>{formatMs(q.durationMs)}</td>
                  <td className="hd-td-num">{q.statusCode}</td>
                  <td className="hd-td-age">{timeAgo(q.timestamp)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {(!data?.slowQueries || data.slowQueries.length === 0) && <div className="hd-empty-ok">✅ No slow queries detected</div>}
        </div>
      </motion.section>

      {/* ── 6. Trace Correlations ── */}
      <motion.section className="hd-section" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.24 }}>
        <h2 className="hd-section-title">🔗 Trace Correlations (recent API traces)</h2>
        <div className="hd-table-wrap">
          <table className="hd-table hd-table-sm">
            <thead>
              <tr>
                <th>Cache Key</th>
                <th>URL</th>
                <th>Method</th>
                <th>Duration</th>
                <th>Cached</th>
                <th>When</th>
              </tr>
            </thead>
            <tbody>
              {(data?.traceCorrelations || []).map(t => (
                <tr key={t.cacheKey + t.createdAt}>
                  <td className="hd-td-mono" title={t.cacheKey}>{t.cacheKey?.slice(0, 12)}…</td>
                  <td className="hd-td-name" title={t.url}>{t.url?.slice(-50)}</td>
                  <td><span className="hd-method-badge" style={{ color: METHOD_COLOR[t.method] || '#94a3b8' }}>{t.method}</span></td>
                  <td className="hd-td-num">{formatMs(t.durationMs)}</td>
                  <td>{t.cached ? '♻️' : '🆕'}</td>
                  <td className="hd-td-age">{timeAgo(t.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {(!data?.traceCorrelations || data.traceCorrelations.length === 0) && <span className="hd-empty">No trace data</span>}
        </div>
      </motion.section>

      <motion.footer className="hd-footer" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.3 }}>
        Data fetched at {data?.fetchedAt ? new Date(data.fetchedAt).toLocaleTimeString() : '—'} · Auto-refresh 15s
      </motion.footer>
    </div>
  );
}
