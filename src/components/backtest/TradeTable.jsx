/**
 * TradeTable — one row per CLOSED TRADE, with money on it (owner direction, 2026-10-29).
 *
 * *"This table needs to be more trade based and show us profit loss at least."* The table it replaced
 * answered "every bar this run scored", which is a question about the SCORER. A reader trying to find
 * out whether the run made money had to add 1,027 rows up in their head, and the per-trade
 * `pnl` / `pnlPct` the engine already stores were never rendered at all.
 *
 * ⚠️ ONE DEFINITION, TWO PLACES. This table is used by the Run step (after a run completes) and by
 * both A/B panels. Before it, the same question was answered by two hand-written tables with
 * different columns — one showing `PnL %` only, one showing neither `P&L` nor a total — which is the
 * drift a second implementation guarantees. Columns, sort, P&L colour and the summary live here once.
 *
 * ⚠️ THE ROW CAP IS DISCLOSED, AND THE SUMMARY IS NOT CAPPED. Showing 100 of 1,027 rows without
 * saying so is the exact "plausible number, no error" defect — the visible Σ would be a fraction of
 * the real one. The strip above the table is computed from ALL trades; only the row list is capped.
 *
 * ⚠️ `P&L %` IS THE HONEST FIGURE. `pnl` is produced by the run's own position model, which can
 * commit several times the account (#1142), so a total P&L can read as six figures on a $10,000
 * account. The percentage is per-position and comparable across sizes; the tooltip says so.
 */
import { useMemo, useState, useEffect } from 'react';
import { useSort, SortableTh } from '../../core/use-sort.jsx';

/**
 * Currency with a SIGN and thousands separators. The sign is explicit so a loss cannot be mistaken for a
 * gain by colour alone; the separators exist because a six-figure Σ P&L (`−159072.01`) is unreadable
 * without them at a glance, and this table routinely produces six figures (#1142 sizing).
 */
