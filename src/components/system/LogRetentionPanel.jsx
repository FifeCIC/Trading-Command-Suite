/**
 * LogRetentionPanel — the visible face of log retention and volume (#1023).
 *
 * ⚠️ WHY THIS EXISTS. The settings (`logging.*`) and the endpoints
 * (`GET /api/system/logs/retention`, `POST /api/system/logs/prune`) were already enough to manage
 * the logs — from a terminal. A capability reachable only by `curl` is a buried ability: it works,
 * nobody finds it, and the growth it prevents goes on growing. So the report, the preview and the
 * controls live next to the database retention table, which is the surface that already answers
 * "what is this install storing, and for how long".
 *
 * ⚠️ THE PRUNE IS TWO STEPS, ALWAYS. "Preview" reports what WOULD go; only then does the destructive
 * button become enabled, and it names the count and size it is about to move. A retention rule
 * that deletes the evidence of the defect being investigated is a documented failure in this repo
 * (`retention.config.ts`), and the cheap fix for it is to make the list visible before the delete.
 *
 * ⚠️ AND IT MOVES RATHER THAN DELETES (#1023 criterion 3). A file outside the window is moved into
 * `archive/` and removed on the NEXT run, so the decision is reversible for one cycle — and raising
 * the window before the next run keeps the archived file. The panel says this, because "prune"
 * reads as "gone" and it is not.
 */
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiPut } from '../../core/api/client';
import { noticeFromError } from '../../core/notices/from-error';
import { notice } from '../../core/notices/registry';
import NoticeBlock from '../NoticeBlock';
import './log-retention-panel.css';
const RETENTION_KEY = 'logging.retentionDays';
const PRUNE_KEY = 'logging.pruneEnabled';
const COLLAPSE_KEY = 'logging.collapseRepeats';
const WINDOW_KEY = 'logging.repeatWindowMinutes';

/** Bytes as a human unit. Matches the server's own formatting so the two cannot disagree. */
function formatBytes(n) {
  if (!Number.isFinite(n) || n <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let v = n;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i += 1; }
  return `${v >= 10 || i === 0 ? Math.round(v) : v.toFixed(1)} ${units[i]}`;
}

/**
 * A number that writes a SERVER setting and says what happened.
 *
 * ⚠️ Commits on blur/Enter, not per keystroke. A PUT per keypress would write "3" on the way to "30",
 * and a retention window of 3 days briefly in force is a real deletion, not a draft.
 */
function SettingNumberInput({ settingKey, value, min, max, queryKey }) {
  const qc = useQueryClient();
  const [draft, setDraft] = useState(value == null ? '' : String(value));
  const [status, setStatus] = useState(null);

  useEffect(() => { setDraft(value == null ? '' : String(value)); }, [value]);

  const save = useMutation({
    mutationFn: (v) => apiPut(`/api/system/settings/registry/${settingKey}`, { value: v }),
    onSuccess: () => { setStatus('saved'); qc.invalidateQueries({ queryKey }); },
    onError: () => setStatus('error'),
  });

  const commit = () => {
    const n = Number(draft);
    if (!Number.isFinite(n) || n === Number(value)) return;
    if (min != null && n < min) { setStatus('range'); return; }
    if (max != null && n > max) { setStatus('range'); return; }
    setStatus('saving');
    save.mutate(n);
  };

  return (
    <>
      <input
        type="number"
        className="lrp-input"
        value={draft}
        min={min}
        max={max}
        aria-label={settingKey}
        onChange={(e) => { setDraft(e.target.value); setStatus(null); }}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); commit(); } }}
      />
      {status === 'saved' && <span className="lrp-ok">saved — live now</span>}
      {status === 'saving' && <span className="lrp-hint">saving…</span>}
      {status === 'range' && <span className="lrp-warn">⚠️ outside {min}–{max}</span>}
      {status === 'error' && <span className="lrp-warn">⚠️ could not save</span>}
    </>
  );
}

