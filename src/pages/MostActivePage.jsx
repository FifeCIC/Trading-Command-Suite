import MarketMoversPanel from '../components/MarketMoversPanel';
import './strategy-live.css';

/**
 * MostActivePage — the "Most active" list as RESEARCH, not as a strategy.
 *
 * --- WHY THIS IS RESEARCH AND NOT A STRATEGY PAGE -------------------------------------------------
 * The owner's own suspicion is correct, and it is worth writing down so nobody "promotes" this later
 * without answering it: **volume is not direction.** "Top gainers" and "top losers" are ranked by a
 * SIGNED move, so each carries an implied side. "Most active" is ranked by an UNSIGNED quantity — a
 * name can top this list while closing flat, or while gapping both ways inside one session.
 *
 * A strategy needs a directional thesis to size and stop against. What this list actually provides is
 * a **candidate universe**: names where liquidity and attention are concentrated today, which is
 * useful input to *other* strategies (the mover lists, breakout work) rather than a thesis of its own.
 * Turning it into a strategy would mean inventing a direction the data does not contain.
 *
 * So: it lives in Research, it is presented as a watchlist of activity, and it says so.
 */
export default function MostActivePage() {
  return (
    <div className="slv-page">
      {/* One h1 for assistive tech; the nav and breadcrumb carry it visually. */}
      <h1 className="sr-only">Most active — volume without direction</h1>

      <section className="slv-theory" aria-label="Why this is not a strategy">
        <h2 className="slv-theory-head">A candidate list, not a thesis</h2>
        <p className="slv-theory-body">
          This list is ranked by <strong>volume</strong>, which has no direction. A name can be the
          most traded of the day while closing flat. What it tells you is where liquidity and
          attention are concentrated — useful as an input to a directional strategy, not a strategy in
          its own right. The two directional lists live in the Strategies area as{' '}
          <em>Day&apos;s Top Winners</em> and <em>Day&apos;s Top Losers</em>.
        </p>
      </section>

      <MarketMoversPanel lists={['mostActive']} />

      <p className="slv-footnote">
        The provenance strip above is not decoration: this feed has been measured returning a
        previous-session stamp, and a stale list is refused rather than presented as today&apos;s
        activity.
      </p>
    </div>
  );
}
