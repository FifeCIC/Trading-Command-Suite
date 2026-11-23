/**
 * ResultByDayStep — one row per session: what the screen offered, what the ranking picked, what it made.
 *
 * ── WHY THIS IS A FILE AND NOT MORE JSX IN THE PAGE (#1342) ─────────────────────────────────────
 * The page was 1,150 lines and held the form, four tables, the depth panel and the settings panel. The
 * owner asked for the page to be considered for a split into a shared backtest library plus files that
 * belong to THIS strategy, because the same split is what a strategy extension needs. This table is
 * strategy-specific (a movers day has a ranked candidate list; a protocol run does not), so it lives
 * in the strategy's own folder and the page only mounts it.
 *
 * ⚠️ NOTHING IS RE-DERIVED HERE. Rows arrive already built and sorted by the caller; `sort` is the
 * page's `useSort` api. A table that recomputed a win rate would be the second implementation this
 * repo has already paid for.
 */
import { SortableTh } from '../../core/use-sort';
import WhyPopover from '../../components/WhyPopover.jsx';
import { fmtMoney, fmtPct, dayLabel } from './format.js';

export default function ResultByDayStep({ sort }) {
  const rows = sort?.sorted ?? [];

  if (rows.length === 0) {
    return <p className="mvp-note">No session finished, so there is nothing to show per day.</p>;
  }

  return (
    <div className="mvp-scroll">
      <table className="mvp-table">
        <thead>
          <tr>
            <SortableTh col="answerDate" label="Day" api={sort} buttonClassName="th-sort" firstDir="asc" />
            <th scope="col">
              Ranked at cutoff
              <WhyPopover title="How to read this column">
                Every candidate with its move at the screen time. A highlighted symbol is one the
                ranking picked; the tooltip on each carries its rank or the reason it could not be
                measured.
              </WhyPopover>
            </th>
            <th scope="col">Traded</th>
            <SortableTh col="candidates" label="Candidates" api={sort} className="mvp-num" buttonClassName="th-sort" />
            <SortableTh col="trades" label="Trades" api={sort} className="mvp-num" buttonClassName="th-sort" />
            <SortableTh col="winRate" label="Win %" api={sort} className="mvp-num" buttonClassName="th-sort" />
            <SortableTh col="netPnl" label="Net P/L" api={sort} className="mvp-num" buttonClassName="th-sort" />
            <SortableTh col="excluded" label="Excluded" api={sort} className="mvp-num" buttonClassName="th-sort" />
          </tr>
        </thead>
        <tbody>
          {rows.map((d) => (
            <tr key={d.id} className={d.notice ? 'mvp-row--bad' : ''}>
              <td className="mvp-nowrap">{dayLabel(d.answerDate)}</td>
              <td>
                {d.notice ? (
                  <span className="mvp-muted">{d.notice.title}</span>
                ) : (
                  <span className="mvp-chips mvp-chips--inline">
                    {d.ranked.map((c) => (
                      <span
                        key={c.symbol}
                        className={`mvp-sym${c.selected ? ' mvp-sym--on' : ''}`}
                        title={c.reason || (c.movePct == null ? 'not measurable' : `rank ${c.rank}`)}
                      >
                        {c.symbol}
                        {c.movePct != null && <em>{fmtPct(c.movePct)}</em>}
                      </span>
                    ))}
                  </span>
                )}
              </td>
              <td className="mvp-nowrap">
                {d.notice
                  ? '—'
                  : d.selected.length
                    ? <strong>{d.selected.join(', ')}</strong>
                    : <span className="mvp-muted">nothing</span>}
              </td>
              <td className="mvp-num">{d.notice ? '—' : d.candidates}</td>
              <td className="mvp-num">{d.notice ? '—' : d.trades}</td>
              <td className="mvp-num">
                {d.notice ? '—' : d.winRate == null ? '—' : `${Number(d.winRate).toFixed(1)}%`}
              </td>
              <td className={`mvp-num ${d.netPnl > 0 ? 'mvp-pos' : d.netPnl < 0 ? 'mvp-neg' : ''}`}>
                {d.notice ? '—' : fmtMoney(d.netPnl)}
              </td>
              <td className="mvp-num mvp-muted">{d.notice ? '—' : d.excluded}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
