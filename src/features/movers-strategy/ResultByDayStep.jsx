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
    <>
      {/*
        The bar's scale is a claim, so it is stated with the numbers it draws. ⚠️ Colour is never the
        only carrier: the sign is in the P/L text beside every bar.
        ⚠️ A `<p>` ABOVE the frame, not a `<caption>` inside it (theme, 2026-11-26) — as a caption it
        sat inside the bordered scroll, jammed against the header row.
      */}
      <p className="mvp-caption">
        The bar length is this day&rsquo;s P/L against the largest day in the table ({formatAmount(bars.maxAbs)}),
        so a single day carrying the total is visible at a glance. The figure beside it is the value.
      </p>
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
            <th scope="col" className="mvp-num">
              Not counted
              <WhyPopover title="What “not counted” means">
                <p>
                  The engine produced trades this run did not count. They are dropped for one of two
                  reasons, and the two mean opposite things:
                </p>
                <p>
                  <strong>Not picked</strong> — the engine would have traded a name the ranking did not
                  choose. This includes every trade on the dataset&rsquo;s warm-up sessions, which can
                  never be selected. It is the strategy&rsquo;s selectivity.
                </p>
                <p>
                  <strong>Pre-cutoff</strong> — the pick was right but the entry came before the screen
                  time, so the ranking did not exist yet. This is the test&rsquo;s own rule: moving the
                  cutoff earlier makes this number bigger.
                </p>
              </WhyPopover>
            </th>
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
                    {/*
                      ⚠️ THE RANK IS VISIBLE NOW (2026-11-27). It lived only in a `title=`, which is
                      hover-only and therefore unreachable by keyboard, touch and screen readers — the
                      exact reason `WhyPopover` exists in this codebase and the lesson #824 already paid
                      for. The rank is ONE character and it is the strategy's own ordering, so hiding it
                      behind a hover was withholding the thing a reader needs to ask "why this name?".
                      The long `reason` stays in the title (it is genuinely help, not content).

                      ⚠️ THE VISIBLE TEXT IS THE ACCESSIBILITY FIX, NOT THE `aria-label`. An
                      `aria-label` on a generic `<span>` may be ignored by assistive tech, so it is
                      carried as a hint and nothing depends on it: symbol, move % and rank are all
                      rendered as text, and "which one was picked" is stated in the Traded column.
                    */}
                    {d.ranked.map((c) => (
                      <span
                        key={c.symbol}
                        className={`mvp-sym${c.selected ? ' mvp-sym--on' : ''}`}
                        title={c.reason || (c.movePct == null ? 'not measurable' : `rank ${c.rank}`)}
                        aria-label={[
                          c.symbol,
                          c.movePct == null ? 'not measurable' : null,
                          c.rank != null ? `rank ${c.rank}` : null,
                          c.selected ? 'picked' : null,
                        ]
                          .filter(Boolean)
                          .join(', ')}
                      >
                        {c.rank != null && <span className="mvp-sym-rank">{c.rank}</span>}
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
              {/*
                ⚠️ `?? '—'` ON EVERY COUNT (2026-11-27). A day whose run returned no totals rendered a
                BLANK cell, and a blank cell reads as zero or as "nothing to report" — the silent shape
                this page exists to avoid. `null` is "the run did not say", which is a third state and
                has to look like one.
              */}
              <td className="mvp-num">{d.notice ? '—' : (d.candidates ?? '—')}</td>
              <td className="mvp-num">{d.notice ? '—' : (d.trades ?? '—')}</td>
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
              {/*
                ⚠️ THE SPLIT IS THE POINT, NOT THE TOTAL (2026-11-27). "Not counted: 34" left the reader
                to guess, and the two halves mean opposite things — 25 the strategy declined, 9 the
                test's cutoff removed. The total stays as the sortable figure; the breakdown is what
                explains a run that made far less than the day's move.
              */}
              <td className="mvp-num">
                {d.notice || !d.exclusions ? (
                  '—'
                ) : (
                  <>
                    <span className="mvp-muted">{d.exclusions.total}</span>
                    {d.exclusions.byCode.length > 0 && (
                      <span className="mvp-exclusions">
                        {d.exclusions.byCode.map((c) => `${c.count} ${c.label}`).join(' · ')}
                      </span>
                    )}
                  </>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>
    </>
  );
}
