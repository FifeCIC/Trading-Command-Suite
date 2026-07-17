/**
 * AI Log Viewer Page
 * ==================
 * Browse and filter AI request/response logs, view full prompt/response
 * pairs, and track cost summaries by provider and feature.
 *
 * Endpoints (pending backend):
 *   GET  /api/ai/logs?provider=&feature=&from=&to=&limit=
 *   GET  /api/ai/logs/:id  (full prompt/response)
 */
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { motion } from 'motion/react';
import { apiGet } from '../core/api/client';
import LoadingSkeleton from '../components/LoadingSkeleton';
import Notice from '../components/Notice';
import './ai-log-viewer.css';

const PROVIDERS = [
  { id: 'deepseek', label: 'DeepSeek', color: '#3b82f6' },
  { id: 'gemini', label: 'Gemini (free)', color: '#22c55e' },
];

const FEATURES = [
  { id: 'briefing', label: 'Daily Briefing' },
  { id: 'analysis', label: 'Signal Analysis' },
  { id: 'explain', label: 'Trade Explanations' },
  { id: 'sentiment', label: 'News Sentiment' },
  { id: 'journal', label: 'Journal Analysis' },
];

function timeAgo(iso) {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  const s = Math.floor(diff / 1000);
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return m + 'm ago';
  const h = Math.floor(m / 60);
  if (h < 24) return h + 'h ago';
  return Math.floor(h / 24) + 'd ago';
}

