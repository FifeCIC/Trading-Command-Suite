/**
 * LoopControls — the automation loop's controls, on the Dashboard.
 *
 * ⚠️ MOVED 2026-10-02 (owner, Page Walkthrough): *"Move the automation controls … to the main
 * dashboard … and place them centre."* They came from `<header className="ad-header">` on
 * /automation/automation-dashboard, which is being deleted with the rest of the Automation area.
 *
 * ⚠️ THE PREMIUM GATING IS PRESERVED EXACTLY — do not "tidy" it. §9.14 makes Start / Stop / Run Now
 * PREMIUM-ONLY by decision (O2: the endpoints stay in the BACKEND by design — this is a UI boundary,
 * not a security boundary). Omitting the buttons is NOT enough on its own: the path literals would
 * still ship in the free bundle, where anyone can read them and post to them from a console. So the
 * ternary is written **at the call site** — `import.meta.env.VITE_EDITION` is substituted at build
 * time, so only one branch survives. A helper taking the path as an argument would evaluate it either
 * way and the literal would ship.
 *
 * ⚠️ `toggle` and `config` are deliberately NOT gated: the broker switches and the Confirm setting
 * stay in the free edition, so those endpoints are genuinely used there.
 *
 * WHY IT IS ITS OWN COMPONENT rather than living inside DashboardPage: the dashboard is a widget
 * board (`WidgetBoard`), which is also used by other boards. Putting automation controls inside that
 * generic component would couple every board to the automation loop — so this renders beside it.
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiPost } from '../core/api/client';
import { formatDuration } from '../core/format-utils';
import './loop-controls.css';

export default function LoopControls() {
  const qc = useQueryClient();

  const statusQuery = useQuery({
    queryKey: ['loop-controls', 'status'],
    queryFn: () => apiGet('/api/automation/status').catch(() => null),
    refetchInterval: 10_000,
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ['loop-controls', 'status'] });

  // ⚠️ The live TICK PHASE, absorbed from the deleted Automation Dashboard's "📡 Activity Feed" panel
  // (2026-10-02). That panel was the only consumer of `/api/automation/activity`, which is NOT the
  // same feed as `/api/automation/events` (the journal's Activity tab): this one derives the CURRENT
  // PHASE of the running tick and how many events today. The journal shows what happened; this shows
  // where the loop is right now — so it belongs with the rest of the loop's state, here.
  // The endpoint's own docblock says it was built for this: 'lightweight current-tick progress feed'.
  const activityQuery = useQuery({
    queryKey: ['loop-controls', 'activity'],
    queryFn: () => apiGet('/api/automation/activity?limit=1').catch(() => null),
    refetchInterval: 10_000,
  });
  const start = useMutation({ mutationFn: () => apiPost(import.meta.env.VITE_EDITION === 'free' ? '' : '/api/automation/start'), onSuccess: invalidate });
  const stop = useMutation({ mutationFn: () => apiPost(import.meta.env.VITE_EDITION === 'free' ? '' : '/api/automation/stop'), onSuccess: invalidate });
  const runNow = useMutation({ mutationFn: () => apiPost(import.meta.env.VITE_EDITION === 'free' ? '' : '/api/automation/run-now'), onSuccess: invalidate });

  const s = statusQuery.data;
  const activity = activityQuery.data || null;
  // ⚠️ THREE STATES, and none of them may render as another. `null` is "cannot judge" (the status
  // call failed or has not answered); `false` is a loop that is genuinely stopped; `true` is running.
  // Collapsing them would show "Loop Stopped" for a fetch that simply failed.
  const loopRunning = s ? !!s.loopEnabled : null;
  const busy = start.isPending || stop.isPending || runNow.isPending;

  return (
    <div className="lc-strip">
      <span className={`lc-dot ${loopRunning === null ? 'lc-unknown' : loopRunning ? 'lc-on' : 'lc-off'}`} />
      <strong className="lc-label">
        {loopRunning === null ? 'Loop — status unavailable' : loopRunning ? 'Loop Active' : 'Loop Stopped'}
      </strong>

      {loopRunning === true && (
        <>
          <span className="lc-chip">Tick #{s.tickCount ?? 0}</span>
          <span className="lc-chip">every {s.tickIntervalMs ? formatDuration(s.tickIntervalMs) : '—'}</span>
          {s.globalRiskMultiplier != null && <span className="lc-chip">risk ×{s.globalRiskMultiplier}</span>}
          {activity?.currentPhase && (
            <span
              className="lc-chip"
              title={
                `Phase since ${activity.phaseStartedAt || '—'}` +
                (activity.totalEventsToday > 0 ? ` · ${activity.totalEventsToday} event(s) today` : '')
              }
            >
              {activity.currentPhase}
            </span>
          )}
          {/* ⚠️ The EFFECTIVE execution state, not just the layer flag: the layer flag alone once
              showed "🟢 Trading" while every dispatch was diverted to paper, hiding a months-long
              throughput collapse. Show what will actually happen to an order. */}
          {s.execution && (
            <span className="lc-chip">
              {s.execution.willPlaceRealOrders ? '⚡ Real orders' : `🧾 ${s.execution.mode}`}
            </span>
          )}
        </>
      )}

      {import.meta.env.VITE_EDITION !== 'free' && (
        <span className="lc-actions">
          {loopRunning ? (
            <button className="lc-btn lc-btn-stop" onClick={() => stop.mutate()} disabled={busy}>
              {stop.isPending ? '⏳' : '⏸'} Stop Loop
            </button>
          ) : (
            <button className="lc-btn lc-btn-start" onClick={() => start.mutate()} disabled={busy || loopRunning === null}>
              {start.isPending ? '⏳' : '▶'} Start Loop
            </button>
          )}
          <button className="lc-btn" onClick={() => runNow.mutate()} disabled={busy || loopRunning !== true}>
            {runNow.isPending ? '⏳' : '⚡'} Run Now
          </button>
        </span>
      )}
    </div>
  );
}
