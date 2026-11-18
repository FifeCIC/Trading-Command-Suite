import { Link } from 'react-router-dom';
import MarketMoversPanel from '../components/MarketMoversPanel';
import StatusCard from '../components/StatusCard';
import './strategy-live.css';

/**
 * StrategyLiveView - the OPTIONAL live half of a strategy page.
 *
 * WHY THE PAGE IS SPLIT THE WAY IT IS: the theory lives in the Strategy Library entry (what the
 * strategy believes, and what would prove it wrong), while THIS page shows the feed that strategy
 * would consume, as it is right now. Two halves of one idea: the reasoning is static, the evidence is
 * live.
 *
 * --- THIS PAGE IS A VIEW, NOT AN ESSAY (rewritten 2026-11-18) -----------------------------------
 *   *"Once again we have blocks of text appearing on the pages ... can we please tidy and organise
 *    UI/UX development rules to do better than this."*
 *
 * The first version led with a two-sentence paragraph and a five-sentence theory block. Both were
 * prose the reader had to work through before reaching the table - which is the only reason the page
 * exists. The full theory already lives in the Strategy Library entry (`src/data/strategy-library.js`),
 * so duplicating it here was also a second copy that could drift.
 *
 * What replaces it:
 *   - ONE row of field/value facts, not a preamble.
 *   - "The claim" and "Proved wrong if" as two one-line rows, because those are what tell a reader
 *     whether the list in front of them means anything.
 *   - Everything longer is one click away.
 *
 * --- WHAT THIS PAGE IS HONEST ABOUT --------------------------------------------------------------
 * "The feed is live" and "the strategy is running" are different claims, and this page refuses to blur
 * them: the table carries its own provider stamp and staleness banner, while the STATUS CARD says the
 * strategy is not trading because no protocol scores it.
 *
 * ONE COMPONENT FOR BOTH SIDES. Winners and losers are the same feed split by direction; what differs
 * is the exposure and the reasoning. Duplicating the page would let the two drift, and the whole point
 * of splitting them is that they are opposites.
 */
export default function StrategyLiveView({
  side,
  headline,
  listKey,
  listTitle,
  facts,
  claim,
  falsifiedBy,
  theoryNote,
  strategyId,
}) {
  const isLong = side === 'long';

  return (
    <div className="slv-page">
      {/* One h1 for assistive tech; the nav and breadcrumb carry it visually. */}
      <h1 className="sr-only">{headline}</h1>

      <div className="slv-status-row">
        <StatusCard
          icon={isLong ? '\u{1F3C6}' : '\u{1F573}\u{FE0F}'}
          value="NOT TRADING"
          label={`${headline} - ${side.toUpperCase()} side`}
          tone="warn"
          detail={
            <>
              <strong>The feed below is live; the strategy is not.</strong> There is no protocol wired
              for this approach yet, so nothing is being scored, sized or entered. What you are looking
              at is the raw material the strategy would consume - the candidates, their move, and how
              old the data is.
              <br />
              <br />
              {theoryNote}
            </>
          }
        />
      </div>

      {/* Facts as field/value pairs, NOT sentences. The paragraph this replaces was four lines of prose
          above a table, which the owner called out by name. */}
      <dl className="slv-facts">
        {facts.map(([term, value]) => (
          <div className="slv-fact" key={term}>
            <dt>{term}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>

      <MarketMoversPanel lists={[listKey]} />

      {/* The two lines that make the table mean something. Longer reasoning lives in the library. */}
      <dl className="slv-facts slv-facts--theory">
        <div className="slv-fact">
          <dt>The claim</dt>
          <dd>{claim}</dd>
        </div>
        <div className="slv-fact">
          <dt>Proved wrong if</dt>
          <dd>{falsifiedBy}</dd>
        </div>
        <div className="slv-fact">
          <dt>Full theory</dt>
          <dd>
            <Link to="/strategies/strategy-library">Strategy Library - {strategyId} &rarr;</Link>
          </dd>
        </div>
      </dl>

      <p className="slv-footnote">
        {listTitle} come from the market-wide movers feed, so they are <strong>not</strong> part of our
        registered universe - that is the point: this shows what the strategy would have to reach
        outside our own symbols to trade.
      </p>
    </div>
  );
}
