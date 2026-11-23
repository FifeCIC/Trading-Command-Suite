/**
 * BestRecordPanel — "has this test ever been better than it is now?" (#1341).
 *
 * ── WHY THIS EXISTS ───────────────────────────────────────────────────────────────────────────────
 * Owner: *"we need to store the best P/L results long term … If we don't have the highest amount we
 * risk deviating from it many times, improving the deviation, but never overall making new ground.
 * Ideally everytime the profit improves, we backup the settings that come with it."*
 *
 * The delta tile beside the totals answers "is this better than the PREVIOUS run". This answers the
 * other question, which nothing could: "is this better than the BEST run ever" — and, crucially, what
 * settings produced that best. A loop that only compares with its own last attempt can improve
 * indefinitely and still be below a result it set a week earlier.
 *
 * ── ⚠️ THE BASIS IS PER DAY, AND IT IS SAID OUT LOUD ─────────────────────────────────────────────
 * The record is decided on net P/L PER MEASURED DAY, never on the total: a five-day run beats a
 * one-day run every time, so a total-based record would simply track how long the window was. Every
 * row here prints the per-day figure first and the raw total beside it, because a derived number must
 * never hide the data it came from.
 *
 * ── ⚠️ THREE STATES, NOT TWO ─────────────────────────────────────────────────────────────────────
 * A server that predates this contract sends no `best`; a first-ever run has `best: null` with a
 * reason; a run that was measured against a record has one. Those are a missing field, a store with
 * nothing in it, and a comparison — and rendering any of them as the others would be a claim about
 * history this component is not in a position to make.
 */
import { Fragment } from 'react';
// The view model lives in `src/core` so its states are testable without a browser (`node --test`).
import { buildBestView, moneySigned } from '../../core/best-record.js';
import './best-record-panel.css';

const money = (n) => (n == null ? '—' : `$${Number(n).toFixed(2)}`);
const pct = (n) => (n == null ? '—' : `${Number(n).toFixed(1)}%`);
const ratio = (n) => (n == null ? '—' : Number(n).toFixed(2));
const when = (iso) => {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
};

export default function BestRecordPanel({ okRuns }) {
  const view = buildBestView(okRuns);
  if (!view || view.state === 'unsupported') return null;

  const changed = (view.settingsDiff ?? []).filter((s) => s.state === 'differs');

  return (
    <section className="brp" aria-label="Best recorded result for this test">
      <header className="brp-head">
        <h2 className="brp-title">Best recorded result</h2>
        <span className={`brp-tag brp-tag--${view.state}`}>
          {view.state === 'new-record' && 'New record'}
          {view.state === 'has-record' && 'Not beaten'}
          {view.state === 'first-run' && 'First recorded run'}
        </span>
      </header>

      <div className="brp-table-wrap">
        <table className="mvp-table">
          <thead>
            <tr>
              <th scope="col">Run</th>
              <th scope="col" className="brp-num">Per day</th>
              <th scope="col" className="brp-num">Total</th>
              <th scope="col" className="brp-num">Days</th>
              <th scope="col" className="brp-num">Trades</th>
              <th scope="col" className="brp-num">Win rate</th>
              <th scope="col" className="brp-num">Profit factor</th>
              <th scope="col">Set</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <th scope="row">Best recorded</th>
              <td className="brp-num brp-strong">{money(view.best?.perDay)}</td>
              <td className="brp-num">{money(view.best?.netPnl)}</td>
              <td className="brp-num">{view.best?.days ?? '—'}</td>
              <td className="brp-num">{view.best?.trades ?? '—'}</td>
              <td className="brp-num">{pct(view.best?.winRate)}</td>
              <td className="brp-num">{ratio(view.best?.profitFactor)}</td>
              <td className="brp-when">{when(view.best?.achievedAt)}</td>
            </tr>
            <tr>
              <th scope="row">This run</th>
              <td className="brp-num brp-strong">{money(view.thisRun.perDay)}</td>
              <td className="brp-num">{money(view.thisRun.netPnl)}</td>
              <td className="brp-num">{view.thisRun.days}</td>
              <td className="brp-num">{view.thisRun.trades ?? '—'}</td>
              <td className="brp-num">{pct(view.thisRun.winRate)}</td>
              <td className="brp-num">{ratio(view.thisRun.profitFactor)}</td>
              <td className="brp-when">now</td>
            </tr>
            {view.previous && view.state === 'new-record' && (
              <tr className="brp-row--beaten">
                <th scope="row">Record it beat</th>
                <td className="brp-num">{money(view.previous.perDay)}</td>
                <td className="brp-num">{money(view.previous.netPnl)}</td>
                <td className="brp-num">{view.previous.days}</td>
                <td className="brp-num" colSpan={2}>—</td>
                <td className="brp-num">—</td>
                <td className="brp-when">{when(view.previous.achievedAt)}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/*
        The reason is always present on the wire, so it is always shown — it is the difference between
        "not beaten" and "we could not compare", and those two look identical without it.
      */}
      {view.because && <p className="brp-because">{view.because}</p>}

      {view.state === 'new-record' && changed.length > 0 && (
        <>
          <h3 className="brp-sub">Settings this record came with</h3>
          <div className="brp-table-wrap">
            <table className="mvp-table">
              <thead>
                <tr>
                  <th scope="col">Setting</th>
                  <th scope="col">Record</th>
                  <th scope="col">Now</th>
                  <th scope="col">State</th>
                </tr>
              </thead>
              <tbody>
                {changed.map((s) => (
                  <Fragment key={s.id}>
                    <tr>
                      <th scope="row"><code>{s.id}</code></th>
                      <td>{s.best ?? '—'}</td>
                      <td>{s.now ?? '—'}</td>
                      <td className="brp-state brp-state--differs">changed</td>
                    </tr>
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
          <p className="brp-foot">
            {changed.length} of {view.settingsDiff.length} setting(s) differ from the ones in force now.
            The record is stored with its own settings, so it can be reproduced.
          </p>
        </>
      )}

      {view.state === 'has-record' && (
        <p className="brp-foot">
          The record stands. Reverting is a decision, not an automatic action — the run above lost to it
          by {moneySigned((view.thisRun.perDay ?? 0) - (view.best?.perDay ?? 0))} per day.
        </p>
      )}
    </section>
  );
}
