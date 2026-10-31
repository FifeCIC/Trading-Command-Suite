import InfoNote from '../InfoNote';
/**
 * StopSweepPanel — "is the stop too distant?", screened against a run's recorded excursions.
 *
 * Owner direction, 2026-10-29: *"if 70% of positions that dropped into the red by X amount then triggered
 * the SL, that would tell us that we're losing money because the SL is too distant. The simulated-stop-loss
 * could be stricter."*
 *
 * ⚠️ IT POSTS, IT DOES NOT CALCULATE. `stopSweep` lives in `nest/src/modules/backtest/score-maths.ts` and
 * is served by `POST /api/backtest/stop-sweep`. `src/core/backtest-totals.js` carries a standing
 * instruction against client-side A/B arithmetic, and a sweep a reader sees in a panel must be the same
 * sweep an agent can call — otherwise the two drift and the one with the story wins.
 *
 * ⚠️ THE NUMBERS ARE A FIRST-ORDER SCREEN, AND THE PANEL SAYS SO IN PLACE. It answers "which trades'
 * recorded adverse excursion would have fired this stop, and what would those trades have realised instead".
 * It cannot see the path a SURVIVING trade took, so the net column is an estimate. The exact answer is a
 * re-run with `stopPlan`. A screen presented as a measurement is the defect this page keeps fixing.
 *
 * ⚠️ `winnersCut` IS THE COLUMN THAT STOPS THE PANEL LYING. A tighter stop cuts losses and kills winners
 * that dipped first. Without that count in view, every row reads "tighter is better" — which is the
 * conclusion this repo has had to un-learn more than once.
 */
import { useQuery } from '@tanstack/react-query';
import { apiPost } from '../../core/api/client.js';

const CANDIDATES = [0.5, 1, 1.5, 2, 3, 4, 5];

const fmt = (v, dp = 2) => (v == null ? '—' : Number(v).toFixed(dp));
const signed = (v, dp = 2) =>
  v == null ? '—' : `${Number(v) > 0 ? '+' : Number(v) < 0 ? '−' : ''}${Math.abs(Number(v)).toFixed(dp)}`;
const tone = (v) => (v == null ? '' : Number(v) > 0 ? 'bt-green' : Number(v) < 0 ? 'bt-red' : '');

export default function StopSweepPanel({ runId }) {
  const q = useQuery({
    queryKey: ['bt-stop-sweep', runId],
    // ⚠️ No `.catch(() => null)`: "the sweep failed" and "the sweep found nothing" must not render the
    // same way, and `rows: []` is a legitimate answer the panel has to be able to tell apart from an error.
    queryFn: () => apiPost('/api/backtest/stop-sweep', { runId, candidates: CANDIDATES }),
    enabled: Boolean(runId),
    staleTime: 5 * 60_000,
    retry: false,
  });

  if (q.isLoading) return <p className="pb-none">Screening candidate stops against the recorded excursions…</p>;
  if (q.isError) {
    return (
      <p className="pb-none">
        ⚠️ The stop screen could not be read ({q.error?.status ?? 'no status'}) — that is <strong>unknown</strong>,
        not empty. Nothing has been said about the stops on this run.
      </p>
    );
  }

  const data = q.data ?? {};
  const rows = data.rows ?? [];

  if (!rows.length) {
    return (
      <p className="pb-none">
        ⚠️ This run recorded no adverse excursion, so no candidate stop can be screened — that is
        <strong> not measured</strong>, not &ldquo;every stop is safe&rdquo;. Runs made before 2026-10-29
        predate the excursion columns; re-run to capture them.
      </p>
    );
  }

  const best = [...rows].sort((a, b) => b.deltaPnlPct - a.deltaPnlPct)[0];

  return (
    <>
      {/* ⚠️ `InfoNote`, not a `bt-panel-note` paragraph (owner report, 2026-10-30: the sentences that
          annotate data were arriving in a different style on every panel). */}
      <InfoNote
        tone={data.unmeasured > 0 ? 'warning' : 'neutral'}
        label="What this screen measured"
        meta={`best net on this screen: a ${fmt(best.stopPct)}% stop, ${signed(best.deltaPnlPct)}% across the run`}
      >
        <strong>{data.measured}</strong> of {data.measured + data.unmeasured} trade(s) carry a recorded
        adverse excursion.
        {data.unmeasured > 0 && (
          <>
            {' '}{data.unmeasured} do not — a run made before 2026-10-29 — and they are{' '}
            <strong>excluded rather than treated as zero</strong>. Re-run to include them.
          </>
        )}
      </InfoNote>
      <div className="bt-table-wrap">
        <table className="bt-table bt-num-sweep">
          <caption className="sr-only">
            Candidate stop distances, how many trades each would have stopped, and the estimated net effect
          </caption>
          <thead>
            <tr>
              <th scope="col">Stop %</th>
              <th scope="col" className="bt-num">Would stop</th>
              <th scope="col" className="bt-num" title="Trades the tighter stop would have stopped that were WINNERS on their actual exit — value it destroys.">
                Winners cut
              </th>
              <th scope="col" className="bt-num" title="Trades the tighter stop would have stopped that were losses anyway — the population it genuinely helps.">
                Losers saved
              </th>
              <th scope="col" className="bt-num" title="Estimated change across the whole run, in percentage points of P&L. FIRST-ORDER: it cannot see the path a surviving trade took.">
                Est. net
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.stopPct} className={r.stopPct === best.stopPct ? 'bt-row-win' : undefined}>
                <td className="pb-mono">{fmt(r.stopPct)}%</td>
                <td className="pb-mono bt-num">
                  {r.stopped}
                  <span className="bt-sweep-of"> / {data.measured}</span>
                </td>
                <td className={`pb-mono bt-num ${r.winnersCut > 0 ? 'bt-red' : ''}`}>{r.winnersCut}</td>
                <td className="pb-mono bt-num">{r.losersSaved}</td>
                <td className={`pb-mono bt-num ${tone(r.deltaPnlPct)}`}>{signed(r.deltaPnlPct)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <InfoNote tone="warning" label="What this cannot claim">
        <strong>First-order screen, not a measurement.</strong> Each row asks which trades&rsquo; recorded
        adverse excursion would have fired that stop, and what those trades would then have realised at
        −stop%. It cannot see the path a trade it did <em>not</em> stop took, so &ldquo;Est. net&rdquo; is an
        estimate. For the exact answer, re-run the window with <code>stopPlan</code> — the engine simulates
        a stop that only ever tightens (breakeven lock, trail, or step-tighten).
      </InfoNote>
    </>
  );
}
