import { useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiPost } from '../core/api/client';
import ApiOfflineBanner from '../components/ApiOfflineBanner';
import './execution-queue.css';
import PageInfoPopover from '../components/PageInfoPopover';

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

import { formatTime, formatDuration, timeAgo } from '../core/format-utils';
import { decisionScore } from '../core/decision-score';

/** Seconds until an ISO timestamp (for next-tick countdown). */
function countdownTo(iso) {
  if (!iso) return '—';
  const diff = new Date(iso).getTime() - Date.now();
  if (diff <= 0) return 'due';
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return `in ${sec}s`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `in ${min}m ${sec % 60}s`;
  return `in ${Math.floor(min / 60)}h ${min % 60}m`;
}

/** The primary automation loop's tick sequence (matches automation-loop.service.ts tick()). */
const LOOP_STEPS = [
  { n: '0', label: 'Job queue poll', desc: 'Process due scheduled_job entries (priority desc)' },
  { n: '1', label: 'Timeline risk', desc: 'Active events → global risk multiplier' },
  { n: '1b', label: 'Weekend defense', desc: 'Wed/Fri swap-drag + gap-risk check' },
  { n: '2', label: 'Fetch portfolios', desc: 'All enabled brokers → position sync' },
  { n: '2b', label: 'Discover strategies', desc: 'Active bots + data-readiness + priority reorder' },
  { n: '3', label: 'One scoring line', desc: 'buildBestLadder → signal records → bot queues' },
  { n: '3c', label: 'Snapshot trial', desc: 'Score both snapshots when a trial is active' },
  { n: '4', label: 'Process signal queues', desc: 'Queue heads → gates → dispatchTrade' },
];

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
        <span className="eq-event-time">{timeAgo(event.timestamp)}</span>
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
        {/* #909 — unit-aware score (raw / percentage / historical-untyped), or nothing at all. */}
        {decisionScore(event).text && (
          <span className="eq-event-composite" title={decisionScore(event).title || undefined}>
            {decisionScore(event).text}
          </span>
        )}
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

  // ── Loop routine (live status) ────────────────────
  const statusQuery = useQuery({
    queryKey: ['automation', 'status'],
    queryFn: () => apiGet('/api/automation/status'),
    refetchInterval: 5000,
  });

  // ── Scheduled jobs (unified job queue #614) ───────
  const jobsQuery = useQuery({
    queryKey: ['automation', 'jobs'],
    queryFn: () => apiGet('/api/automation/jobs?limit=50'),
    refetchInterval: tab === 'jobs' ? 5000 : false,
  });
  const jobStatsQuery = useQuery({
    queryKey: ['automation', 'jobs', 'stats'],
    queryFn: () => apiGet('/api/automation/jobs/stats'),
    refetchInterval: tab === 'jobs' ? 5000 : false,
  });

  const events = eventsQuery.data?.events || [];
  const jobs = queueQuery.data || [];
  const stats = statsQuery.data || { queued: 0, running: 0, completed: 0, failed: 0, cancelled: 0 };
  const loopStatus = statusQuery.data || {};
  const scheduledJobs = jobsQuery.data || [];
  const jobStats = jobStatsQuery.data || {};
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
          <h1>Execution Queue
          <PageInfoPopover>
            Unified automation hub — all automated activity in one place. Ticks, trade decisions, protocol runs, and scheduled tasks.
          </PageInfoPopover>
        </h1>
        </div>
      </motion.header>

      {!apiOnline && <ApiOfflineBanner />}

      {/* ── Loop Routine (schedule + tick sequence) ── */}
      <motion.section className="eq-routine" initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.02 }}>
        <div className="eq-routine-head">
          <span className={`eq-routine-dot ${loopStatus.loopEnabled ? 'eq-on' : 'eq-off'}`} />
          <strong>Primary Loop</strong>
          <span className="eq-routine-chip">⟳ every {loopStatus.tickIntervalMs ? formatDuration(loopStatus.tickIntervalMs) : '—'}</span>
          <span className="eq-routine-chip">Tick #{loopStatus.tickCount ?? 0}</span>
          <span className="eq-routine-chip">last tick {formatDuration(loopStatus.lastTickMs)}</span>
          <span className="eq-routine-chip">risk ×{loopStatus.globalRiskMultiplier ?? 1}</span>
          <span className="eq-routine-chip">
            {loopStatus.layers?.protocolsEnabled ? '🟢 Protocols' : '🔴 Protocols'} · {loopStatus.layers?.tradingEnabled ? '🟢 Trading' : '🔴 Trading'}
          </span>
          {/* EFFECTIVE EXECUTION STATE.
              `layers.tradingEnabled` is only HALF the answer — Gate 7 also needs
              the per-broker flag. Rendering the layer flag alone let the app show
              "🟢 Trading" while every dispatch was being diverted to paper, which
              hid a months-long throughput collapse (94 -> 9 -> 1 trades/month).
              Show what will ACTUALLY happen to an order. */}
          {loopStatus.execution && (
            <span
              className={`eq-routine-chip ${loopStatus.execution.willPlaceRealOrders ? 'eq-on' : 'eq-off'}`}
              title={
                `layer tradingEnabled=${loopStatus.execution.layerTradingEnabled}; ` +
                `brokers=${Object.entries(loopStatus.execution.brokerTradingEnabled || {})
                  .map(([id, on]) => `${id}=${on}`).join(', ')}`
              }
            >
              {loopStatus.execution.willPlaceRealOrders ? '⚡ Real orders' : `🧾 ${loopStatus.execution.mode}`}
            </span>
          )}
          {loopStatus.nextTickAt && <span className="eq-routine-next">{countdownTo(loopStatus.nextTickAt)}</span>}
        </div>
        <div className="eq-routine-steps">
          {LOOP_STEPS.map((s) => (
            <div key={s.n} className="eq-routine-step" title={s.desc}>
              <span className="eq-routine-step-n">{s.n}</span>
              <span className="eq-routine-step-label">{s.label}</span>
            </div>
          ))}
        </div>
      </motion.section>

      {/* ── Tabs ── */}
      <motion.div className="eq-tabs" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.04 }}>
        <button className={`eq-tab ${tab === 'events' ? 'eq-tab-active' : ''}`} onClick={() => setTab('events')}>
          ⟳ Live Events {eventsQuery.isFetching ? <span className="eq-spinner">⏳</span> : <span className="eq-tab-count">{eventStats.total}</span>}
        </button>
        <button className={`eq-tab ${tab === 'queue' ? 'eq-tab-active' : ''}`} onClick={() => setTab('queue')}>
          🏗 Protocol Queue <span className="eq-tab-count">{stats.running + stats.queued}</span>
        </button>
        <button className={`eq-tab ${tab === 'jobs' ? 'eq-tab-active' : ''}`} onClick={() => setTab('jobs')}>
          🗓 Scheduled Jobs <span className="eq-tab-count">{(jobStats.queued || 0) + (jobStats.running || 0)}</span>
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
                    <span className="eq-job-time">Queued: {timeAgo(job.queuedAt)}</span>
                    {job.startedAt && <span className="eq-job-time">Started: {formatTime(job.startedAt, { seconds: true })}</span>}
                    {job.completedAt && <span className="eq-job-time">Completed: {formatTime(job.completedAt, { seconds: true })}</span>}
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

      {/* ── Scheduled Jobs Tab (unified job queue #614) ── */}
      {tab === 'jobs' && (
        <div className="eq-tab-content">
          <motion.div className="eq-stats-bar" initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }}>
            {['queued', 'running', 'complete', 'failed'].map((key) => (
              <div key={key} className="eq-stat-chip" style={{ borderColor: STATUS_COLORS[key] || '#94a3b8' }}>
                <span className="eq-stat-count" style={{ color: STATUS_COLORS[key] }}>{jobStats[key] ?? 0}</span>
                <span className="eq-stat-label">{key}</span>
              </div>
            ))}
            {jobStats.nextDueAt && (
              <span className="eq-job-time">next: {jobStats.nextDueType} {countdownTo(jobStats.nextDueAt)}</span>
            )}
          </motion.div>

          {scheduledJobs.length === 0 ? (
            <motion.div className="eq-empty-state" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.1 }}>
              <div className="eq-empty-icon">🗓</div>
              <h2>No scheduled jobs</h2>
              <p>The unified job queue (scheduled_job) is empty. Jobs are polled by the loop each tick.</p>
            </motion.div>
          ) : (
            <motion.div className="eq-timeline" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.08 }}>
              {scheduledJobs.map((job) => (
                <motion.div
                  key={job.id}
                  className={`eq-job-card eq-job-${job.status}`}
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  style={{ borderLeftColor: STATUS_COLORS[job.status] || '#94a3b8' }}
                >
                  <div className="eq-job-top">
                    <span className="eq-job-name">{job.type}</span>
                    <span className="eq-job-status" style={{ background: (STATUS_COLORS[job.status] + '22'), color: STATUS_COLORS[job.status] }}>{job.status}</span>
                    <span className="eq-job-protocol">priority {job.priority}</span>
                    {job.recurrence === 'interval' && <span className="eq-retry-badge">↻ every {formatDuration(job.recurrenceMs)}</span>}
                    {job.attempts > 0 && <span className="eq-job-protocol">attempt {job.attempts}/{job.maxAttempts}</span>}
                  </div>
                  <div className="eq-job-timeline">
                    <span className="eq-job-time">Due: {formatTime(job.runAt)}</span>
                    {job.lastRunAt && <span className="eq-job-time">Last ran: {formatTime(job.lastRunAt)}</span>}
                    <span className="eq-job-time">Created: {timeAgo(job.createdAt)}</span>
                  </div>
                  {job.lastError && <div className="eq-job-error">⚠ {job.lastError}</div>}
                  <div className="eq-job-trace"><span className="eq-trace-id">ID: {job.id.slice(0, 8)}</span></div>
                </motion.div>
              ))}
            </motion.div>
          )}
        </div>
      )}
    </div>
  );
}
