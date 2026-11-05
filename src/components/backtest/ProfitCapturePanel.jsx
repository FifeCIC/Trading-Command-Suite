/**
 * ProfitCapturePanel — "what was on the table, and what did we take?" (2026-11-04)
 *
 * Owner question: *"how much slippage has happened and I believe the app is recording the price
 * changes, storing the highest amount of profit recognised within its processing. If you total that
 * up for all backtesting positions opened what does it show? … It might also be more useful to update
 * the backtesting pages with the slippage value and the app does the calculation."*
 *
 * Then, on the first cut (owner, 2026-11-04): *"I want to see money values telling me the theoretic
 * trading outcome if we took profit at the highest value of each position as recorded."* So the tiles
 * are MONEY first — the theoretical "sold at its best" total against what the run actually realised —
 * and the percentages are the supporting detail underneath.
 *
 * ⚠️ THIS COMPONENT DOES NO ARITHMETIC. Every figure is computed in `score-maths.tradeTotals()` and
 * served as `tradeTotals.excursion` / `tradeTotals.costs` — the same rule `backtest-totals.js` states
 * for the client, because a second implementation of a mean is how the UI and an agent end up
 * disagreeing about the same run.
 *
 * ⚠️ WHY THE POPULATIONS ARE NAMED ON THE PANEL, NOT JUST USED. Measured on the live database
 * 2026-11-04: 15 of 48,992 stored trades carried **98.2%** of the summed excursion, and every one of
 * them crossed a hole in the bar series. A panel that silently averaged those in would show an
 * "average best available" of 70% per trade; excluding them shows 1.05%. The count of what was
 * excluded is the only thing that lets a reader tell which number they are looking at.
 *
 * ⚠️ GROSS AGAINST NET, SAID IN PLACE. `best available` is measured on raw bar highs and lows, before
 * any charge; `realised` comes from `pnlPct`, after spread, slippage and commission. The gap between
 * them is therefore cost PLUS exit timing — not slippage alone — and the cost line says how much of
 * it the run's own configured charge accounts for.
 *
 * ⚠️ THE MONEY FIGURES ARE LIKE-FOR-LIKE, NOT AN ACCOUNT BALANCE. Sizing comes from the run's own
 * position model, which can commit several times the account (#1142), so `theoretical` and `realised`
 * must be read as a pair — the difference is meaningful, the absolute total is not a bank statement.
 */
import InfoNote from '../InfoNote';

const pct = (v, digits = 2) => (v == null ? '—' : `${Number(v).toFixed(digits)}%`);
const signedPct = (v, digits = 2) => (v == null ? '—' : `${Number(v) >= 0 ? '+' : '−'}${Math.abs(Number(v)).toFixed(digits)}%`);

