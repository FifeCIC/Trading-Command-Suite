import { useQuery } from '@tanstack/react-query';
import { apiGet } from '../core/api/client';
import { noticeFromError } from '../core/notices/from-error.js';
import NoticeBlock from '../components/NoticeBlock';
import LoadingSkeleton from '../components/LoadingSkeleton';
import EmptyState from '../components/EmptyState';
import './walk-forward-survivors.css';

/**
 * WalkForwardSurvivorsPage — "which strategies SURVIVED out of sample?" (#1201).
 *
 * ⚠️ THE WHOLE POINT IS THE RANKING COLUMN. A leaderboard sorted by the tuned (in-sample) figure is a
 * leaderboard of the best window-fitters — the opposite of the question. Rows are served already
 * ordered out-of-sample by `GET /api/backtest/walk-forward-survivors`, and the in-sample figure sits
 * BESIDE it so the gap is visible without arithmetic.
 *
 * ⚠️ THE VERDICT IS DERIVED ON THE SERVER, NEVER HERE. `nest/src/common/trading/overfit-verdict.ts`
 * is the one place the retention thresholds are stated; recomputing them in a component would let the
 * page and the API disagree about whether a strategy survived.
 *
 * ⚠️ THREE STATES, NEVER TWO: "no runs yet", "cannot judge" and "loading" must not render alike.
 */
const API = '/api/backtest/walk-forward-survivors';

const VERDICT_GLYPH = {
  survived: '✅',
  decayed: '🟡',
  overfit: '🚫',
  'insufficient-data': '⚪',
  'sample-unknown': '❓',
};

const pct = (v) => (v === null || v === undefined ? '—' : `${(v * 100).toFixed(1)}%`);

export default function WalkForwardSurvivorsPage() {
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['backtest', 'walk-forward-survivors'],
    queryFn: () => apiGet(API),
    staleTime: 60_000,
  });

  const rows = data?.rows ?? [];
  const summary = data?.summary ?? {};

  return (
    <div className="wfs-page">
      <header className="wfs-header">
        <h2 className="wfs-title">Walk-Forward Survivors</h2>
        <p className="wfs-lede">
          Each run was tuned on a train window and then measured on a window it never saw. Ranked by
          the out-of-sample figure — the number that decides whether a strategy is kept.
        </p>
      </header>

      {isLoading && <LoadingSkeleton variant="text" lines={5} />}

      {isError && (
        <NoticeBlock
          notice={noticeFromError(error, 'TCS-SYS-007', { operation: 'load the walk-forward survivor list' })}
        />
      )}

      {data && rows.length === 0 && (
        <EmptyState
          icon="🎯"
          title="No walk-forward runs yet"
          description="POST /api/backtest/walk-forward records two windows (train, then test) per run. Until one has run there is nothing to rank — this is an empty result, not a failure."
        />
      )}

      {data && rows.length > 0 && (
        <>
          <div className="wfs-summary" role="status">
            {Object.entries(summary).map(([k, n]) => (
              <span className={`wfs-pill wfs-${k}`} key={k}>
                <span aria-hidden="true">{VERDICT_GLYPH[k] || '•'}</span> {k.replace(/-/g, ' ')} {n}
              </span>
            ))}
            <span className="wfs-stamp">computed {new Date(data.computedAt).toLocaleString()}</span>
          </div>

          <div className="wfs-table-wrap">
            <table className="wfs-table">
              <caption className="wfs-caption">
                Retention = out-of-sample ÷ in-sample win rate. ≥0.75 survived · ≥0.50 decayed ·
                &lt;0.50 overfit. A verdict needs ≥30 trades on BOTH sides; below that the answer is
                &ldquo;cannot judge&rdquo;, never a rank.
              </caption>
              <thead>
                <tr>
                  <th scope="col">Symbol</th>
                  <th scope="col">Window</th>
                  <th scope="col" className="wfs-num">In-sample</th>
                  <th scope="col" className="wfs-num">Out-of-sample</th>
                  <th scope="col" className="wfs-num">Trades in / out</th>
                  <th scope="col" className="wfs-num">Retention</th>
                  <th scope="col">Verdict</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.experimentId}>
                    <td className="wfs-symbol">{r.symbol || '—'}</td>
                    <td className="wfs-window">{r.window || '—'}</td>
                    <td className="wfs-num">{pct(r.inSampleWinRate)}</td>
                    <td className="wfs-num wfs-oos">{pct(r.outOfSampleWinRate)}</td>
                    <td className="wfs-num">
                      {r.inSampleTrades ?? '—'} / {r.outOfSampleTrades ?? '—'}
                    </td>
                    <td className="wfs-num">
                      {r.retention === null || r.retention === undefined ? '—' : `${r.retention.toFixed(2)}×`}
                    </td>
                    <td>
                      <span className={`wfs-verdict wfs-${r.verdict}`}>
                        <span aria-hidden="true">{VERDICT_GLYPH[r.verdict] || '•'}</span>{' '}
                        {r.verdict.replace(/-/g, ' ')}
                      </span>
                      <span className="wfs-note">{r.note}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
