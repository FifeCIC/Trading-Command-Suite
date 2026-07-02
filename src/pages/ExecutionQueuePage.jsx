import { useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiPost } from '../core/api/client';
import LoadingSkeleton from '../components/LoadingSkeleton';
import ApiOfflineBanner from '../components/ApiOfflineBanner';
import './execution-queue.css';

const STATUS_COLORS = {
  queued: '#f59e0b',
  running: '#3b82f6',
  complete: '#22c55e',
  failed: '#ef4444',
  cancelled: '#94a3b8',
};

function formatTime(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function formatDuration(ms) {
  if (!ms) return '—';
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function elapsedSince(date) {
  if (!date) return '—';
  const sec = Math.round((Date.now() - new Date(date).getTime()) / 1000);
  if (sec < 60) return `${sec}s ago`;
  if (sec < 3600) return `${Math.round(sec / 60)}m ago`;
  return `${Math.round(sec / 3600)}h ago`;
}

function ProgressBar({ done, total }) {
  const pct = total > 0 ? (done / total) * 100 : 0;
  return (
    <div className="eq-progress-wrap">
      <span className="eq-progress-bar" style={{ width: pct + '%' }} />
      <span className="eq-progress-text">{done}/{total}</span>
    </div>
  );
}

export default function ExecutionQueuePage() {
  const qc = useQueryClient();

  const queueQuery = useQuery({
    queryKey: ['execution-queue'],
    queryFn: () => apiGet('/api/automation/queue'),
    refetchInterval: 3000,
  });

  const statsQuery = useQuery({
    queryKey: ['execution-queue', 'stats'],
    queryFn: () => apiGet('/api/automation/queue/stats'),
    refetchInterval: 3000,
  });

  const cancelMutation = useMutation({
    mutationFn: (jobId) => apiPost(`/api/automation/queue/${jobId}/cancel`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['execution-queue'] }),
  });

  const jobs = queueQuery.data || [];
  const stats = statsQuery.data || { queued: 0, running: 0, completed: 0, failed: 0, cancelled: 0 };
  const isPending = queueQuery.isLoading;
  const apiOnline = !queueQuery.isError;

  const handleCancel = useCallback((jobId) => {
    if (window.confirm('Cancel this queued job?')) {
      cancelMutation.mutate(jobId);
    }
  }, [cancelMutation]);

  return (
    <div className="eq-page">
      <motion.header className="eq-header" initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}>
        <div>
          <h1>Execution Queue</h1>
          <p className="eq-subtitle">Operational queue view — staged protocol runs, retries, and dispatch diagnostics. Auto-refresh 3s.</p>
        </div>
      </motion.header>

      {!apiOnline && <ApiOfflineBanner />}

      {/* ── Stats Bar ── */}
      <motion.div className="eq-stats-bar" initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }}>
        {Object.entries(stats).map(([key, val]) => (
          <div key={key} className="eq-stat-chip" style={{ borderColor: STATUS_COLORS[key] || '#94a3b8' }}>
            <span className="eq-stat-count" style={{ color: STATUS_COLORS[key] }}>{val}</span>
            <span className="eq-stat-label">{key}</span>
          </div>
        ))}
        <span className="eq-stat-refresh">{queueQuery.isFetching ? '⟳' : ''}</span>
      </motion.div>

      {/* ── Queue Timeline ── */}
      {isPending ? (
        <LoadingSkeleton variant="card" count={3} />
      ) : jobs.length === 0 ? (
        <motion.div className="eq-empty-state" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.1 }}>
          <div className="eq-empty-icon">⏳</div>
          <h2>Queue is empty</h2>
          <p>No protocol runs are queued, running, or recently completed. Enqueue a run from the Protocol Runs page to see it here.</p>
        </motion.div>
      ) : (
        <motion.div className="eq-timeline" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.08 }}>
          {jobs.map((job, i) => (
            <motion.div
              key={job.id}
              className={`eq-job-card eq-job-${job.status}`}
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.05 + i * 0.04 }}
              style={{ borderLeftColor: STATUS_COLORS[job.status] || '#94a3b8' }}
            >
              <div className="eq-job-top">
                <span className="eq-job-name">{job.name}</span>
                <span
                  className="eq-job-status"
                  style={{ background: (STATUS_COLORS[job.status] + '22'), color: STATUS_COLORS[job.status] }}
                >
                  {job.status}
                </span>
                <span className="eq-job-protocol">{job.protocolId}</span>
                {job.status === 'queued' && (
                  <button className="eq-cancel-btn" onClick={() => handleCancel(job.id)}>✕ Cancel</button>
                )}
                {job.retryCount > 0 && (
                  <span className="eq-retry-badge">↻ Retry {job.retryCount}</span>
                )}
              </div>

              {/* Progress */}
              {job.status === 'running' && (
                <div className="eq-job-progress">
                  <ProgressBar done={job.progress?.done || 0} total={job.progress?.total || 0} />
                </div>
              )}

              {/* Timeline */}
              <div className="eq-job-timeline">
                <span className="eq-job-time">Queued: {elapsedSince(job.queuedAt)}</span>
                {job.startedAt && <span className="eq-job-time">Started: {formatTime(job.startedAt)}</span>}
                {job.completedAt && <span className="eq-job-time">Completed: {formatTime(job.completedAt)}</span>}
                {job.result?.durationMs > 0 && (
                  <span className="eq-job-duration">Duration: {formatDuration(job.result.durationMs)}</span>
                )}
              </div>

              {/* Symbols */}
              <div className="eq-job-symbols">
                <span className="eq-symbols-label">Symbols ({job.symbols?.length || 0}):</span>
                {job.symbols?.map(s => (
                  <span key={s} className="eq-symbol-tag">{s}</span>
                ))}
              </div>

              {/* Error */}
              {job.error && (
                <div className="eq-job-error">
                  ⚠ {job.error}
                </div>
              )}

              {/* Result summary */}
              {job.result?.results && (
                <div className="eq-job-results">
                  {job.result.results.slice(0, 5).map((r, j) => (
                    <span key={j} className={`eq-result-chip eq-result-${r.signal?.toLowerCase()}`}>
                      {r.symbol}: {r.composite?.toFixed(0)} {r.signal}
                    </span>
                  ))}
                  {job.result.results.length > 5 && (
                    <span className="eq-result-more">+{job.result.results.length - 5} more</span>
                  )}
                </div>
              )}

              {/* Dispatch Trace */}
              <div className="eq-job-trace">
                <span className="eq-trace-id">ID: {job.id.slice(0, 8)}</span>
                <span className="eq-trace-run">Run: #{job.runId}</span>
              </div>
            </motion.div>
          ))}
        </motion.div>
      )}
    </div>
  );
}
