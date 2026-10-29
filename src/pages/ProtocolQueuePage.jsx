/**
 * ProtocolQueuePage — /protocols/protocol-queue
 *
 * ⚠️ MOVED 2026-10-02 (owner direction). This was the "🏗 Protocol Queue" TAB of the Execution Queue
 * page at /automation/execution-queue. The owner deleted that page and said: *"Preserve them and put
 * the Protocol Queue somewhere in the Protocol area and Schedule Jobs in the Status area."* So the
 * tab became a view in its own right, under Protocols, and nothing was lost.
 *
 * ⚠️ The CANCEL button exists here and NOWHERE ELSE. `POST /api/automation/queue/:id/cancel` is the
 * only way to drop a queued protocol run; deleting this page without preserving the tab would have
 * removed the capability silently.
 *
 * WHY PROTOCOLS RATHER THAN AUTOMATION — the owner's rule for the retirement:
 *   "Going forward anything that was automation or scheduled will be within the area of what it is
 *    scheduling i.e. scheduling a trade, belongs in the Trading area."
 * A queued PROTOCOL RUN is scheduling a protocol, so it belongs with protocols. The section that
 * scheduled it (the loop) is machinery, not a place.
 *
 * 🔗 The default export shape, the `eq-*` class names and `queue-ui.css` are unchanged from the
 * original tab — the markup moved, it was not rewritten. `queue-ui.css` is shared with
 * /status/scheduled-jobs and the Trade Journal (which absorbed the Live Events tab).
 */
import { useCallback } from 'react';
import { motion } from 'motion/react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiPost } from '../core/api/client';
import ApiOfflineBanner from '../components/ApiOfflineBanner';
import { formatTime, formatDuration, timeAgo } from '../core/format-utils';
import './queue-ui.css';

/** Status → colour. One map, so a status cannot be green here and amber elsewhere. */
const STATUS_COLORS = {
  queued: '#f59e0b',
  running: '#3b82f6',
  complete: '#22c55e',
  failed: '#ef4444',
  cancelled: '#94a3b8',
};

function ProgressBar({ done, total }) {
  const pct = total > 0 ? (done / total) * 100 : 0;
  return (
    <div className="eq-progress-wrap">
      <span className="eq-progress-bar" style={{ width: pct + '%' }} />
      <span className="eq-progress-text">{done}/{total}</span>
    </div>
  );
}

export default function ProtocolQueuePage() {
  const qc = useQueryClient();

  const queueQuery = useQuery({
    queryKey: ['protocol-queue'],
    queryFn: () => apiGet('/api/automation/queue'),
    refetchInterval: 3000,
  });

  const statsQuery = useQuery({
    queryKey: ['protocol-queue', 'stats'],
    queryFn: () => apiGet('/api/automation/queue/stats'),
    refetchInterval: 3000,
  });

  const cancelMutation = useMutation({
    mutationFn: (jobId) => apiPost(`/api/automation/queue/${jobId}/cancel`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['protocol-queue'] }),
  });

  const jobs = queueQuery.data || [];
  const stats = statsQuery.data || { queued: 0, running: 0, completed: 0, failed: 0, cancelled: 0 };

  const handleCancel = useCallback((jobId) => {
    if (window.confirm('Cancel this queued job?')) cancelMutation.mutate(jobId);
  }, [cancelMutation]);

  return (
    <div className="eq-page">
      <motion.header className="eq-header" initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}>
        <div>
          <h1>Protocol Queue</h1>
        </div>
      </motion.header>

      {queueQuery.isError && <ApiOfflineBanner />}

      <motion.div className="eq-stats-bar" initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }}>
        {Object.entries(stats).map(([key, val]) => (
          <div key={key} className="eq-stat-chip" style={{ borderColor: STATUS_COLORS[key] || '#94a3b8' }}>
            <span className="eq-stat-count" style={{ color: STATUS_COLORS[key] }}>{val}</span>
            <span className="eq-stat-label">{key}</span>
          </div>
        ))}
        <span className="eq-stat-refresh">{queueQuery.isFetching ? '⟳' : ''}</span>
      </motion.div>

      {jobs.length === 0 ? (
        <motion.div className="eq-empty-state" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
          <div className="eq-empty-icon">⏳</div>
          <h2>Queue is empty</h2>
          <p>No protocol runs are queued, running, or recently completed.</p>
        </motion.div>
      ) : (
        <motion.div className="eq-timeline" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
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
                {job.retryCount > 0 && <span className="eq-retry-badge">↻ Retry {job.retryCount}</span>}
              </div>

              {job.status === 'running' && (
                <div className="eq-job-progress">
                  <ProgressBar done={job.progress?.done || 0} total={job.progress?.total || 0} />
                </div>
              )}

              <div className="eq-job-timeline">
                <span className="eq-job-time">Queued: {timeAgo(job.queuedAt)}</span>
                {job.startedAt && <span className="eq-job-time">Started: {formatTime(job.startedAt, { seconds: true })}</span>}
                {job.completedAt && <span className="eq-job-time">Completed: {formatTime(job.completedAt, { seconds: true })}</span>}
                {job.result?.durationMs > 0 && (
                  <span className="eq-job-duration">Duration: {formatDuration(job.result.durationMs)}</span>
                )}
              </div>

              <div className="eq-job-symbols">
                <span className="eq-symbols-label">Symbols ({job.symbols?.length || 0}):</span>
                {job.symbols?.map((s) => <span key={s} className="eq-symbol-tag">{s}</span>)}
              </div>

              {job.error && <div className="eq-job-error">⚠ {job.error}</div>}

              {job.result?.results && (
                <div className="eq-job-results">
                  {job.result.results.slice(0, 5).map((r, j) => (
                    <span key={j} className={`eq-result-chip eq-result-${r.signal?.toLowerCase()}`}>
                      {/* The composite is a score. The free edition (removed 2026-10-28) dropped the
                          NUMBER and kept the chip's other two facts — symbol and direction. One
                          edition now, so the number shows. */}
                      {r.symbol}
                      {true && <>: {r.composite?.toFixed(0)}</>}{' '}
                      {r.signal}
                    </span>
                  ))}
                  {job.result.results.length > 5 && (
                    <span className="eq-result-more">+{job.result.results.length - 5} more</span>
                  )}
                </div>
              )}

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
