/**
 * DataManagementPage — Data retention & cleanup dashboard.
 *
 * Shows table row counts, date ranges, and allows manual pruning
 * per table or all tables at once.
 *
 * Route: /settings/data-management
 */

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiGet } from '../core/api/client';
import { formatDateTime } from '../core/format-utils';
import LogRetentionPanel from '../components/system/LogRetentionPanel';
import './data-management.css';

export default function DataManagementPage() {
  const queryClient = useQueryClient();
  const [pruningTable, setPruningTable] = useState(null);
  const [pruneResult, setPruneResult] = useState(null);

  const statsQuery = useQuery({
    queryKey: ['data-retention-stats'],
    queryFn: () => apiGet('/api/system/data-retention/stats').catch(() => ({})),
    refetchInterval: 60_000,
    staleTime: 30_000,
  });

  const pruneMutation = useMutation({
    mutationFn: async ({ table, days }) => {
      const params = new URLSearchParams({ table });
      if (days) params.set('days', String(days));
      const res = await fetch(`/api/system/data-retention/prune?${params}`, { method: 'POST' });
      return res.json();
    },
    onSuccess: (data) => {
      setPruneResult(data);
      setPruningTable(null);
      queryClient.invalidateQueries({ queryKey: ['data-retention-stats'] });
    },
    onError: () => setPruningTable(null),
  });

  const pruneAllMutation = useMutation({
    mutationFn: () => fetch('/api/system/data-retention/prune-all', { method: 'POST' }).then(r => r.json()),
    onSuccess: (data) => {
      setPruneResult({ all: true, results: data });
      queryClient.invalidateQueries({ queryKey: ['data-retention-stats'] });
    },
  });

  const stats = statsQuery.data || {};
  const tables = Object.entries(stats);
  const totalRows = tables.reduce((s, [, v]) => s + (v.count || 0), 0);

  const daysAgo = (d) => {
    if (!d) return null;
    return Math.round((Date.now() - new Date(d).getTime()) / 86400000);
  }

  return (
    <div className="dm-page">
      <header className="dm-header">
        <h1>🗄️ Data Management</h1>
        <p className="dm-subtitle">
          {tables.length} tables tracked · {totalRows.toLocaleString()} total rows · Auto-prune daily at 3 AM
        </p>
      </header>

      {pruneResult && (
        <div className={`dm-banner ${pruneResult.all ? 'dm-banner-ok' : (pruneResult.deleted > 0 ? 'dm-banner-ok' : 'dm-banner-info')}`}>
          {pruneResult.all
            ? `Pruned all tables — ${pruneResult.results?.reduce((s, r) => s + r.deleted, 0) || 0} rows deleted.`
            : pruneResult.deleted > 0
              ? `Pruned ${pruneResult.deleted.toLocaleString()} rows from ${pruneResult.table}.`
              : `No rows to prune in ${pruneResult.table}.`}
          <button type="button" onClick={() => setPruneResult(null)}>✕</button>
        </div>
      )}

      {/* ── Summary Cards ── */}
      <div className="dm-summary-cards">
        <div className="dm-summary-card">
          <span className="dm-summary-value">{totalRows.toLocaleString()}</span>
          <span className="dm-summary-label">Total Rows</span>
        </div>
        <div className="dm-summary-card">
          <span className="dm-summary-value">{tables.length}</span>
          <span className="dm-summary-label">Tables</span>
        </div>
        <div className="dm-summary-card">
          <span className="dm-summary-value">{tables.filter(([, v]) => v.count > 0).length}</span>
          <span className="dm-summary-label">With Data</span>
        </div>
      </div>

      {/* ── Per-Table Stats ── */}
      <section className="dm-section">
        <div className="dm-section-header">
          <h2>Table Details</h2>
          <button
            type="button"
            className="dm-btn dm-btn-danger"
            onClick={() => { if (window.confirm('Prune ALL tables? This cannot be undone.')) pruneAllMutation.mutate(); }}
            disabled={pruneAllMutation.isPending}
          >
            {pruneAllMutation.isPending ? 'Pruning...' : 'Prune All'}
          </button>
        </div>

        <div className="dm-table-wrap">
          <table className="dm-table">
            <thead>
              <tr>
                <th>Table</th>
                <th>Rows</th>
                <th>Oldest</th>
                <th>Newest</th>
                <th>Retention</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {tables.map(([name, info]) => {
                const age = daysAgo(info.oldest);
                const isLarge = (info.count || 0) > 100_000;
                const isStale = age && age > (info.retentionDays || 90);
                return (
                  <tr key={name} className={isStale ? 'dm-row-stale' : ''}>
                    <td>
                      <code className="dm-table-name">{name}</code>
                      <span className="dm-table-label">{info.label}</span>
                    </td>
                    <td>
                      <span className={`dm-row-count ${isLarge ? 'dm-count-large' : ''}`}>
                        {info.sizeEstimate || info.count?.toLocaleString() || '0'}
                      </span>
                    </td>
                    <td className="dm-cell-date">
                      {formatDateTime(info.oldest)}
                      {age != null && <span className="dm-cell-age"> ({age}d ago)</span>}
                    </td>
                    <td className="dm-cell-date">{formatDateTime(info.newest)}</td>
                    <td>
                      <span className={`dm-retention-badge ${isStale ? 'dm-retention-stale' : ''}`}>
                        {info.retentionDays}d
                      </span>
                    </td>
                    <td>
                      <button
                        type="button"
                        className="dm-btn dm-btn-sm"
                        onClick={() => { setPruningTable(name); pruneMutation.mutate({ table: name }); }}
                        disabled={pruneMutation.isPending || (info.count || 0) === 0}
                      >
                        {pruningTable === name ? 'Pruning...' : 'Prune'}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {/* ── Log files ──
          Placed directly under the database tables: the two answer the same question ("what is this
          install storing, and for how long") about the two things it grows. See LogRetentionPanel
          for why the prune is a preview-then-delete, and why today's file is never a candidate. */}
      <LogRetentionPanel />

      {/* ── Info ── */}
      <section className="dm-section dm-info">
        <h3>How Retention Works</h3>
        <ul>
          <li><strong>Auto-prune:</strong> Runs daily at 3 AM, deletes rows older than the configured retention period.</li>
          <li><strong>Manual prune:</strong> Click "Prune" on any table to immediately remove rows older than its retention days.</li>
          <li><strong>Batch-safe:</strong> Deletes happen in batches of 5,000 rows with 200ms delays to avoid table locks.</li>
          <li><strong>Configurable:</strong> Retention days are set via environment variables (DATA_RETENTION_*_DAYS).</li>
        </ul>
      </section>
    </div>
  );
}