/** Currency with an explicit sign, so a loss is never read as a gain by colour alone. */
const money = (v) =>
  v == null
    ? '—'
    : `${Number(v) >= 0 ? '+' : '−'}$${Math.abs(Number(v)).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Profit/loss tone for a value — the same two-class vocabulary the trade tiles use. */
const tone = (v) => (v == null ? '' : Number(v) > 0 ? ' mss-stat--bullish' : Number(v) < 0 ? ' mss-stat--bearish' : '');

export default function ProfitCapturePanel({ totals }) {
  const ex = totals?.excursion;
  if (!ex) return null;

  // Nothing measured is a DIFFERENT statement from "flat" — say which one it is.
  if (ex.usable === 0) {
    return (
      <InfoNote
        tone="warning"
        label="Profit capture"
        meta={ex.measured > 0 ? `${ex.measured} measured trade(s), all crossing a data hole` : undefined}
      >
        This run recorded no usable excursion, so “what was available” cannot be measured.
        {ex.unmeasured > 0 && ` ${ex.unmeasured} trade(s) predate the excursion columns (2026-10-29) — re-run to record them.`}
        {ex.excludedGap > 0 && ` ${ex.excludedGap} trade(s) were excluded because the hold crossed a hole in the bar series.`}
      </InfoNote>
    );
  }

  const costs = totals.costs;
  const hasMoney = ex.moneyTrades > 0 && ex.theoreticalPnl != null;

  return (
    <>
      <dl className="mss-stat-grid bt-trade-tiles">
        {hasMoney ? (
          <>
            <div className="mss-stat-card bt-tile--wide" title="Σ what each position would have realised if it had been closed at its own best recorded price (raw bar high/low), less that trade's commission.">
              <dd className={`mss-stat-value${tone(ex.theoreticalPnl)}`}>{money(ex.theoreticalPnl)}</dd>
              <dt className="mss-stat-label">If exited at its best</dt>
              <dd className="mss-stat-sub">{ex.moneyTrades} trade(s) · best price each</dd>
            </div>
            <div className="mss-stat-card bt-tile--wide" title="Σ realised P&L over the SAME trades — net of spread, slippage and commission.">
              <dd className={`mss-stat-value${tone(ex.realisedPnl)}`}>{money(ex.realisedPnl)}</dd>
              <dt className="mss-stat-label">Actually realised</dt>
              <dd className="mss-stat-sub">{ex.moneyTrades} trade(s) · net of costs</dd>
            </div>
            <div className="mss-stat-card bt-tile--wide" title="Theoretical minus realised: the money the exits left on the table.">
              <dd className={`mss-stat-value${tone(ex.leftOnTablePnl)}`}>{money(ex.leftOnTablePnl)}</dd>
              <dt className="mss-stat-label">Left on the table</dt>
              <dd className="mss-stat-sub">
                {costs ? `cost ${pct(costs.roundTripPct)}/trade · rest is timing` : 'cost not recorded'}
              </dd>
            </div>
          </>
        ) : (
          <>
            <div className="mss-stat-card" title="Mean best excursion in the position's favour — GROSS of costs.">
              <dd className="mss-stat-value">{pct(ex.avgFavourablePct)}</dd>
              <dt className="mss-stat-label">Best available</dt>
              <dd className="mss-stat-sub">per trade · before costs</dd>
            </div>
            <div className="mss-stat-card" title="Mean realised pnlPct on the same trades — NET of costs.">
              <dd className={`mss-stat-value${tone(ex.avgRealisedPct)}`}>{signedPct(ex.avgRealisedPct)}</dd>
              <dt className="mss-stat-label">Realised</dt>
              <dd className="mss-stat-sub">per trade · after costs</dd>
            </div>
            <div className="mss-stat-card" title="Best available minus realised: what the trade gave back.">
              <dd className="mss-stat-value">{ex.uncapturedPct == null ? '—' : `${ex.uncapturedPct.toFixed(2)}pp`}</dd>
              <dt className="mss-stat-label">Not captured</dt>
              <dd className="mss-stat-sub">
                {costs ? `cost ${pct(costs.roundTripPct)} · timing ${costs.timingPct == null ? '—' : `${costs.timingPct.toFixed(2)}pp`}` : 'cost not recorded'}
              </dd>
            </div>
          </>
        )}
        <div className="mss-stat-card" title="Realised ÷ best available. Negative means the strategy gave back more than its best opportunity on the average trade.">
          <dd className={`mss-stat-value${ex.captureRatePct != null && ex.captureRatePct < 0 ? ' mss-stat--bearish' : ''}`}>
            {pct(ex.captureRatePct, 1)}
          </dd>
          <dt className="mss-stat-label">Capture rate</dt>
          <dd className="mss-stat-sub">realised ÷ available</dd>
        </div>
      </dl>

      <InfoNote
        tone={ex.excludedGap > 0 || ex.unmeasured > 0 ? 'warning' : 'neutral'}
        label="Excursion population"
        meta={[
          `${ex.usable} used`,
          `avg best ${pct(ex.avgFavourablePct)} vs realised ${signedPct(ex.avgRealisedPct)}`,
          hasMoney ? `${ex.moneyTrades} with size recorded` : 'no trade carried a size — no money figure',
          ex.excludedGap > 0 ? `${ex.excludedGap} excluded — crossed a data hole` : null,
          ex.unmeasured > 0 ? `${ex.unmeasured} not recorded (pre-2026-10-29)` : null,
        ].filter(Boolean).join(' · ')}
      >
        Best available and adverse are measured on raw bar extremes, so they are gross of costs;
        realised is net. A trade that crossed a hole is held for days of price movement and would
        otherwise dominate the average.
        {costs == null && ' This run stored no spread/slippage, so the cost part of the gap is unknown rather than zero.'}
      </InfoNote>
    </>
  );
}
