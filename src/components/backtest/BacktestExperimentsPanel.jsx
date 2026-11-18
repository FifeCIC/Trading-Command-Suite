import { useQuery } from '@tanstack/react-query';
import NoticeBlock from '../NoticeBlock';
import { noticeFromError } from '../../core/notices/from-error.js';
import {
  summariseExperiments,
  EXPERIMENT_STATE_LABEL,
  EXPERIMENT_STATE_NEXT_STEP,
} from '../../core/backtest/experiment-states.js';

/**
 * BacktestExperimentsPanel — the registry that #1295 found was 0.75% adopted.
 *
 * ── WHY THIS PAGE EXISTS ────────────────────────────────────────────────────────────────────────
 * Owner, 2026-11-18: *"Are you registering all A/B tests somewhere so they can be tracked by both
 * user and agentic AI rather than forgotten about? I'm concerned at the huge amount of tests being
 * built… I can't afford to spend tokens for every step."*
 *
 * Measured before this: 1,722 backtest runs, **13** filed into an experiment, and 6 of 11
 * experiments were empty shells. The automation registry already had a page (`/trading/ab-strategies`);
 * this one had only a command, so a comparison existed only if someone remembered it.
 *
 * ── THE RULE IS NOT WRITTEN HERE ───────────────────────────────────────────────────────────────
 * `summariseExperiments()` lives in `src/core/backtest/experiment-states.js` and is the SAME function
 * `scripts/report-experiments.cjs --backtest` calls. A second copy in this component would agree
 * today and drift at the first tuning — this repo's most expensive failure shape.
 */

const STATE_CLASS = {
  SHELL: 'bx-state--shell',
  SINGLE: 'bx-state--single',
  AUTO: 'bx-state--auto',
  COMPARISON: 'bx-state--comparison',
};

async function fetchExperiments() {
  const res = await fetch('/api/backtest/experiments');
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export default function BacktestExperimentsPanel() {
  const query = useQuery({
    queryKey: ['backtest', 'experiments'],
    queryFn: fetchExperiments,
    staleTime: 30_000,
  });

  // ⚠️ THREE STATES, NEVER COLLAPSED. A failed read must not render as "no experiments" — that is
  // how a registry silently empties and nobody goes looking. Errors come from the notice registry
  // (#826), never from prose: a hand-written error string fails `validate-notices.cjs`.
  if (query.isLoading) return <p className="bx-note">Loading the registry…</p>;
  if (query.isError) {
    return (
      <NoticeBlock
        notice={noticeFromError(query.error, 'TCS-SYS-007', {
          operation: 'read the backtest experiment registry',
        })}
      />
    );
  }

  let summary;
  try {
    summary = summariseExperiments(query.data);
  } catch (err) {
    return (
      <NoticeBlock
        notice={noticeFromError(err, 'TCS-SYS-007', {
          operation: 'read the backtest experiment registry',
        })}
      />
    );
  }

  return (
    <div className="bx-panel">
      <p className="bx-lede">
        {summary.total} experiment{summary.total === 1 ? '' : 's'} across {summary.protocols} protocol
        {summary.protocols === 1 ? '' : 's'}. A run that names no experiment is now filed automatically
        into an <strong>unfiled bucket</strong> for its protocol, so nothing is lost between sessions.
      </p>

      <div className="bx-counts">
        {summary.needsAttention > 0 && (
          <span className="bx-count bx-count--attention">
            {summary.needsAttention} need attention
          </span>
        )}
        <span className="bx-count">{summary.comparisons} comparison{summary.comparisons === 1 ? '' : 's'}</span>
        <span className="bx-count">{summary.singles} one-run</span>
        <span className="bx-count">{summary.shells} never used</span>
        <span className="bx-count">{summary.autos} unfiled bucket{summary.autos === 1 ? '' : 's'}</span>
      </div>

      {summary.rows.length === 0 ? (
        <p className="bx-note">No experiment exists yet. Run a backtest and one will be created for you.</p>
      ) : (
        <ul className="bx-list">
          {summary.rows.map((row) => (
            <li key={row.id} className={`bx-row ${STATE_CLASS[row.state] ?? ''}`}>
              <div className="bx-row-head">
                <span className="bx-state">{EXPERIMENT_STATE_LABEL[row.state]}</span>
                <span className="bx-runs">
                  {row.runs} run{row.runs === 1 ? '' : 's'}
                </span>
                {row.ageDays !== null && <span className="bx-age">{row.ageDays}d old</span>}
              </div>
              <p className="bx-label">{row.label}</p>
              <p className="bx-meta">
                {row.protocolId} · status {row.status}
              </p>
              {EXPERIMENT_STATE_NEXT_STEP[row.state] && (
                <p className="bx-next">{EXPERIMENT_STATE_NEXT_STEP[row.state]}</p>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
