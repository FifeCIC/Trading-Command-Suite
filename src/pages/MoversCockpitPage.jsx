/**
 * MoversCockpitPage — `/lab/movers-cockpit`: THE SKELETON, not the finished cockpit.
 *
 * ── WHY A SKELETON IS THE RIGHT FIRST BUILD ─────────────────────────────────────────────────────
 * The owner's note, 2026-11-20: *"I would like it planned at least, and maybe very soon create a
 * skeleton that shares a core class with the existing cockpit view so that I can grow a library for
 * triple screen services."*
 *
 * A skeleton that renders the SHAPE and refuses to fake the CONTENT is the version that stays honest
 * while it is empty. Every column below states which META.Stack phase it is, what it will answer, and —
 * where nothing is built — that it is unbuilt. Nothing here renders a zero.
 *
 * ⚠️ TWO COLUMNS DO RENDER, and only because their data already exists and comes from the same endpoint
 * the backtest page uses: `bots` (the trade-management configuration) and `db` (the stored run). That is
 * enough to prove the seam works without inventing a second implementation of anything.
 *
 * ⚠️ IT DOES NOT DUPLICATE THE BACKTEST PAGE. The page answers "what happened on this session?" in a
 * vertical reading order. A cockpit answers "what is the state of each stage RIGHT NOW?" across columns.
 * The shared thing is the phase list (`src/core/pipeline-phases.js`), which is also what stops the two
 * from silently diverging.
 *
 * ⚠️ NO RUN IS LAUNCHED FROM HERE. A cockpit is a view; starting a backtest belongs on the page that
 * owns the form. This page reads the last run the user made in this tab (session storage), which is
 * deliberately not persisted — a skeleton must not create a second source of truth.
 */
import { useMemo, useState } from 'react';
import CockpitPanelCard from '../components/CockpitPanelCard.jsx';
import WhyPopover from '../components/WhyPopover.jsx';
import { buildColumnSpec, columnSummary } from '../core/cockpit/column-spec';
import './movers-cockpit.css';

const RUN_KEY = 'tcs:movers-cockpit:last-run';

