/**
 * Cache Monitor Page
 * ===================
 * Shows in-memory cache stats, hit rate, entries, and controls to clear/prune.
 * Replaces the old "Transient Caches" WordPress concept.
 */

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiPost } from '../core/api/client';

export default function CacheMonitorPage() {
  const qc = useQueryClient();
  const [filterKey, setFilterKey] = useState('');

  const statsQuery = useQuery({
    queryKey: ['cache-stats'],
    queryFn: () => apiGet('/api/cache/stats'),
    refetchInterval: 10_000,
  });

  const clearMutation = useMutation({
    mutationFn: () => apiPost('/api/cache/clear'),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['cache-stats'] }),
  });

  const pruneMutation = useMutation({
    mutationFn: () => apiPost('/api/cache/prune'),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['cache-stats'] }),
  });

  const stats = statsQuery.data;
  const entries = stats?.entries || [];
  const filtered = filterKey
    ? entries.filter((e) => e.key.toLowerCase().includes(filterKey.toLowerCase()))
    : entries;

  return (
    <div className="cm-page">
      <h1>Cache Monitor</h1>
      <p className="cm-subtitle">
        In-memory server cache for provider API responses. Reduces external calls and rate limit pressure.
        Client-side caching (TanStack Query) is separate.
      </p>

      <div className="cm-summary">
        <div className="cm-stat"><strong>{stats?.totalEntries ?? '—'}</strong><span>Entries</span></div>
        <div className="cm-stat"><strong>{stats?.totalHits ?? '—'}</strong><span>Hits</span></div>
        <div className="cm-stat"><strong>{stats?.totalMisses ?? '—'}</strong><span>Misses</span></div>
        <div className="cm-stat"><strong>{stats?.hitRate ?? '—'}%</strong><span>Hit Rate</span></div>
      </div>

      <div className="cm-actions">
        <input
          placeholder="Filter by key..."
          value={filterKey}
          onChange={(e) => setFilterKey(e.target.value)}
          className="cm-filter"
        />
        <button className="cm-btn cm-btn-prune" onClick={() => pruneMutation.mutate()} disabled={pruneMutation.isPending}>
          Prune Expired
        </button>
        <button className="cm-btn cm-btn-clear" onClick={() => clearMutation.mutate()} disabled={clearMutation.isPending}>
          Clear All
        </button>
      </div>

      {statsQuery.isLoading && <p className="cm-loading">Loading cache stats...</p>}

      {!statsQuery.isLoading && filtered.length === 0 && (
        <p className="cm-empty">
          {statsQuery.isError ? 'Could not reach cache API.' : 'No cache entries.'}
        </p>
      )}

      {filtered.length > 0 && (
        <div className="cm-table-wrap">
          <table className="cm-table">
            <thead>
              <tr>
                <th>Key</th>
                <th>Type</th>
                <th>Age</th>
                <th>TTL</th>
                <th>Hits</th>
                <th>Size</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((entry) => (
                <tr key={entry.key}>
                  <td className="cm-key-cell" title={entry.key}>{entry.key}</td>
                  <td><span className="cm-type-badge">{entry.valueType}</span></td>
                  <td>{entry.age}s</td>
                  <td className={entry.ttl < 10 ? 'cm-ttl-warn' : ''}>{entry.ttl}s</td>
                  <td>{entry.hits}</td>
                  <td>{entry.size >= 1024 ? `${(entry.size / 1024).toFixed(1)}KB` : `${entry.size}B`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