const money = (v) => (v == null
  ? '—'
  : `${Number(v) >= 0 ? '+' : '−'}${Math.abs(Number(v)).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
const pct1 = (v) => (v == null ? '—' : `${Number(v).toFixed(1)}%`);

/** `2026-10-20T22:25:00Z` → `2026-10-20 22:25`, so two trades on one day are distinguishable. */
const stamp = (iso) => (iso ? String(iso).slice(0, 16).replace('T', ' ') : '—');

/**
 * useCycleColumn — a column that changes what it shows every 3 seconds (#1150).
 *
 * Owner direction, 2026-10-29: *"there's too many columns already so we're going to do something very
 * new and designate a column to be automatic changing every 3 seconds … This will allow me to see more
 * data when browsing."* The approach is named a **Cycle Column** — one grid slot that recycles itself
 * through a short series of related facts instead of widening the table. ("Carousel column" describes
 * the same thing; "cycle" was chosen because nothing slides and the order is fixed.)
 *
 * ⚠️ IT IS PAUSABLE, AND THAT IS NOT OPTIONAL. WCAG 2.2.2 (Pause, Stop, Hide) requires auto-updating
 * content to be stoppable, and a table whose header relabels itself under the reader is exactly that.
 * So: hover pauses, keyboard focus pauses, there is an explicit pause control, and
 * `prefers-reduced-motion: reduce` starts it PAUSED rather than animating at someone who asked for less.
 *
 * ⚠️ A CYCLING COLUMN WITH NO STATED LABEL IS UNREADABLE. Every value must carry the name of the fact
 * it is, at the moment it is shown — so the HEADER cycles with the cells, and the position is shown as
 * dots. A screenshot with no header would otherwise be a column of unexplained numbers.
 */
const CYCLE_MS = 3000;

function useCycleColumn(items) {
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return false;
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  });
  const [heldByPointer, setHeldByPointer] = useState(false);

  useEffect(() => {
    if (paused || heldByPointer || items.length < 2) return undefined;
    const id = setInterval(() => setIndex((i) => (i + 1) % items.length), CYCLE_MS);
    return () => clearInterval(id);
  }, [paused, heldByPointer, items.length]);

  // Clamp when the series shrinks (a different run with fewer facts), so the label cannot point past it.
  const safeIndex = index < items.length ? index : 0;
  return {
    item: items[safeIndex],
    index: safeIndex,
    paused,
    togglePaused: () => setPaused((p) => !p),
    holdProps: {
      onMouseEnter: () => setHeldByPointer(true),
      onMouseLeave: () => setHeldByPointer(false),
      onFocusCapture: () => setHeldByPointer(true),
      onBlurCapture: () => setHeldByPointer(false),
    },
    count: items.length,
  };
}

/** `5m` / `1h` / `1d` → minutes. `null` when it cannot be read, never a guessed 1. */
function timeframeMinutes(tf) {
  const m = /^(\d+)\s*([mhd])$/i.exec(String(tf ?? '').trim());
  if (!m) return null;
  const n = Number(m[1]);
  const unit = m[2].toLowerCase();
  return unit === 'm' ? n : unit === 'h' ? n * 60 : n * 60 * 24;
}

/** Bar length in minutes as a NUMBER for arithmetic — 0 when unknown, so a product reads as 0 not NaN. */
const barMinutesOf = (tf) => timeframeMinutes(tf) ?? 0;

/** Minutes between a trade's own two instants — the per-row version of `totals.avgHoldMinutes`. */
function rowHoldMinutes(t) {
  if (!t?.entryDate || !t?.exitDate) return null;
  const a = new Date(t.entryDate).getTime();
  const b = new Date(t.exitDate).getTime();
  if (Number.isNaN(a) || Number.isNaN(b) || b < a) return null;
  return (b - a) / 60_000;
}

/**
 * holdLabel — minutes as a duration a human reads without dividing.
 *
 * ⚠️ THE UNIT IS CHOSEN BY MAGNITUDE, not fixed to hours, because the same table covers a 5m scalp and
 * a daily run: `12 min` and `32.9 h` must both be legible. `—` for null, never `0` — an unrecorded
 * instant and an instant close are different facts.
 */
export function holdLabel(minutes) {
  if (minutes == null || Number.isNaN(Number(minutes))) return '—';
  const m = Number(minutes);
  if (m < 90) return `${Math.round(m)} min`;
  if (m < 60 * 48) return `${(m / 60).toFixed(1)} h`;
  return `${(m / 60 / 24).toFixed(1)} d`;
}

/** Colour a signed number. The SIGN is printed too — colour is never the only cue (WCAG 1.4.1). */
const numTone = (v) => (v == null ? '' : Number(v) > 0 ? 'mss-stat--bullish' : Number(v) < 0 ? 'mss-stat--bearish' : '');
/** Colour a rate against a 50% midpoint — a 22.9% win rate should look like what it is. */
const pctTone = (v, mid) => (v == null ? '' : Number(v) >= mid ? 'mss-stat--bullish' : 'mss-stat--bearish');

/**
 * The fastest and slowest EXIT REASON by mean hold — the two tiles the owner's speed-of-movement
 * question is actually about ("average time to SL … and to TP"). `SL` and `TP` are picked out by name
 * when both are present, so the pair is the one being asked about; otherwise the extremes are used and
 * the label says which reason they are, so a third reason is never silently presented as the stop.
 */
function exitSpeedPair(byExitReason) {
  const rows = (byExitReason ?? []).filter((r) => r.avgHoldMinutes != null && r.count > 0);
  if (rows.length < 2) return { fastest: rows[0] ?? null, slowest: null };
  const sl = rows.find((r) => r.reason === 'SL');
  const tp = rows.find((r) => r.reason === 'TP');
  if (sl && tp) return { fastest: sl, slowest: tp };
  const sorted = [...rows].sort((a, b) => a.avgHoldMinutes - b.avgHoldMinutes);
  return { fastest: sorted[0], slowest: sorted[sorted.length - 1] };
}

/**
 * ⚠️ THIS COMPONENT DOES NOT ADD UP THE MONEY. The first cut did, and `src/core/backtest-totals.js`
 * carries a standing instruction against it: a panel that computes its own win rate will eventually
 * disagree with the endpoint an agent reads from the same run, and this repo has already paid for one
 * such divergence (a date-keyed join that reported 954 of 1,722 identical bars as "changed").
 * `totals` is `tradeTotals` from the API (`score-maths.ts`), computed from the same trades by the code
 * an agent can call directly.
 *
 * When `totals` is absent the table still renders — the ROWS are data the caller already holds — but
 * the summary says so rather than falling back to a client-side sum that would look identical and
 * could be wrong.
 */
/**
 * The facts the CYCLE COLUMN rotates through — all about SPEED, none of which is a column of its own.
 *
 * ⚠️ THESE ARE THE OWNER'S QUESTION, NOT DECORATION. *"I want to establish an average time to SL trigger
 * … and an average to TP … Where I'm going with this is to consider the speed of movement."* The table
 * shows what a trade made; these show how fast it got there, which is the difference between "the stop
 * is too far" and "the entry is mistimed".
 */
const CYCLE_FACTS = [
  {
    key: 'hold',
    label: 'Held',
    title: 'Minutes from entry to exit for THIS trade.',
    value: (t) => holdLabel(rowHoldMinutes(t)),
  },
  {
    key: 'pctPerHour',
    label: '% / h',
    title: 'P&L % per hour held — the speed of the move, so a slow grind and a fast snap are comparable.',
    value: (t) => {
      const mins = rowHoldMinutes(t);
      if (mins == null || t.pnlPct == null) return '—';
      // A zero-minute hold would divide by zero; holdLabel shows it, this reads as unmeasurable.
      if (mins <= 0) return '—';
      return `${((Number(t.pnlPct) / mins) * 60).toFixed(2)}%`;
    },
  },
  {
    key: 'barsHeld',
    label: 'Bars held',
    title: 'How many bars of this run’s timeframe the position stayed open — the unit a bracket is set in.',
    value: (t, barMin) => {
      const mins = rowHoldMinutes(t);
      if (mins == null || !barMin) return '—';
      return String(Math.max(1, Math.round(mins / barMin)));
    },
  },
];

export default function TradeTable({ trades, totals, timeframe, limit = 100 }) {
  // Memoised so `trades ?? []` does not allocate a fresh array on every render.
  const rows = useMemo(() => trades ?? [], [trades]);
  const order = useSort(rows, 'exitDate', 'desc');
  const { fastest, slowest } = useMemo(
    () => exitSpeedPair(totals?.byExitReason),
    [totals?.byExitReason],
  );
  const barMin = useMemo(() => timeframeMinutes(timeframe), [timeframe]);
  const cycle = useCycleColumn(CYCLE_FACTS);

  if (!rows.length) {
    return (
      <p className="pb-none">
        No trade was taken on this run — the signals did not clear the gate, or the bracket never
        filled. That is a result, not a missing table.
      </p>
    );
  }

  return (
    <>
      {totals ? (
        /**
         * ⚠️ STAT TILES, NOT A SENTENCE (owner direction, 2026-10-29: *"there are other pages with stats
         * that display it better than this so use existing styling as always"*). The numbers were a
         * `·`-separated run-on — seven figures in one line of prose, which is the density the owner has
         * objected to on this page before. These are `.mss-stat-*` from `meta-stack-status.css`, the same
         * tiles the Appearance area presents as the app's stat library — NOT a new look.
         */
        <dl className="mss-stat-grid bt-trade-tiles">
          <div className="mss-stat-card">
            <dd className="mss-stat-value">{totals.count}</dd>
            <dt className="mss-stat-label">Closed trades</dt>
            {totals.breakEven > 0 && <dd className="mss-stat-sub">{totals.breakEven} break-even</dd>}
          </div>
          <div className="mss-stat-card">
            <dd className={`mss-stat-value ${pctTone(totals.winRatePct, 50)}`}>{pct1(totals.winRatePct)}</dd>
            <dt className="mss-stat-label">Win rate</dt>
            <dd className="mss-stat-sub">
              {totals.wins} of {totals.measured} measured
            </dd>
          </div>
          <div className="mss-stat-card bt-tile--wide">
            <dd className={`mss-stat-value ${numTone(totals.sumPnl)}`}>{money(totals.sumPnl)}</dd>
            <dt className="mss-stat-label">Σ P&amp;L</dt>
            <dd className="mss-stat-sub">currency — read the % tile</dd>
          </div>
          <div className="mss-stat-card">
            <dd className={`mss-stat-value ${numTone(totals.avgPnlPct)}`}>
              {totals.avgPnlPct == null ? '—' : `${totals.avgPnlPct.toFixed(2)}%`}
            </dd>
            <dt className="mss-stat-label">Avg per trade</dt>
            <dd className="mss-stat-sub">
              best {pct1(totals.bestPnlPct)} · worst {pct1(totals.worstPnlPct)}
            </dd>
          </div>
          {/*
            ⚠️ TWO HOLD TILES, AND THE BARS ONE IS THE TRUTH (owner note, 2026-10-29: *"Sometimes the PC
            is shutdown while positions are open so some of our data could be skewed by the app being
            asleep."* — measured: 37.7 h of wall clock against 24.3 h of trading bars, because 45.2% of
            trades crossed a hole in the series). Showing only the wall-clock number overstates how long
            the strategy actually held, so both are here and the gap count explains any difference.
          */}
          <div className="mss-stat-card">
            <dd className="mss-stat-value">{holdLabel(totals.avgBarsHeld * barMinutesOf(timeframe))}</dd>
            <dt className="mss-stat-label">Avg hold (bars)</dt>
            <dd className="mss-stat-sub">
              {totals.avgBarsHeld == null ? 'not recorded' : `${Math.round(totals.avgBarsHeld)} bars · gap-immune`}
            </dd>
          </div>
          <div className="mss-stat-card">
            <dd className="mss-stat-value">{holdLabel(totals.avgHoldMinutes)}</dd>
            <dt className="mss-stat-label">Avg hold (clock)</dt>
            <dd className="mss-stat-sub">entry → exit, wall clock</dd>
          </div>
          {fastest && (
            <div className="mss-stat-card">
              <dd className="mss-stat-value">{holdLabel(fastest.avgHoldMinutes)}</dd>
              <dt className="mss-stat-label">Avg to {fastest.reason}</dt>
              <dd className="mss-stat-sub">
                {fastest.count} trade(s) · {pct1(fastest.avgPnlPct)} avg
              </dd>
            </div>
          )}
          {slowest && (
            <div className="mss-stat-card">
              <dd className="mss-stat-value">{holdLabel(slowest.avgHoldMinutes)}</dd>
              <dt className="mss-stat-label">Avg to {slowest.reason}</dt>
              <dd className="mss-stat-sub">
                {slowest.count} trade(s) · {pct1(slowest.avgPnlPct)} avg
              </dd>
            </div>
          )}
        </dl>
      ) : (
        <p className="pb-field-note">
          ⚠️ This response carried no <code>tradeTotals</code>, so the win count and Σ P&amp;L are not
          shown — they are computed by the API, not here, and a figure derived in the browser could
          disagree with what an agent reads from the same run.
        </p>
      )}
      <div className="bt-table-wrap">
        <table className="bt-table">
          <caption className="sr-only">
            Every closed trade this run took, with its profit or loss
          </caption>
          <thead>
            <tr>
              {/* ⚠️ THE MONEY IS THIRD AND FOURTH, NOT LAST (measured 2026-10-29). With ten columns the
                  panel scrolls horizontally, and a `P&L` at the far right is off-screen on a normal
                  layout — the one column the reader came for was the one they had to scroll to find.
                  Entry and Direction identify the trade; the result follows immediately. */}
              <SortableTh col="entryDate" label="Entry" api={order} />
              <SortableTh col="direction" label="Dir" api={order} />
              <SortableTh
                col="pnlPct"
                label="P&L %"
                title="Percent of the position's entry cost — the comparable figure across sizes, and the one to trust. `P&L` compounds a position model that can commit several times the account (#1142)."
                api={order}
                className="bt-num"
              />
              <SortableTh
                col="pnl"
                label="P&L"
                title="Currency, from the run's own position model and account size."
                api={order}
                className="bt-num"
              />
              {/* ── THE CYCLE COLUMN (#1150) ───────────────────────────────────────────────────────
                  One slot, several facts, 3s apart. Its header carries the CURRENT fact's name plus a
                  pause control and a position dot — without that the numbers are unreadable, and WCAG
                  2.2.2 requires the reader to be able to stop it. */}
              <th scope="col" className="bt-cycle-th" {...cycle.holdProps}>
                <span className="bt-cycle-head">
                  <span className="bt-cycle-label" title={cycle.item.title}>
                    {cycle.item.label}
                  </span>
                  {cycle.count > 1 && (
                    <button
                      type="button"
                      className="bt-cycle-pause"
                      aria-pressed={cycle.paused}
                      aria-label={cycle.paused ? 'Resume the cycling column' : 'Pause the cycling column'}
                      title={cycle.paused ? 'Resume cycling (it also pauses while you hover)' : 'Pause cycling (it also pauses while you hover)'}
                      onClick={cycle.togglePaused}
                    >
                      {cycle.paused ? '▶' : '⏸'}
                    </button>
                  )}
                </span>
                {cycle.count > 1 && (
                  <span className="bt-cycle-dots" aria-hidden="true">
                    {CYCLE_FACTS.map((f, i) => (
                      <span key={f.key} className={i === cycle.index ? 'is-on' : ''} />
                    ))}
                  </span>
                )}
              </th>
              <SortableTh col="exitDate" label="Exit" api={order} />
              <SortableTh col="entryPrice" label="In" api={order} className="bt-num" />
              <SortableTh col="exitPrice" label="Out" api={order} className="bt-num" />
              <SortableTh col="positionSize" label="Size" api={order} className="bt-num" />
              <SortableTh col="signal" label="Signal at entry" api={order} />
              <SortableTh
                col="exitReason"
                label="Why"
                title="What ended the trade: the stop, the target, or end of the window."
                api={order}
              />
            </tr>
          </thead>
          <tbody>
            {order.sorted.slice(0, limit).map((t, i) => (
              <tr
                key={`${t.entryDate}-${t.exitDate}-${i}`}
                className={Number(t.pnlPct) > 0 ? 'bt-row-win' : 'bt-row-loss'}
              >
                <td className="pb-mono bt-nowrap">{stamp(t.entryDate)}</td>
                <td className="bt-nowrap">{t.direction === 'short' ? '▼ short' : '▲ long'}</td>
                <td className={`pb-mono bt-num ${Number(t.pnlPct) < 0 ? 'bt-red' : 'bt-green'}`}>{pct1(t.pnlPct)}</td>
                <td className={`pb-mono bt-num ${Number(t.pnl) < 0 ? 'bt-red' : 'bt-green'}`}>{money(t.pnl)}</td>
                <td className="pb-mono bt-num bt-cycle-cell">{cycle.item.value(t, barMin)}</td>
                <td className="pb-mono bt-nowrap">{stamp(t.exitDate)}</td>
                <td className="pb-mono bt-num">{t.entryPrice?.toFixed?.(4) ?? '—'}</td>
                <td className="pb-mono bt-num">{t.exitPrice?.toFixed?.(4) ?? '—'}</td>
                <td className="pb-mono bt-num">{t.positionSize ?? '—'}</td>
                <td>{t.signal ?? '—'}</td>
                <td>{t.exitReason ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {totals.tradesSpanningGap > 0 && (
        <p className="pb-field-note bt-gap-warning">
          ⚠️ <strong>{totals.tradesSpanningGap}</strong> of {totals.count} trade(s) crossed a hole in the
          bar series longer than an hour — the machine was off or the feed stopped. Across such a hole the
          stop and target were <strong>not monitored</strong>, so those trades&rsquo; hold times and exit
          reasons are contaminated even though their prices are real. The bars column is the gap-immune
          figure; the clock column is not.
        </p>
      )}
      {order.sorted.length > limit && (
        <p className="pb-field-note">
          Showing {limit} of {order.sorted.length} trades — the summary above covers all of them. Sort
          a column to choose which {limit} you see.
        </p>
      )}
    </>
  );
}
