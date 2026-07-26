import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiGet } from '../core/api/client';
import './trading-platforms.css';

const PROVIDER_ALL = 'ALL';

// Known trading platform providers — always show in filter
const KNOWN_PROVIDERS = ['alpaca', 'alphavantage', 'trading212', 'fred', 'ecb', 'mt5'];

function formatTime(value) {
  if (!value) return '-';
  return new Date(value).toLocaleTimeString();
}

function formatSize(bytes) {
  if (!Number.isFinite(bytes)) return '-';
  return bytes >= 1024 ? `${(bytes / 1024).toFixed(1)}KB` : `${bytes}B`;
}

export default function ApiActivityPage() {
  const [provider, setProvider] = useState(PROVIDER_ALL);
  const providerParam = provider === PROVIDER_ALL ? '' : `?provider=${encodeURIComponent(provider)}`;

  const activityQuery = useQuery({
    queryKey: ['api-activity', provider],
    queryFn: () => apiGet(`/api/api-activity${providerParam}`),
    refetchInterval: 5_000,
  });

  const summaryQuery = useQuery({
    queryKey: ['api-activity-summary', provider],
    queryFn: () => apiGet(`/api/api-activity/summary${providerParam}`),
    refetchInterval: 5_000,
  });

  const records = Array.isArray(activityQuery.data?.records) ? activityQuery.data.records : [];
  const summary = summaryQuery.data || {};
  const providers = Array.isArray(summary.providers) ? summary.providers : [];
  // Merge known trading platforms into filter list
  const allProviders = useMemo(() => {
    const merged = new Set([...KNOWN_PROVIDERS, ...providers]);
    return [...merged].sort();
  }, [providers]);
  const latencyBuckets = Array.isArray(summary.latencyBuckets) ? summary.latencyBuckets : [];
  const maxLatency = Math.max(...latencyBuckets.map((bucket) => bucket.avgLatencyMs), 1);

  const statusRows = useMemo(() => {
    const groups = new Map();
    for (const record of records) {
      const key = record.statusCode >= 400 ? 'Errors' : 'Success';
      groups.set(key, (groups.get(key) || 0) + 1);
    }
    return Array.from(groups.entries());
  }, [records]);

  return (
    <div className="trading-platforms-page api-activity-page">
      <header className="tp-page-header">
        <h1>API Activity</h1>
        <p>Live request feed, provider filters, error counts, and one-hour latency trends.</p>
        <p className="tp-source-meta">
          Source: {summary.source || activityQuery.data?.source || 'pending'} · Refreshes every 5 seconds
        </p>
      </header>

      <section className="tp-card tp-controls-card">
        <h3>Filters</h3>
        <div className="tp-controls-grid il-items-end">
          <label className="tp-control">
            <span>Provider</span>
            <select value={provider} onChange={(event) => setProvider(event.target.value)}>
              <option value={PROVIDER_ALL}>All providers</option>
              {allProviders.map((item) => (
                <option key={item} value={item}>{item}</option>
              ))}
            </select>
          </label>
        </div>
      </section>

      <section className="tp-card">
        <h3>Status Summary</h3>
        <div className="tp-controls-grid">
          <div><span className="k">Recent requests</span> <span className="v">{summary.recentCount ?? 0}</span></div>
          <div><span className="k">Success</span> <span className="tp-chip tp-chip--ok">{summary.successCount ?? 0}</span></div>
          <div><span className="k">Errors</span> <span className={`tp-chip ${(summary.errorCount ?? 0) > 0 ? 'tp-chip--warn' : 'tp-chip--ok'}`}>{summary.errorCount ?? 0}</span></div>
          <div><span className="k">Avg latency</span> <span className="v">{summary.avgLatencyMs ?? 0}ms</span></div>
        </div>
        {statusRows.length > 0 && (
          <div className="tp-provider-pills il-mt-075">
            {statusRows.map(([label, count]) => (
              <span key={label} className="tp-provider-pill">{label}: {count}</span>
            ))}
          </div>
        )}
      </section>

      <section className="tp-card">
        <h3>Latency - Last Hour</h3>
        <div className="api-latency-chart" aria-label="Average latency by five minute bucket">
          {latencyBuckets.map((bucket) => (
            <div key={bucket.label} className="api-latency-bar">
              <span
                className="api-latency-fill"
                style={{ height: `${Math.max((bucket.avgLatencyMs / maxLatency) * 100, bucket.count ? 8 : 0)}%` }}
                title={`${bucket.label}: ${bucket.avgLatencyMs}ms avg, ${bucket.count} requests`}
              />
              <span className="api-latency-label">{bucket.label}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="tp-card tp-comparison-card">
        <h3>Live Feed</h3>
        {activityQuery.isLoading && <p className="tp-cell-note">Loading activity...</p>}
        {!activityQuery.isLoading && records.length === 0 && (
          <p className="tp-cell-note">
            {activityQuery.isError ? 'Could not reach API activity endpoint.' : 'No API activity has been recorded yet.'}
          </p>
        )}
        {records.length > 0 && (
          <div className="tp-comparison-wrap">
            <table className="tp-comparison-table">
              <thead>
                <tr>
                  <th className="il-w-110">Time</th>
                  <th className="il-w-80">Method</th>
                  <th>Endpoint</th>
                  <th className="il-w-120">Provider</th>
                  <th className="il-w-80">Status</th>
                  <th className="il-w-90">Latency</th>
                  <th className="il-w-90">Size</th>
                </tr>
              </thead>
              <tbody>
                {records.map((record) => (
                  <tr key={record.id || `${record.timestamp}-${record.method}-${record.endpoint}`}>
                    <td>{formatTime(record.timestamp)}</td>
                    <td><span className="tp-chip tp-chip--neutral">{record.method}</span></td>
                    <td><code>{record.endpoint}</code></td>
                    <td>{record.provider || '-'}</td>
                    <td>
                      <span className={`tp-chip ${record.statusCode >= 400 ? 'tp-chip--warn' : 'tp-chip--ok'}`}>
                        {record.statusCode}
                      </span>
                    </td>
                    <td>{record.durationMs}ms</td>
                    <td>{formatSize(record.responseSize)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
