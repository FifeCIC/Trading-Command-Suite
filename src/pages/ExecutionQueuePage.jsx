import { useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiPost } from '../core/api/client';
import LoadingSkeleton from '../components/LoadingSkeleton';
import ApiOfflineBanner from '../components/ApiOfflineBanner';
import './execution-queue.css';

const STATUS_COLORS = {
  queued: '#f59e0b', running: '#3b82f6', complete: '#22c55e', failed: '#ef4444', cancelled: '#94a3b8',
  success: '#22c55e', error: '#ef4444', info: '#3b82f6', warning: '#f59e0b',
  EXECUTED: '#22c55e', FAILED: '#ef4444', SCORED: '#8b5cf6', SKIP: '#94a3b8', BLOCKED: '#ef4444',
};

const EVENT_TYPE_STYLE = {
  automation: { bg: '#3b82f618', border: '#3b82f6', label: 'Tick', icon: '⟳' },
  decision: { bg: '#8b5cf618', border: '#8b5cf6', label: 'Decision', icon: '⚡' },
  protocol: { bg: '#f59e0b18', border: '#f59e0b', label: 'Protocol', icon: '🏗' },
};

function formatTime(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function formatDuration(ms) {
  if (!ms) return '';
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function elapsedSince(date) {
  if (!date) return '—';
  const sec = Math.round((Date.now() - new Date(date).getTime()) / 1000);
  if (sec < 5) return 'just now';
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

// ── Event Row (for unified log) ──────────────────────

function EventRow({ event }) {
  const style = EVENT_TYPE_STYLE[event.type] || EVENT_TYPE_STYLE.automation;
  const statusColor = STATUS_COLORS[event.status] || '#94a3b8';
  return (
    <motion.div
      className="eq-event-row"
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      layout
    >
      <div className="eq-event-left" style={{ borderColor: style?.border }}>
        <span className="eq-event-type-badge" style={{ background: style?.bg, color: style?.border }}>
          {style?.icon} {style?.label}
        </span>
        <span className="eq-event-time">{elapsedSince(event.timestamp)}</span>
        {event.symbol && <span className="eq-event-symbol">{event.symbol}</span>}
      </div>
      <div className="eq-event-main">
        <span className="eq-event-task">{event.taskName}</span>
        {event.detail && <span className="eq-event-detail">{event.detail}</span>}
      </div>
      <div className="eq-event-right">
        <span className="eq-event-status" style={{ color: statusColor, borderColor: statusColor }}>
          {event.status}
        </span>
        {event.durationMs > 0 && <span className="eq-event-dur">{formatDuration(event.durationMs)}</span>}
        {event.composite > 0 && <span className="eq-event-composite">{event.composite?.toFixed(0)}</span>}
      </div>
    </motion.div>
  );
}

// ── Main Component ───────────────────────────────────

export default function ExecutionQueuePage() {
  const qc = useQueryClient();
  const [tab, setTab] = useState('events'); // events | queue

  // ── Unified Event Log ──────────────────────────
  const eventsQuery = useQuery({
    queryKey: ['execution-events', tab],
    queryFn: () => apiGet('/api/automation/events?limit=100'),
    refetchInterval: tab === 'events' ? 3000 : false,
    enabled: true,
  });

  // ── Protocol Queue (legacy) ────────────────────
  const queueQuery = useQuery({
    queryKey: ['execution-queue'],
    queryFn: () => apiGet('/api/automation/queue'),
    refetchInterval: tab === 'queue' ? 3000 : false,
    enabled: true,
  });

  const statsQuery = useQuery({
    queryKey: ['execution-queue', 'stats'],
    queryFn: () => apiGet('/api/automation/queue/stats'),
    refetchInterval: tab === 'queue' ? 3000 : false,
    enabled: true,
  });

  const cancelMutation = useMutation({
    mutationFn: (jobId) => apiPost(`/api/automation/queue/${jobId}/cancel`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['execution-queue'] }),
  });

  const events = eventsQuery.data?.events || [];
  const jobs = queueQuery.data || [];
  const stats = statsQuery.data || { queued: 0, running: 0, completed: 0, failed: 0, cancelled: 0 };
  const apiOnline = !eventsQuery.isError && !queueQuery.isError;

  const handleCancel = useCallback((jobId) => {
    if (window.confirm('Cancel this queued job?')) {
      cancelMutation.mutate(jobId);
    }
  }, [cancelMutation]);

  // Count event types
  const eventStats = { automation: 0, decision: 0, total: events.length };
  for (const e of events) { eventStats[e.type] = (eventStats[e.type] || 0) + 1; }

  return (
    <div className="eq-page">
      <motion.header className="eq-header" initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}>
        <div>
          <h1>Execution Queue</h1>
          <p className="eq-subtitle">
            Unified automation hub — all automated activity in one place. Ticks, trade decisions, protocol runs, and scheduled tasks.
          </p>
        </div>
      </motion.header>

      {!apiOnline && <ApiOfflineBanner />}

      {/* ── Tabs ── */}
      <motion.div className="eq-tabs" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.04 }}>
        <button className={`eq-tab ${tab === 'events' ? 'eq-tab-active' : ''}`} onClick={() => setTab('events')}>
          ⟳ Live Events {eventsQuery.isFetching ? <span className="eq-spinner">⏳</span> : <span className="eq-tab-count">{eventStats.total}</span>}
        </button>
        <button className={`eq-tab ${tab === 'queue' ? 'eq-tab-active' : ''}`} onClick={() => setTab('queue')}>
          🏗 Protocol Queue <span className="eq-tab-count">{stats.running + stats.queued}</span>
        </button>
      </motion.div>

      {/* ── Live Events Tab ── */}
      {tab === 'events' && (
        <div className="eq-tab-content">
          <motion.div className="eq-event-stats" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.06 }}>
            <span className="eq-event-stat-chip">⟳ Automation: <b>{eventStats.automation}</b></span>
            <span className="eq-event-stat-chip">⚡ Decisions: <b>{eventStats.decision}</b></span>
            <span className="eq-event-stat-chip">📋 Total: <b>{eventStats.total}</b></span>
          </motion.div>

          {events.length === 0 ? (
            <motion.div className="eq-empty-state" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.1 }}>
              <div className="eq-empty-icon">📭</div>
              <h2>No events yet</h2>
              <p>The automation loop hasn't logged any activity yet. Start an automation run to see events here.</p>
            </motion.div>
          ) : (
            <motion.div className="eq-timeline" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
              <AnimatePresence>
                {events.map((event) => (
                  <EventRow key={event.id} event={event} />
                ))}
              </AnimatePresence>
            </motion.div>
          )}
        </div>
      )}

      {/* ── Protocol Queue Tab ── */}
      {tab === 'queue' && (
        <div className="eq-tab-content">
          {/* Stats Bar */}
          <motion.div className="eq-stats-bar" initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }}>
            {Object.entries(stats).map(([key, val]) => (
              <div key={key} className="eq-stat-chip" style={{ borderColor: STATUS_COLORS[key] || '#94a3b8' }}>
                <span className="eq-stat-count" style={{ color: STATUS_COLORS[key] }}>{val}</span>
                <span className="eq-stat-label">{key}</span>
              </div>
            ))}
            <span className="eq-stat-refresh">{queueQuery.isFetching ? '⟳' : ''}</span>
          </motion.div>

          {jobs.length === 0 ? (
            <motion.div className="eq-empty-state" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.1 }}>
              <div className="eq-empty-icon">⏳</div>
              <h2>Queue is empty</h2>
              <p>No protocol runs are queued, running, or recently completed.</p>
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
      )}
    </div>
  );
}
