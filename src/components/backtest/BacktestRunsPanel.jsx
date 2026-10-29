/**
 * BacktestRunsPanel — the 26 completed backtests that were invisible (#823 Stage 2).
 * =================================================================================
 *
 * Pipeline position:
 *   run      POST /api/backtest/run            → stores a `backtestrun` row (the page already did this)
 *   list     GET  /api/backtest/runs           → THIS panel. Nothing called it before.
 *   compare  POST /api/backtest/runs/compare   → THIS panel. Nothing called it before.
 *   delete   DELETE /api/backtest/runs/:runId  → offered per row, with a confirm step.
 *
 * ⚠️ WHY THIS EXISTS. Measured 2026-10-15: **26 runs were stored and served**, and the frontend had
 * **zero references** to the list. The engine worked, the history existed, and the owner could not
 * see any of it — which is a plausible reason backtesting has felt unproductive. The endpoints were
 * never missing; the surface was. This is the `#1123`/`#1124` class of defect (an agent achieves
 * something the UI cannot repeat) found inside backtesting itself.
 *
 * ⚠️ WHY THIS IS A PANEL AND NOT A NEW PAGE. Same reasoning as `BacktestPeriodsPanel` and
 * `shared-core.instructions.md`: the engine, the periods panel and this all hang off the backtest
 * page, and a fourth surface for the same job is churn. #823 Stage 1's own instruction was
 * *"do not propose a new page… the risk is designing a second backtest view while the first sits
 * unused."*
 *
 * ⚠️ THE HONESTY RULES, AND THEY ARE NOT DECORATION. The compare endpoint is deliberately careful,
 * and this panel must not undo that care:
 *   • `signalWinRatePct` is the percent of entry SIGNALS that were profitable — it is **NOT** a
 *     trade win rate. The two are different populations and are labelled separately, always.
 *   • `totalSignals: null` means NOT RECORDED (pre-2026-09-23 runs). It is rendered as
 *     "not recorded", **never as 0** — "nobody recorded it" and "there were none" are different
 *     facts (`development-philosophy` §7).
 *   • A `verdict` of `insufficient-data` or `sample-unknown` is **not** a winner and is never
 *     styled like one. The endpoint refuses to name a winner on a thin sample; this must not
 *     "help" by implying one.
 *   • When the sides are not like-for-like, the endpoint says so. That warning is rendered
 *     beside the numbers, not suppressed.
 *
 * ⚠️ NO SCORING MATHS IS TOUCHED. This panel reads results and compares them. It changes no
 * threshold, weight, gate or cadence (`maths-change-requires-ab.instructions.md`).
 *
 * ⚠️ The table reuses the GLOBAL `.bt-table` (src/core/tables.css). `validate-duplication.cjs`
 * fails in prebuild on a locally restated copy — see the note in `backtest-periods-panel.css`.
 */

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiPost, apiDelete } from '../../core/api/client';
import NoticeBlock from '../NoticeBlock';
import { noticeFromError } from '../../core/notices/from-error.js';
import { useSort, SortableTh } from '../../core/use-sort.jsx';
import './backtest-panel-base.css';
import './backtest-runs-panel.css';

/** `2026-09-15T00:00:00.000Z` → `2026-09-15 00:00` (UTC). A date the reader can compare at a glance. */
function shortStamp(iso) {
  if (!iso) return '—';
  return String(iso).slice(0, 16).replace('T', ' ');
}

/**
 * A number that may legitimately be absent.
 *
 * ⚠️ `null` renders as "not recorded" and `0` renders as `0`. Collapsing them is the defect this
 * whole repo keeps re-finding: an empty list and a failed query must never look the same.
 */
function Num({ value, digits = 2, suffix = '' }) {
  if (value === null || value === undefined) {
    return <span className="btr-none">not recorded</span>;
  }
  if (!Number.isFinite(Number(value))) {
    return <span className="btr-none">not recorded</span>;
  }
  return <>{Number(value).toFixed(digits)}{suffix}</>;
}

/** A P&L figure, toned by sign. Colour is never the ONLY signal — the sign is printed too. */
function Pnl({ value }) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) {
    return <span className="btr-none">not recorded</span>;
  }
  const n = Number(value);
  const tone = n > 0 ? 'is-profit' : n < 0 ? 'is-loss' : '';
  return <span className={tone}>{n > 0 ? '+' : ''}{n.toFixed(2)}</span>;
}