export default function AILogViewerPage() {
  const [providerFilter, setProviderFilter] = useState('');
  const [featureFilter, setFeatureFilter] = useState('');
  const [selectedLog, setSelectedLog] = useState(null);
  const [expandedPrompt, setExpandedPrompt] = useState(null);

  // ── Fetch logs ──
  const logsQuery = useQuery({
    queryKey: ['ai-logs', providerFilter, featureFilter],
    queryFn: () => {
      let url = '/api/ai/logs?limit=50';
      if (providerFilter) url += `&provider=${providerFilter}`;
      if (featureFilter) url += `&feature=${featureFilter}`;
      return apiGet(url).catch(() => ({ logs: [], summary: {} }));
    },
    refetchInterval: 30_000,
  });
  const logs = logsQuery.data?.logs || [];
  const summary = logsQuery.data?.summary || {};

  // ── Fetch full log detail ──
  const detailQuery = useQuery({
    queryKey: ['ai-log-detail', selectedLog],
    queryFn: () => apiGet(`/api/ai/logs/${selectedLog}`).catch(() => null),
    enabled: !!selectedLog,
  });
  const detail = detailQuery.data;

  const isLoading = logsQuery.isLoading;

  if (isLoading) {
    return (
      <div className="al-page">
        <header className="al-header"><h1>AI Log Viewer</h1></header>
        <LoadingSkeleton variant="card" count={3} />
      </div>
    );
  }

  return (
    <div className="al-page">
      <header className="al-header">
        <div>
          <h1>📋 AI Log Viewer</h1>
          <p className="al-subtitle">Browse AI request/response logs, filter by provider and feature</p>
        </div>
      </header>

      {/* Backend notice */}
      {!logsQuery.data && (
        <Notice level="info">AI logging backend not yet deployed — showing empty state. Logs will appear when /api/ai/logs is live.</Notice>
      )}

      {/* Cost summary */}
      <div className="al-summary-grid">
        <div className="al-summary-card">
          <span className="al-summary-label">Total Requests</span>
          <span className="al-summary-value">{summary.totalRequests || 0}</span>
        </div>
        <div className="al-summary-card">
          <span className="al-summary-label">Total Tokens</span>
          <span className="al-summary-value">{(summary.totalTokens || 0).toLocaleString()}</span>
        </div>
        <div className="al-summary-card">
          <span className="al-summary-label">Total Cost</span>
          <span className="al-summary-value">${(summary.totalCost || 0).toFixed(4)}</span>
        </div>
        <div className="al-summary-card">
          <span className="al-summary-label">Avg Latency</span>
          <span className="al-summary-value">{summary.avgLatencyMs ? `${summary.avgLatencyMs}ms` : '—'}</span>
        </div>
      </div>

      {/* Filters */}
      <div className="al-filters">
        <div className="al-filter-group">
          <label>Provider</label>
          <select value={providerFilter} onChange={e => setProviderFilter(e.target.value)} className="al-select">
            <option value="">All Providers</option>
            {PROVIDERS.map(p => (
              <option key={p.id} value={p.id}>{p.label}</option>
            ))}
          </select>
        </div>
        <div className="al-filter-group">
          <label>Feature</label>
          <select value={featureFilter} onChange={e => setFeatureFilter(e.target.value)} className="al-select">
            <option value="">All Features</option>
            {FEATURES.map(f => (
              <option key={f.id} value={f.id}>{f.label}</option>
            ))}
          </select>
        </div>
        <button className="al-refresh-btn" onClick={() => logsQuery.refetch()} title="Refresh logs">
          ⟳ Refresh
        </button>
      </div>

      {/* Log list */}
      <div className="al-list">
        {logs.length === 0 ? (
          <div className="al-empty">
            <p>No AI request logs found.</p>
            <p className="al-empty-hint">Requests will appear here once the AI Provider Service is in use and logging is enabled.</p>
          </div>
        ) : (
          logs.map((log, i) => {
            const provider = PROVIDERS.find(p => p.id === log.provider);
            const isExpanded = expandedPrompt === log.id;
            return (
              <motion.div
                key={log.id || i}
                className={`al-log-card ${isExpanded ? 'expanded' : ''}`}
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.02 }}
              >
                <div className="al-log-row" onClick={() => setExpandedPrompt(isExpanded ? null : log.id)}>
                  <span className="al-log-provider" style={{ background: provider?.color || '#64748b' }}>
                    {provider?.label || log.provider || 'Unknown'}
                  </span>
                  <span className="al-log-feature">{log.feature || '—'}</span>
                  <span className="al-log-model">{log.model || '—'}</span>
                  <span className="al-log-tokens">{(log.promptTokens || 0) + (log.completionTokens || 0)} tokens</span>
                  <span className="al-log-cost">${(log.estimatedCost || 0).toFixed(4)}</span>
                  <span className={`al-log-status ${log.status === 'error' ? 'al-status-error' : 'al-status-ok'}`}>
                    {log.status === 'error' ? '❌' : '✓'}
                  </span>
                  <span className="al-log-time">{timeAgo(log.timestamp)}</span>
                  <span className="al-log-chevron">{isExpanded ? '▾' : '▸'}</span>
                </div>

                {isExpanded && log.prompt && (
                  <div className="al-log-detail">
                    <div className="al-log-section">
                      <h4>📤 Prompt</h4>
                      <pre className="al-log-code">{log.prompt}</pre>
                    </div>
                    <div className="al-log-section">
                      <h4>📥 Response</h4>
                      <pre className="al-log-code">{log.response || '(No response available)'}</pre>
                    </div>
                    <div className="al-log-meta">
                      <span>Model: {log.model || '—'}</span>
                      <span>Prompt tokens: {log.promptTokens || 0}</span>
                      <span>Completion tokens: {log.completionTokens || 0}</span>
                      <span>Latency: {log.latencyMs ? `${log.latencyMs}ms` : '—'}</span>
                      <span>Cost: ${(log.estimatedCost || 0).toFixed(5)}</span>
                    </div>
                  </div>
                )}
              </motion.div>
            );
          })
        )}
      </div>

      <p className="al-footer">
        Auto-refresh every 30s · {logs.length} log{logs.length !== 1 ? 's' : ''} shown
        {' · '}
        <button type="button" className="al-refresh-link" onClick={() => logsQuery.refetch()}>
          Refresh now
        </button>
      </p>
    </div>
  );
}