/** The last run the page produced, if the reader came here from it. */
function readLastRun() {
  try {
    const raw = window.sessionStorage.getItem(RUN_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

const fmtMoney = (n) => (n == null || Number.isNaN(Number(n)) ? '—' : Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }));

export default function MoversCockpitPage() {
  const run = useMemo(readLastRun, []);
  const [showUnbuilt, setShowUnbuilt] = useState(true);

  /**
   * The spec. `ready` needs a renderer, and the two that have one are the two whose data already exists
   * and is already fetched by the page that produced the run.
   */
  const spec = useMemo(
    () =>
      buildColumnSpec({
        data: {
          state: 'ready',
          renderer: () => (
            <CockpitPanelCard
              title="Session"
              subtitle={run?.answerDate ?? 'no run in this tab'}
              rows={[
                ['Dataset', run?.datasetName ?? '—'],
                ['Candidates', run?.candidates?.length ?? '—'],
                ['Timeframe', run?.timeframe ?? '—'],
              ]}
            />
          ),
        },
        providers: { state: 'absent', note: 'A stored-bars run has no provider in flight; nothing to show.' },
        directives: { state: 'skeleton', note: 'needs the per-bar breakdown as a live column — the backtest page shows it today.' },
        protocols: { state: 'skeleton', note: 'needs the group split and gate verdict as a live column.' },
        scoring: { state: 'skeleton', note: 'needs the score series; the renderer would be the same table the page already has.' },
        signals: { state: 'skeleton', note: 'needs the ladder; currently derived on the page from the same run.' },
        selection: { state: 'skeleton', note: 'needs the day list and pick; the data exists in the run payload.' },
        bots: {
          state: 'ready',
          renderer: () => (
            <CockpitPanelCard
              title="Configuration"
              subtitle={run?.tradeConfig?.bot?.name ?? 'engine defaults'}
              badge={run?.tradeConfig?.bot ? { text: 'bot', tone: 'long' } : { text: 'defaults', tone: 'warn' }}
              rows={(run?.tradeConfig?.fields ?? [])
                .filter((f) => f.applied)
                .slice(0, 6)
                .map((f) => [f.label, `${f.value ?? '—'}${f.unit ?? ''}`])}
              meta={run?.tradeConfig?.bot ? `${run.tradeConfig.resolvedBy} · ${run.tradeConfig.bot.active ? 'active' : 'inactive'}` : null}
            />
          ),
        },
        automation: { state: 'skeleton', note: 'needs a per-bar decision column — the engine records none yet (#1323).' },
        execution: { state: 'skeleton', note: 'needs the executions table as a column.' },
        portfolio: {
          state: 'ready',
          renderer: () => (
            <CockpitPanelCard
              title="Outcome"
              tone={run?.totals?.netPnl > 0 ? 'up' : run?.totals?.netPnl < 0 ? 'down' : null}
              rows={[
                ['Trades', run?.totals?.trades ?? '—'],
                ['Win %', run?.totals?.winRate != null ? `${Number(run.totals.winRate).toFixed(1)}%` : '—'],
                ['Net P/L', fmtMoney(run?.totals?.netPnl)],
              ]}
            />
          ),
        },
        risk: { state: 'skeleton', note: 'needs the risk multiplier series as a column.' },
        db: {
          state: 'ready',
          renderer: () => (
            <CockpitPanelCard
              title="Stored run"
              rows={[['Run id', run?.perSymbol?.[0]?.detail?.runId ?? '—']]}
              meta={run ? 'reopen it from the backtest page' : 'no run yet'}
            />
          ),
        },
        alerts: { state: 'absent', note: 'A backtest raises no alerts; the stage does not apply to this surface.' },
        'bridge-mt5': { state: 'absent', note: 'A run places no order, so no bridge is involved.' },
      }),
    [run],
  );

  const shown = showUnbuilt ? spec.columns : spec.columns.filter((c) => c.state !== 'skeleton');
  const unbuilt = spec.columns.filter((c) => c.state === 'skeleton').length;

  return (
    <div className="mck-page">
      <header className="mck-head">
        <h2 className="mck-title">
          Movers cockpit <span className="mck-muted">skeleton</span>
          <WhyPopover title="What this page is">
            A column per META.Stack stage, laid out for a wide or multi-monitor view. It is a SKELETON:
            the shape is settled and the columns that can render from data already do. Everything else
            says it is unbuilt rather than showing a zero.
          </WhyPopover>
        </h2>
        <div className="mck-head-actions">
          <span className="mck-summary">{columnSummary(spec.columns)}</span>
          {unbuilt > 0 && (
            <button
              type="button"
              className="mck-toggle"
              aria-pressed={showUnbuilt}
              onClick={() => setShowUnbuilt((v) => !v)}
            >
              {showUnbuilt ? 'Hide' : 'Show'} unbuilt
            </button>
          )}
          <a className="mck-back" href="/lab/movers-strategy-backtest">← Backtest</a>
        </div>
      </header>

      {spec.problems.length > 0 && (
        <ul className="mck-problems" role="alert">
          {spec.problems.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      )}

      {!run && (
        <p className="mck-empty">
          No run in this tab yet. Run a day on the{' '}
          <a href="/lab/movers-strategy-backtest">backtest page</a> and the two live columns here fill in;
          the rest stay declared until their renderers exist.
        </p>
      )}

      <div className="mck-columns" role="list">
        {shown.map((col) => (
          <section
            key={col.id}
            role="listitem"
            className={`mck-col mck-col--${col.state}`}
            aria-label={`${col.label} column`}
          >
            <header className="mck-col-head">
              <span className="mck-col-label">{col.label}</span>
              <span className={`mck-col-state mck-col-state--${col.state}`}>{col.state}</span>
            </header>

            {col.state === 'ready' && col.renderer
              ? col.renderer()
              : (
                <div className="mck-placeholder">
                  <p className="mck-placeholder-what">{col.provides}</p>
                  <p className="mck-placeholder-note">{col.note}</p>
                </div>
              )}
          </section>
        ))}
      </div>
    </div>
  );
}
