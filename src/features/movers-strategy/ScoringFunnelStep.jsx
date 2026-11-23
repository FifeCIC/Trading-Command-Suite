/**
 * ScoringFunnelStep — SCORES → SIGNALS → TRADES, per symbol, with the speed rating beside them.
 *
 * ── WHY THIS STEP EXISTS ─────────────────────────────────────────────────────────────────────────
 * Owner requirement, 2026-11-23: at least one scoring-related step showing scores, which of them create
 * signals and which of those are traded; and a check on whether the speed of price change is rated at
 * all, because the page showed no sign of it.
 *
 * ── ⚠️ THE SPEED RATING ALREADY EXISTS — IT WAS INVISIBLE ───────────────────────────────────────
 * Measured 2026-11-23: `speed-momentum` is a directive in BOTH movers protocols, carrying **120** of the
 * protocol's capacity (the second-largest single allocation, behind `momentum-continuation-combo` at
 * 125). It measures a **5-candle rate of change, amplified by volume**. Nothing on the page showed it,
 * which is why it read as absent. Its own score is printed here — not a re-derived velocity — because a
 * second speed metric beside a scored one would be two answers to one question.
 *
 * ── ⚠️ NOTHING HERE IS RE-SCORED OR RE-CLASSIFIED ──────────────────────────────────────────────
 * The funnel counts come from `bar.state`, which is the ENGINE's own per-bar verdict (the same value the
 * Decisions table renders), and from the trades the engine produced. Every bucket below is therefore a
 * count of something already decided, never a second decision:
 *
 *   no-data     → the bar produced no directional reading
 *   quiet       → a reading, not actionable for this protocol's side
 *   bar-gate    → a directional signal that did NOT clear the bot's entry bar   ← the interesting loss
 *   signal-not-traded → actionable, and still no trade
 *   entry / entry+exit → traded
 */
import { useMemo } from 'react';
import { funnelFor, funnelTotals, sharePct, SPEED_DIRECTIVE } from '../../core/movers-funnel.js';

const BUCKETS = [
  { key: 'scored', label: 'Bars scored' },
  { key: 'noData', label: 'No reading' },
  { key: 'quiet', label: 'Not actionable' },
  { key: 'barGate', label: 'Under the bar' },
  { key: 'signalNotTraded', label: 'Signal · no trade' },
  { key: 'entered', label: 'Traded' },
];

/**
 * ── DECISION (2026-11-23, primary) ─────────────────────────────────────────────────────────────
 * WHAT:      the scoring step counts the ENGINE bar vocabulary, and prints the `speed-momentum`
 *            directive score as the speed rating rather than computing a velocity of its own.
 * WHY:       two implementations of one count is how a tile and a table end up disagreeing; and a
 *            second speed metric beside a scored one would be two answers to one question. Measured
 *            live: speed-momentum mean 86.0, peak 120 of a 120 ceiling on ELOG.
 * INSTEAD OF: deriving "% change over 5 bars" here, which would have looked like a new capability
 *            while the protocol already allocated 120 of its capacity to that exact measurement.
 * REVERSE BY: add the derived velocity as a SECOND column and label it display-only; the counting
 *            test still applies to the funnel buckets either way.
 * REGISTER:  docs/SETTLED-DECISIONS.md row 267
 * GUARD:     src/core/movers-funnel.test.js
 */
export default function ScoringFunnelStep({ entries }) {
  const rows = useMemo(
    () => (Array.isArray(entries) ? entries.map((e) => funnelFor(e.symbol, e.detail, e.day)) : []),
    [entries],
  );

  if (rows.length === 0) {
    return (
      <p className="mvp-note">
        No per-bar detail was returned, so there is nothing to count. Turn on
        <strong> Bar-by-bar detail</strong> in step 1 and run again.
      </p>
    );
  }

  const totals = funnelTotals(rows);
  const anySpeed = rows.some((r) => r.speed.present);

  return (
    <>
      {/*
        ⚠️ THE FUNNEL IS A TABLE, NOT A CHART. A bar chart of six counts across three symbols is harder to
        read than the numbers, and the numbers are what a reader compares. The chart worth building is the
        price-with-markers one (#1342 step 8), not a redrawing of six integers.
      */}
      <div className="mvp-scroll">
        <table className="mvp-table">
          <caption className="mvp-caption">
            Every bar the engine scored, and what became of it. <strong>Under the bar</strong> is the
            population a lower entry bar would admit — the one number that answers “why so few trades”.
          </caption>
          <thead>
            <tr>
              <th scope="col">Symbol</th>
              {BUCKETS.map((b) => (
                <th key={b.key} scope="col" className="mvp-num">{b.label}</th>
              ))}
              <th scope="col" className="mvp-num">Traded %</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={`${r.symbol}:${r.day ?? ''}`}>
                <th scope="row" className="mvp-nowrap">
                  {r.symbol}
                  {r.day && <span className="mvp-inv-label">{r.day}</span>}
                </th>
                <td className="mvp-num">{r.scored}</td>
                <td className="mvp-num mvp-muted">{r.noData}</td>
                <td className="mvp-num mvp-muted">{r.quiet}</td>
                <td className="mvp-num">{r.barGate}</td>
                <td className="mvp-num">{r.signalNotTraded}</td>
                <td className="mvp-num">{r.entered}</td>
                <td className="mvp-num">{sharePct(r.entered, r.scored)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <th scope="row">All</th>
              <td className="mvp-num">{totals.scored}</td>
              <td className="mvp-num mvp-muted">{totals.noData}</td>
              <td className="mvp-num mvp-muted">{totals.quiet}</td>
              <td className="mvp-num">{totals.barGate}</td>
              <td className="mvp-num">{totals.signalNotTraded}</td>
              <td className="mvp-num">{totals.entered}</td>
              <td className="mvp-num">{sharePct(totals.entered, totals.scored)}</td>
            </tr>
          </tfoot>
        </table>
      </div>

      <h3 className="mvp-depth-title">
        Speed rating
        <span className="mvp-muted">
          {' '}· <code>{SPEED_DIRECTIVE}</code> — 5-bar rate of change, amplified by volume
        </span>
      </h3>
      {anySpeed ? (
        <div className="mvp-scroll">
          <table className="mvp-table">
            <caption className="mvp-caption">
              The protocol’s own speed directive, read per bar. A symbol whose peak is near the ceiling
              moved fast for at least one bar; a low mean says the move was not sustained.
            </caption>
            <thead>
              <tr>
                <th scope="col">Symbol</th>
                <th scope="col" className="mvp-num">Mean score</th>
                <th scope="col" className="mvp-num">Peak</th>
                <th scope="col" className="mvp-num">Ceiling</th>
                <th scope="col" className="mvp-num">Bars read</th>
              </tr>
            </thead>
            <tbody>
              {rows.filter((r) => r.speed.present).map((r) => (
                <tr key={`speed:${r.symbol}:${r.day ?? ''}`}>
                  <th scope="row" className="mvp-nowrap">{r.symbol}</th>
                  <td className="mvp-num">{r.speed.mean.toFixed(1)}</td>
                  <td className="mvp-num">{r.speed.peak.toFixed(0)}</td>
                  <td className="mvp-num mvp-muted">{r.speed.maxScore ?? '—'}</td>
                  <td className="mvp-num">{r.speed.bars}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="mvp-note">
          This run carried no per-directive breakdown, so the speed directive’s own score was not
          recorded. It is scored on every bar regardless — turning on the detail switch records it.
        </p>
      )}
    </>
  );
}
