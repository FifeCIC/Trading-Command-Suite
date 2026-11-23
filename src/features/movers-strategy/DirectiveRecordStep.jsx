/**
 * DirectiveRecordStep — WHAT EACH DIRECTIVE HAS ACTUALLY SCORED AND PREDICTED.
 *
 * ── WHY THIS STEP EXISTS ─────────────────────────────────────────────────────────────────────────
 * Owner requirement, 2026-11-23: a protocol step showing statistics built from what the directives
 * score, on the understanding that the data is kept long term. It is — `directiveoutcome` holds one row
 * per directive per prediction with the prices that followed, and `GET /api/scoring/edge/report`
 * already summarises it.
 *
 * ── ⚠️ THREE HONESTY CONSTRAINTS, ALL OF THEM LOAD-BEARING ──────────────────────────────────────
 *
 * 1. **THIS IS NOT THIS RUN'S EVIDENCE.** The report is measured across EVERY strategy and symbol in the
 *    window, not on the day being backtested. The window and the sample are printed above the table for
 *    exactly that reason — a reader who assumes these are the run's numbers will mis-read the whole step.
 * 2. **ACCURACY IS NOT PROFIT.** `hitRate` is directional accuracy: did price move the way the signal
 *    said. The API carries a separate `pnlEvidence` block precisely so the two are never confused, and
 *    this table prints it as its own line rather than letting a hit rate imply a P/L.
 * 3. **A SMALL SAMPLE GETS ITS VERDICT, NOT ITS NUMBER.** The API already grades every estimate
 *    (`insufficient` / `possible-edge` / …) with a confidence interval. Showing a bare `100%` on n=3
 *    would be the plausible-output defect this repo keeps paying for, so the verdict is shown BESIDE the
 *    rate and the interval is always visible.
 *
 * ⚠️ WHICH DIRECTIVES BELONG TO THIS PROTOCOL comes from the run's own bars (each bar carries the
 * directives that scored on it), so the step marks membership rather than assuming it. When a run has no
 * breakdown the membership column says so — silently listing every directive as if it were the
 * protocol's would be a fabricated row.
 */
import { useQuery } from '@tanstack/react-query';
import { apiGet } from '../../core/api/client';
import NoticeBlock from '../../components/NoticeBlock.jsx';
import { noticeFromError } from '../../core/notices/from-error.js';
import { protocolDirectiveIds } from '../../core/movers-funnel.js';

const pct = (v) => (typeof v === 'number' ? `${(v * 100).toFixed(1)}%` : '—');
const ci = (e) => (e?.ci95 ? `${(e.ci95.low * 100).toFixed(0)}–${(e.ci95.high * 100).toFixed(0)}%` : '—');

const VERDICT_TONE = {
  'possible-edge': 'mvp-pos',
  insufficient: 'mvp-muted',
  negative: 'mvp-neg',
};

