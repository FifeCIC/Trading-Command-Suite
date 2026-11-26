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
import { dayLabel } from './format.js';
import { formatAmount, formatPct } from '../../core/format-utils.js';
/**
 * Audit note 'f' (2026-11-26) — a sign-coloured bar beside each day's P/L, so "one day carried the
 * whole total" is visible rather than summed by the reader.
 *
 * ⚠️ THE SCALE IS TO THE LARGEST DAY, NOT TO THE TOTAL, and the caption says so. Scaling to the total
 * would draw five equal days as five short bars — the opposite of the question this answers.
 */
import { buildPnlBars } from './pnl-bars.js';

export default function ResultByDayStep({ sort }) {
  const rows = sort?.sorted ?? [];

  if (rows.length === 0) {
    return <p className="mvp-note">No session finished, so there is nothing to show per day.</p>;
  }

  const bars = buildPnlBars(rows);

  return (
    <div className="mvp-scroll">
      <table className="mvp-table">
        {/*
          The bar's scale is a claim, so it is stated with the numbers it draws. ⚠️ Colour is never the
          only carrier: the sign is in the P/L text beside every bar.
        */}
        <caption className="mvp-caption">
          The bar length is this day&rsquo;s P/L against the largest day in the table ({formatAmount(bars.maxAbs)}),
          so a single day carrying the total is visible at a glance. The figure beside it is the value.
        </caption>
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
                        {c.movePct != null && <em>{formatPct(c.movePct)}</em>}
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
                {d.notice ? '—' : formatAmount(d.netPnl)}
                {/*
                  ⚠️ `aria-hidden` — the figure beside it carries the same fact as text, so a screen
                  reader gets the value rather than a bar with no axis. A failed day has no bar at all:
                  "not measured" and "zero" must not draw the same way.
                */}
                {!d.notice && bars.fracById[d.id] !== undefined && (
                  <span className="mvp-pnlbar" aria-hidden="true">
                    <span
                      className={`mvp-pnlbar-fill ${d.netPnl < 0 ? 'is-neg' : 'is-pos'}`}
                      style={{ width: `${Math.round(bars.fracById[d.id] * 100)}%` }}
                    />
                  </span>
                )}
              </td>
              <td className="mvp-num mvp-muted">{d.notice ? '—' : d.excluded}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