export default function LogRetentionPanel() {
  const qc = useQueryClient();
  const [preview, setPreview] = useState(null);
  const [previewError, setPreviewError] = useState(null);
  const [result, setResult] = useState(null);

  const registryQuery = useQuery({
    queryKey: ['settings-registry', 'logging'],
    queryFn: () => apiGet('/api/system/settings/registry').catch(() => null),
    staleTime: 30_000,
  });

  const retentionQuery = useQuery({
    queryKey: ['log-retention'],
    queryFn: () => apiGet('/api/system/logs/retention').catch(() => null),
    refetchInterval: 120_000,
    staleTime: 30_000,
  });

  const collapseQuery = useQuery({
    queryKey: ['log-collapse-stats'],
    queryFn: () => apiGet('/api/system/logs/collapse-stats').catch(() => null),
    refetchInterval: 120_000,
    staleTime: 30_000,
  });

  const previewMutation = useMutation({
    mutationFn: () => fetch('/api/system/logs/prune?dryRun=true', { method: 'POST' }).then(async (r) => {
      if (!r.ok) throw new Error(`prune preview failed (${r.status})`);
      return r.json();
    }),
    onSuccess: (data) => { setPreview(data); setPreviewError(null); setResult(null); },
    onError: (e) => { setPreview(null); setPreviewError(e); },
  });

  const pruneMutation = useMutation({
    mutationFn: () => fetch('/api/system/logs/prune?dryRun=false', { method: 'POST' }).then(async (r) => {
      if (!r.ok) throw new Error(`prune failed (${r.status})`);
      return r.json();
    }),
    onSuccess: (data) => {
      setResult(data);
      setPreview(null);
      qc.invalidateQueries({ queryKey: ['log-retention'] });
    },
  });

  const byKey = (list, key) => (list || []).find((s) => s.key === key);
  const settings = registryQuery.data?.settings;

  // ⚠️ The settings query can legitimately fail. `null` here means "we could not read it", which is
  // NOT the same as "the default applies" — so each control is disabled rather than defaulted.
  const retentionSetting = byKey(settings, RETENTION_KEY);
  const pruneSetting = byKey(settings, PRUNE_KEY);
  const collapseSetting = byKey(settings, COLLAPSE_KEY);
  const windowSetting = byKey(settings, WINDOW_KEY);
  const settingsReadable = !!settings;

  const toggleMutation = useMutation({
    mutationFn: ({ key, value }) => apiPut(`/api/system/settings/registry/${key}`, { value }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['settings-registry', 'logging'] }),
  });

  const report = retentionQuery.data;
  const col = collapseQuery.data;

  // The report is the source of truth for the window we are ABOUT to prune with — read it from the
  // server rather than from the input, so a value that has not been saved cannot look like policy.
  const windowDays = report?.retentionDays;
  const pruneEnabled = report?.pruneEnabled;
  const previewCount = preview?.wouldRemove?.length ?? 0;
  const previewNames = (preview?.wouldRemove || []).map((f) => f.name);
  // The server lists `kept` OLDEST FIRST, so the head is the oldest held file and its `reason`
  // already carries the age and the window (e.g. "21d old, inside the 30d window"). Read from the
  // report rather than recomputing an age here — a second derivation is one that can disagree.
  const oldestKeptReason = report?.kept?.[0]?.reason ?? null;

  const previewNotice = preview
    ? (previewCount === 0
        ? notice('TCS-DATA-010', { days: windowDays, files: report?.totalFiles ?? 0, size: formatBytes(report?.totalBytes ?? 0) })
        : notice('TCS-DATA-011', { count: previewCount, size: formatBytes(preview.bytesFreed), names: previewNames.join(', ') }))
    : null;

  const resultNotice = result
    ? (result.purged?.length > 0
        ? notice('TCS-DATA-012', { count: result.purged.length, size: formatBytes(result.bytesFreed), names: result.purged.map((f) => f.name).join(', ') })
        : result.archived?.length > 0
          ? notice('TCS-DATA-013', { count: result.archived.length, names: result.archived.map((f) => f.name).join(', '), size: formatBytes((result.archived || []).reduce((n, f) => n + (f.size || 0), 0)) })
          : notice('TCS-DATA-010', { days: result.retentionDays, files: result.totalFiles ?? 0, size: formatBytes(result.totalBytes ?? 0) }))
    : null;

  return (
    <section className="lrp-section" aria-labelledby="lrp-title">
      <div className="lrp-header">
        <h2 id="lrp-title">📝 Log Files</h2>
        <span className="lrp-sub">
          {report
            ? `${report.totalFiles} file(s) · ${formatBytes(report.totalBytes)} · prunes daily at 03:15` +
              (report.archiveHeld?.length ? ` · ${report.archiveHeld.length} in archive (${formatBytes(report.archiveHeldBytes)})` : '')
            : 'not read'}
        </span>
      </div>

      {/* ── Controls ── */}
      <div className="lrp-controls">
        <div className="lrp-control">
          <label className="lrp-label" htmlFor="lrp-retention-days">Retention window (days)</label>
          <div className="lrp-control-row">
            {settingsReadable
              ? <SettingNumberInput settingKey={RETENTION_KEY} value={retentionSetting?.value}
                  min={retentionSetting?.min ?? 1} max={retentionSetting?.max ?? 3650}
                  queryKey={['settings-registry', 'logging']} />
              : <span className="lrp-warn">⚠️ settings unreadable — showing the server's effective value: {windowDays ?? '?'}d</span>}
          </div>
          <span className="lrp-note">Below 1 day the prune is inert — it removes nothing rather than everything.</span>
        </div>

        <div className="lrp-control">
          <label className="lrp-label" htmlFor="lrp-prune-enabled">
            <input
              id="lrp-prune-enabled"
              type="checkbox"
              checked={!!(pruneSetting?.value)}
              disabled={!settingsReadable || toggleMutation.isPending}
              onChange={(e) => toggleMutation.mutate({ key: PRUNE_KEY, value: e.target.checked })}
            />
            {' '}Daily prune enabled
          </label>
          <span className="lrp-note">
            The off switch. {pruneEnabled === false ? 'Currently OFF — the 03:15 run will do nothing.' : 'Currently ON.'}
          </span>
        </div>

        <div className="lrp-control">
          <label className="lrp-label" htmlFor="lrp-collapse-enabled">
            <input
              id="lrp-collapse-enabled"
              type="checkbox"
              checked={!!(collapseSetting?.value)}
              disabled={!settingsReadable || toggleMutation.isPending}
              onChange={(e) => toggleMutation.mutate({ key: COLLAPSE_KEY, value: e.target.checked })}
            />
            {' '}Collapse repeated log lines
          </label>
          <span className="lrp-note">
            Bounds a warn-storm to one line per window, with a count of what was suppressed.
            {col ? ` Suppressed since boot: ${col.suppressedSinceBoot} across ${col.trackedFingerprints} message(s).` : ''}
          </span>
        </div>

        <div className="lrp-control">
          <label className="lrp-label" htmlFor="lrp-repeat-window">Repeat window (minutes)</label>
          <div className="lrp-control-row">
            {settingsReadable
              ? <SettingNumberInput settingKey={WINDOW_KEY} value={windowSetting?.value}
                  min={windowSetting?.min ?? 1} max={windowSetting?.max ?? 1440}
                  queryKey={['settings-registry', 'logging']} />
              : <span className="lrp-hint">—</span>}
          </div>
          <span className="lrp-note">Range 1–1440. A window that expires re-reports, so an hourly fault is not swallowed.</span>
        </div>
      </div>

      {previewNotice && <div className="lrp-notice"><NoticeBlock notice={previewNotice} /></div>}
      {resultNotice && <div className="lrp-notice"><NoticeBlock notice={resultNotice} /></div>}
      {previewError && (
        <div className="lrp-notice">
          <NoticeBlock notice={noticeFromError(previewError)} />
        </div>
      )}

      {/* ── Files ── */}
      <div className="lrp-actions">
        <button
          type="button"
          className="lrp-btn"
          onClick={() => previewMutation.mutate()}
          disabled={previewMutation.isPending}
        >
          {previewMutation.isPending ? 'Checking…' : 'Preview prune'}
        </button>
        <button
          type="button"
          className="lrp-btn lrp-btn-danger"
          onClick={() => {
            if (window.confirm(`Permanently delete ${previewCount} log file(s) (${formatBytes(preview?.bytesFreed || 0)})?\n\n${previewNames.join('\n')}\n\nThis is not an archive — the content is gone.`)) {
              pruneMutation.mutate();
            }
          }}
          disabled={previewCount === 0 || pruneMutation.isPending}
        >
          {pruneMutation.isPending
            ? 'Pruning…'
            : previewCount > 0
              ? `Move ${previewCount} file(s) to archive · ${formatBytes(preview.bytesFreed)}`
              : preview
                ? 'Nothing to remove'
                : 'Prune — preview first'}
        </button>
        {/* ⚠️ THREE STATES, NOT TWO (#1047). "Not run yet", "ran and found nothing" and "ran and
            found work" are three different claims, and collapsing the first two is what made a
            correctly-working prune read as a BROKEN BUTTON: the label said "Prune — preview first"
            both before a preview and after one that found nothing, so pressing it appeared to do
            nothing at all. "An empty list and a failed query must never render the same." */}
        {preview && previewCount > 0 && (
          <span className="lrp-note">
            Moves them to <code>archive/</code> — nothing is deleted until the next run, so this is recoverable.
          </span>
        )}
        {preview && previewCount === 0 && (
          <span className="lrp-note lrp-ok">
            ✅ Nothing to prune — no file is older than the {windowDays}-day window.
            {report?.totalFiles ? ` ${report.totalFiles} file(s) held, ${formatBytes(report.totalBytes)} in total.` : ''}
            {oldestKeptReason ? ` Oldest: ${oldestKeptReason}.` : ''}
            {' '}A prune would also show no immediate change even when it removes something — it MOVES files to{' '}
            <code>archive/</code> and deletes them on the next run.
          </span>
        )}
        {!preview && (
          <span className="lrp-note">
            Preview first. The button names what it will move — and says so plainly when there is nothing.
          </span>
        )}
      </div>

      <div className="lrp-table-wrap">
        <table className="lrp-table">
          <thead>
            <tr>
              <th>File</th>
              <th>Size</th>
              <th>Verdict</th>
            </tr>
          </thead>
          <tbody>
            {!report && (
              <tr><td colSpan={3} className="lrp-empty">Could not read the log directory — this is a failed read, not an empty folder.</td></tr>
            )}
            {report && report.totalFiles === 0 && (
              <tr><td colSpan={3} className="lrp-empty">No dated <code>tcs-&lt;YYYY-MM-DD&gt;.log</code> files in {report.directory}.</td></tr>
            )}
            {[...(report?.wouldRemove || []).map((f) => ({ ...f, verdict: 'Will be removed', remove: true })),
              ...(report?.kept || []).map((f) => ({ name: f.name, size: null, verdict: f.reason, remove: false }))]
              .map((f) => (
                <tr key={f.name} className={f.remove ? 'lrp-row-remove' : ''}>
                  <td><code className="lrp-file">{f.name}</code></td>
                  <td className="lrp-size">{f.size != null ? formatBytes(f.size) : '—'}</td>
                  <td className="lrp-verdict">{f.verdict}</td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>

      <p className="lrp-note lrp-footer">
        ⚠️ A prune <strong>moves</strong> before it removes: a file outside the window goes to <code>archive/</code>
        and is only deleted on the next run, so raising the window before then keeps it. The file being written
        now is never a candidate, whatever the window says. Console captures (<code>api-out.log</code>,
        <code>%TEMP%\nest-api*.log</code>) are never auto-pruned: they carry no date, so the policy has no age to
        judge and declines to act.
      </p>
    </section>
  );
}