export default function DirectiveRecordStep({ entries, days: windowDays = 30 }) {
  const report = useQuery({
    queryKey: ['scoring', 'edge', 'report', windowDays],
    queryFn: () => apiGet(`/api/scoring/edge/report?days=${encodeURIComponent(windowDays)}`),
    staleTime: 5 * 60 * 1000,
  });

  const mine = protocolDirectiveIds(entries);

  if (report.isPending) {
    return <p className="mvp-note">Reading the stored directive outcomes…</p>;
  }
  if (report.isError) {
    return (
      <NoticeBlock
        notice={noticeFromError(report.error, 'TCS-SYS-002', {
          operation: 'load the directive outcome statistics',
        })}
      />
    );
  }

  const data = report.data ?? {};
  const rows = Array.isArray(data.byDirective) ? data.byDirective : [];
  if (rows.length === 0) {
    return (
      <p className="mvp-note">
        No directive outcome has matured in the last {windowDays} days, so there is nothing to
        summarise. The table fills as predictions reach their horizons.
      </p>
    );
  }

  // Protocol directives first — the question this step exists to answer — then the rest by sample size.
  const sorted = [...rows].sort((a, b) => {
    const mineA = mine.has(a.directiveId) ? 1 : 0;
    const mineB = mine.has(b.directiveId) ? 1 : 0;
    if (mineA !== mineB) return mineB - mineA;
    return (b.pooled?.n ?? 0) - (a.pooled?.n ?? 0);
  });

  /**
   * ⚠️ THE SAMPLE WARNING IS DERIVED, NOT DUMPED. The API also returns three caveats; two of them
   * (pooled accuracy, costs excluded) are already answered BY THIS TABLE — the direction split is two
   * columns, and the P/L line is separate. The one that changes how the table must be read is the sample
   * breadth, so that is printed and the rest are not repeated. A caveat list beside a table is the thing
   * the owner asked to have removed.
   */
  const days = Number(data.sample?.distinctDays ?? 0);
  const thinSample = days > 0 && days <= 3;

  return (
    <>
      <p className="mvp-caption">
        Measured over the last <strong>{data.window?.days ?? windowDays} days</strong> across every strategy and
        symbol — <strong>not</strong> this run’s evidence. Sample: {data.sample?.maturedRows ?? 0} matured
        predictions over {data.sample?.distinctSymbols ?? 0} symbols, {data.sample?.distinctDays ?? 0} days.
        A hit rate is directional accuracy, not profit.
      </p>

      {thinSample && (
        <p className="mvp-note mvp-note--warn">
          <strong>The sample is {days} calendar day{days === 1 ? '' : 's'}.</strong> That is one market
          regime, so a verdict below describes the regime as much as the directive — read it as a
          placeholder, not a property of the system.
        </p>
      )}

      <div className="mvp-scroll">
        <table className="mvp-table">
          <thead>
            <tr>
              <th scope="col">Directive</th>
              <th scope="col">In this protocol</th>
              <th scope="col" className="mvp-num">Mean score</th>
              <th scope="col" className="mvp-num">Bullish hit</th>
              <th scope="col" className="mvp-num">Bearish hit</th>
              <th scope="col" className="mvp-num">n</th>
              <th scope="col">Verdict</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((d) => {
              const pooled = d.pooled ?? {};
              const isMine = mine.has(d.directiveId);
              return (
                <tr key={d.directiveId} className={isMine ? 'step-in-protocol' : ''}>
                  <th scope="row" className="mvp-nowrap"><code>{d.directiveId}</code></th>
                  <td className="mvp-nowrap">
                    {mine.size === 0
                      ? <span className="mvp-muted">unknown</span>
                      : isMine ? 'yes' : <span className="mvp-muted">—</span>}
                  </td>
                  <td className="mvp-num">{typeof d.avgScore === 'number' ? d.avgScore.toFixed(1) : '—'}</td>
                  <td className="mvp-num">
                    {pct(d.bullish?.hitRate)}
                    <span className="mvp-muted"> {d.bullish ? `n=${d.bullish.n}` : ''}</span>
                  </td>
                  <td className="mvp-num">
                    {pct(d.bearish?.hitRate)}
                    <span className="mvp-muted"> {d.bearish ? `n=${d.bearish.n}` : ''}</span>
                  </td>
                  <td className="mvp-num">{pooled.n ?? '—'}</td>
                  <td className="mvp-nowrap">
                    <span className={VERDICT_TONE[pooled.verdict] ?? ''}>
                      {pooled.verdict ?? '—'}
                    </span>
                    <span className="mvp-muted"> {ci(pooled)}</span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/*
        ⚠️ THE P/L LINE IS SEPARATE ON PURPOSE. Directional accuracy and profitability are different
        measurements and the API keeps them apart; printing them in one table would let a 94% hit rate read
        as a profitable strategy.
      */}
      {data.pnlEvidence && (
        <p className="mvp-foot">
          P/L evidence is measured separately: {data.pnlEvidence.note
            || `${data.pnlEvidence.matured ?? data.pnlEvidence.rows ?? 0} trade(s) with a settled P/L.`}
        </p>
      )}
    </>
  );
}
