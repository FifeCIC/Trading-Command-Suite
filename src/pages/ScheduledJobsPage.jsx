/**
 * ScheduledJobsPage — /status/scheduled-jobs
 *
 * ⚠️ MOVED 2026-10-02 (owner direction). This was the "🗓 Scheduled Jobs" TAB of the Execution Queue
 * page at /automation/execution-queue. The owner deleted that page and said: *"Preserve them and put
 * the Protocol Queue somewhere in the Protocol area and Schedule Jobs in the Status area."*
 *
 * WHY STATUS RATHER THAN AUTOMATION — this is the `scheduled_job` table (the unified job queue, #614),
 * drained by the loop's step 0 "Job queue poll". It is machinery health: is anything due, did the last
 * run fail, how many attempts. That is what Status is for.
 *
 * ⚠️ NAMED `ScheduledJobsPage`, not `AutomationJobsPage`. The owner is retiring the Automation area
 * precisely because "automation" named a mechanism rather than a subject — see the retirement note in
 * nav-tree.js. The file name should not reintroduce the word that was removed on purpose.
 *
 * 🔗 Markup and `eq-*` classes are unchanged from the original tab; `queue-ui.css` is shared with
 * /protocols/protocol-queue and the Trade Journal.
 */
import { motion } from 'motion/react';
import { useQuery } from '@tanstack/react-query';
import { apiGet } from '../core/api/client';
import ApiOfflineBanner from '../components/ApiOfflineBanner';
import { formatTime, formatDuration, timeAgo } from '../core/format-utils';
import './queue-ui.css';

const STATUS_COLORS = {
  queued: '#f59e0b',
  running: '#3b82f6',
  complete: '#22c55e',
  failed: '#ef4444',
  cancelled: '#94a3b8',
};

/** Seconds until an ISO timestamp (next-run countdown). */
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

export default function ScheduledJobsPage() {
  const jobsQuery = useQuery({
    queryKey: ['scheduled-jobs'],
    queryFn: () => apiGet('/api/automation/jobs?limit=50'),
    refetchInterval: 5000,
  });
  const jobStatsQuery = useQuery({
    queryKey: ['scheduled-jobs', 'stats'],
    queryFn: () => apiGet('/api/automation/jobs/stats'),
    refetchInterval: 5000,
  });

  const scheduledJobs = jobsQuery.data || [];
  const jobStats = jobStatsQuery.data || {};

  return (
    <div className="eq-page">
      <motion.header className="eq-header" initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}>
        <div>
          <h1>Scheduled Jobs</h1>
        </div>
      </motion.header>

      {jobsQuery.isError && <ApiOfflineBanner />}

      <motion.div className="eq-stats-bar" initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }}>
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
        <motion.div className="eq-empty-state" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
          <div className="eq-empty-icon">🗓</div>
          <h2>No scheduled jobs</h2>
          <p>The unified job queue (scheduled_job) is empty. Jobs are polled by the loop each tick.</p>
        </motion.div>
      ) : (
        <motion.div className="eq-timeline" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
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
                <span
                  className="eq-job-status"
                  style={{ background: (STATUS_COLORS[job.status] + '22'), color: STATUS_COLORS[job.status] }}
                >
                  {job.status}
                </span>
                <span className="eq-job-protocol">priority {job.priority}</span>
                {job.recurrence === 'interval' && (
                  <span className="eq-retry-badge">↻ every {formatDuration(job.recurrenceMs)}</span>
                )}
                {job.attempts > 0 && (
                  <span className="eq-job-protocol">attempt {job.attempts}/{job.maxAttempts}</span>
                )}
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
  );
}