export default function BacktestRunsPanel({ showTrades = true }) {
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState([]);
  const [confirmDelete, setConfirmDelete] = useState(null);

  const runsQuery = useQuery({
    queryKey: ['backtest-runs'],
    queryFn: () => apiGet('/api/backtest/runs?limit=50'),
    staleTime: 15_000,
  });

  const compareMutation = useMutation({
    mutationFn: (runIds) => apiPost('/api/backtest/runs/compare', { runIds }),
  });

  const deleteMutation = useMutation({
    mutationFn: (runId) => apiDelete(`/api/backtest/runs/${runId}`),
    onSuccess: () => {
      setConfirmDelete(null);
      setSelected((s) => s.filter((id) => id !== confirmDelete));
      queryClient.invalidateQueries({ queryKey: ['backtest-runs'] });
    },
  });

  // The endpoint takes an array; guard the shape rather than assuming it. A response that is not
  // an array is reported, not silently rendered as "no runs" — that collapse is the defect above.
  const runs = useMemo(() => {
    const r = runsQuery.data;
    if (!r) return [];
    return Array.isArray(r) ? r : Array.isArray(r.runs) ? r.runs : [];
  }, [runsQuery.data]);

  const shapeUnexpected =
    runsQuery.data !== undefined &&
    runs.length === 0 &&
    !Array.isArray(runsQuery.data.runs);

  function toggle(runId) {
    setSelected((s) =>
      s.includes(runId) ? s.filter((x) => x !== runId) : s.length >= 4 ? s : [...s, runId],
    );
  }

  const comparison = compareMutation.data;
  const canCompare = selected.length >= 2 && !compareMutation.isPending;
  /** Newest first by default — the run just made is the one a reader is looking for. */
  const sort = useSort(runs, 'createdAt', 'desc');

  return (
    <section className="bt-panel btr" aria-labelledby="btr-heading">
      <div className="btr-head">
        <h3 id="btr-heading">Completed runs</h3>
        <span className="btr-count">
          {runsQuery.isLoading ? '…' : `${runs.length} run${runs.length === 1 ? '' : 's'}`}
        </span>
      </div>

      <p className="btr-sub">
        Every backtest the engine has stored. Select two or more to compare them — the comparison
        refuses to name a winner when a side is too small to judge, and says so.
      </p>

      {/* ── The three outcomes are kept DISTINCT: loading, failed, empty, and present. ── */}
      {runsQuery.isLoading && <p className="btr-empty">Loading runs…</p>}

      {runsQuery.error && (
        <div className="btr-notice">
          <NoticeBlock notice={noticeFromError(runsQuery.error)} />
          <button type="button" className="bt-panel-btn" onClick={() => runsQuery.refetch()}>
            Retry
          </button>
        </div>
      )}

      {shapeUnexpected && (
        <p className="btr-empty">
          The runs endpoint answered with an unexpected shape, so this list cannot be trusted.
          That is a defect, not an empty history.
        </p>
      )}

      {!runsQuery.isLoading && !runsQuery.error && runs.length === 0 && !shapeUnexpected && (
        <p className="btr-empty">
          No runs are stored yet. Run a backtest above and it will appear here.
        </p>
      )}

      {runs.length > 0 && (
        <>
          <div className="btr-table-wrap bt-table-wrap">
            <table className="bt-table">
              <caption className="sr-only">
                Stored backtest runs. Select rows to compare. Signal win rate is a rate on entry
                signals, and is not a trade win rate.
              </caption>
              <thead>
                <tr>
                  <th scope="col">Compare</th>
                  <SortableTh col="symbol" label="Symbol" api={sort} />
                  <SortableTh col="protocolId" label="Protocol" api={sort} />
                  <SortableTh col="timeframe" label="TF" api={sort} />
                  <th scope="col">Period</th>
                  {/*
                    ⚠️ TRADE COLUMNS ARE HIDDEN ON THE PROTOCOLS PAGE (owner direction, 2026-10-27:
                    *"This view should not have anything relating to trades"*). A protocol run is
                    scores-only, so `Trades` and `P&L` can only read 0 / +0.00 — columns that look like
                    a result and carry none. On the Strategies page the same columns are the point.
                  */}
                  {showTrades && <SortableTh col="totalTrades" label="Trades" api={sort} className="bt-num" />}
                  <SortableTh col="totalSignals" label="Signals" api={sort} className="bt-num" />
                  <SortableTh col="signalWinRatePct" label="Signal win %" api={sort} className="bt-num" />
                  {showTrades && <SortableTh col="totalPnl" label="P&amp;L" api={sort} className="bt-num" />}
                  {/*
                    ⚠️ PROVENANCE, NOT DECORATION (#1144). `iteration` is blank for a one-off run, and
                    on a run that belongs to a loop it is the ONLY way to know that this row and the one
                    above it are two attempts at the same thing rather than two unrelated measurements.
                    `Cfg` is the version of the protocol's directive overrides that scored it — without
                    it, two runs differing only in configuration look identical here.
                  */}
                  <th scope="col">Iter</th>
                  <th scope="col" title="Version of this protocol's directive overrides that scored the run">Cfg</th>
                  <SortableTh col="createdAt" label="Created" api={sort} />
                  <th scope="col"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {sort.sorted.map((r) => (
                  <tr key={r.id} className={selected.includes(r.id) ? 'btr-row-selected' : ''}>
                    <td>
                      <input
                        type="checkbox"
                        checked={selected.includes(r.id)}
                        onChange={() => toggle(r.id)}
                        aria-label={`Select run ${r.symbol} ${r.protocolId} ${r.timeframe} for comparison`}
                      />
                    </td>
                    <td className="btr-strong">{r.symbol}</td>
                    <td>{r.protocolId}</td>
                    <td className="btr-mono">{r.timeframe}</td>
                    <td className="btr-mono btr-window">{r.period}</td>
                    {showTrades && <td className="btr-mono">{r.totalTrades}</td>}
                    <td className="btr-mono"><Num value={r.totalSignals} digits={0} /></td>
                    {/* ⚠️ Named "signal" win rate in the header — it is not a trade win rate. */}
                    <td className="btr-mono"><Num value={r.signalWinRatePct} digits={1} suffix="%" /></td>
                    {showTrades && <td className="btr-mono"><Pnl value={r.totalPnl} /></td>}
                    {/*
                      ⚠️ `—` and `1` must not look alike: `—` is "not part of a loop", `1` is "the first
                      attempt". Same for `Cfg` — `—` means NOT RECORDED (a run stored before the column),
                      while `v0` means "no override has ever been recorded for this protocol".
                    */}
                    <td className="btr-mono" title={r.experimentId ? `experiment ${String(r.experimentId).slice(0, 8)}` : 'not part of a loop'}>
                      {r.iteration ?? '—'}
                    </td>
                    <td className="btr-mono" title={r.configVersion == null ? 'not recorded' : `override version ${r.configVersion}`}>
                      {r.configVersion == null ? '—' : `v${r.configVersion}`}
                    </td>
                    <td className="btr-mono btr-window">{shortStamp(r.createdAt)}</td>
                    <td>
                      {confirmDelete === r.id ? (
                        <span className="btr-confirm">
                          <button
                            type="button"
                            className="bt-panel-btn bt-panel-btn-sm btr-btn-danger"
                            disabled={deleteMutation.isPending}
                            onClick={() => deleteMutation.mutate(r.id)}
                          >
                            Confirm
                          </button>
                          <button
                            type="button"
                            className="bt-panel-btn bt-panel-btn-sm"
                            onClick={() => setConfirmDelete(null)}
                          >
                            Cancel
                          </button>
                        </span>
                      ) : (
                        <button
                          type="button"
                          className="bt-panel-btn bt-panel-btn-sm"
                          onClick={() => setConfirmDelete(r.id)}
                        >
                          Delete
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="btr-actions">
            <button
              type="button"
              className="bt-panel-btn"
              disabled={!canCompare}
              onClick={() => compareMutation.mutate(selected)}
            >
              {compareMutation.isPending ? 'Comparing…' : `Compare ${selected.length || ''}`.trim()}
            </button>
            {selected.length > 0 && (
              <button type="button" className="bt-panel-btn" onClick={() => setSelected([])}>
                Clear selection
              </button>
            )}
            <span className="btr-hint">
              Select 2–4 runs. Only runs that measure the same way are a fair comparison.
            </span>
          </div>
        </>
      )}

      {deleteMutation.error && (
        <div className="btr-notice">
          <NoticeBlock notice={noticeFromError(deleteMutation.error)} />
        </div>
      )}

      {compareMutation.error && (
        <div className="btr-notice">
          <NoticeBlock notice={noticeFromError(compareMutation.error)} />
        </div>
      )}

      {comparison && <Comparison result={comparison} showTrades={showTrades} />}
    </section>
  );
}

/**
 * The comparison result.
 *
 * ⚠️ THE VERDICT IS RENDERED AS A SENTENCE, NOT AS A WINNER BADGE. `insufficient-data` and
 * `sample-unknown` are refusals, and a checkmark beside a refusal would invert the endpoint's
 * whole purpose (#929: "noise wearing a result's clothes").
 */
function Comparison({ result, showTrades = true }) {
  const runs = Array.isArray(result?.runs) ? result.runs : [];
  const verdict = result?.verdict ?? null;
  const best = result?.best ?? null;

  if (runs.length === 0) {
    return (
      <div className="btr-compare">
        <h4>Comparison</h4>
        <p className="btr-empty">
          The comparison returned no runs. That is a refusal, not a result.
        </p>
      </div>
    );
  }

  return (
    <div className="btr-compare">
      <h4>Comparison</h4>

      {verdict?.verdict === 'winner' && best && (
        <p className="btr-verdict btr-verdict-ok">
          Best on <b>{verdict.metric ?? best.metric}</b>: run <code>{best.id.slice(0, 8)}</code> at{' '}
          <b>{Number(best.value).toFixed(2)}</b> — on a sample of <b>{best.sample}</b>.
        </p>
      )}

      {verdict && verdict.verdict !== 'winner' && (
        <p className="btr-verdict btr-verdict-hold">
          {verdict.verdict === 'insufficient-data' && (
            <>
              <b>Not enough data to name a winner.</b> This is a refusal, not a tie — the two sides
              are too small to tell apart.
            </>
          )}
          {verdict.verdict === 'sample-unknown' && (
            <>
              <b>Cannot judge.</b> The sample size for one or both sides was never recorded, so no
              comparison is possible.
            </>
          )}
          {verdict.verdict === 'no-runs' && (
            <>
              <b>No runs to compare.</b>
            </>
          )}
          {verdict.requiredPerSide != null && (
            <span className="btr-verdict-sub">
              {' '}Needs {verdict.requiredPerSide} per side; has{' '}
              {Object.entries(verdict.n ?? {})
                .map(([k, v]) => `${k.slice(0, 8)}=${v ?? 'unknown'}`)
                .join(', ') || 'unknown'}.
            </span>
          )}
        </p>
      )}

      {verdict?.comparabilityWarning && (
        <p className="btr-warn">
          ⚠️ {verdict.comparabilityWarning}
        </p>
      )}

      <div className="btr-table-wrap bt-table-wrap">
        <table className="bt-table">
          <caption className="sr-only">Side-by-side metrics for the selected runs.</caption>
          <thead>
            <tr>
              <th scope="col">Run</th>
              <th scope="col">Symbol</th>
              <th scope="col">Protocol</th>
              <th scope="col">TF</th>
{showTrades && (
                <>
                  <th scope="col">Trades</th>
                  <th scope="col">Counted</th>
                  <th scope="col">Trade win %</th>
                </>
              )}
              <th scope="col">Signals</th>
              <th scope="col">Signal win %</th>
              {showTrades && <th scope="col">P&amp;L</th>}
              <th scope="col">Profit factor</th>
              <th scope="col">Sharpe</th>
              <th scope="col">Max DD %</th>
              {showTrades && <th scope="col">Avg/trade %</th>}
            </tr>
          </thead>
          <tbody>
            {runs.map((r) => (
              <tr key={r.id}>
                <td className="btr-mono">{r.id.slice(0, 8)}</td>
                <td className="btr-strong">{r.symbol}</td>
                <td>{r.protocolId}</td>
                <td className="btr-mono">{r.timeframe}</td>
{showTrades && (
                  <>
                    <td className="btr-mono">{r.totalTrades}</td>
                    {/* ⚠️ A disagreement between the two is REPORTED by the endpoint; showing both
                        counts side by side is how a reader sees it rather than being told it is fine. */}
                    <td className="btr-mono">{r.tradesCounted}</td>
                    <td className="btr-mono"><Num value={r.tradeWinRatePct} digits={1} suffix="%" /></td>
                  </>
                )}
                <td className="btr-mono"><Num value={r.totalSignals} digits={0} /></td>
                <td className="btr-mono"><Num value={r.signalWinRatePct} digits={1} suffix="%" /></td>
                {showTrades && <td className="btr-mono"><Pnl value={r.totalPnl} /></td>}
                <td className="btr-mono"><Num value={r.profitFactor} digits={2} /></td>
                <td className="btr-mono"><Num value={r.sharpeRatio} digits={2} /></td>
                <td className="btr-mono"><Num value={r.maxDrawdownPct} digits={1} suffix="%" /></td>
                {showTrades && <td className="btr-mono"><Num value={r.avgTradePnlPct} digits={2} suffix="%" /></td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* ⚠️ The honesty statement, carried from #823's acceptance criteria onto the surface itself. */}
      <p className="btr-caveat">
        These are historical runs of the configuration they were recorded with. Comparing them shows
        what each <em>did</em> — it does not show what a different configuration <em>would</em> have
        done. "Trade win %" is trades; "Signal win %" is entry signals. They are different
        populations and neither replaces the other.
      </p>
    </div>
  );
}
