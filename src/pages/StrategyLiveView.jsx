import { Link } from 'react-router-dom';
import MarketMoversPanel from '../components/MarketMoversPanel';
import StatusCard from '../components/StatusCard';
import './strategy-live.css';

/**
 * StrategyLiveView — the OPTIONAL live half of a strategy page.
 *
 * Owner direction, 2026-11-18: *"The idea is for strategies to have the standard theory layout with
 * real-time data implemented as we already do in the Strategy (theory) Library and also an option
 * custom page… The goal here is that the new Strategy area allows us to see the finished product of
 * the META.Stack pipeline doing its thing. It is in the theory we understand the strategy and see
 * live samples but it is in the additional (optional) view we will have a true live overview of
 * everything the strategy has done recently and is doing right now."*
 *
 * ── WHAT THIS PAGE IS HONEST ABOUT ──────────────────────────────────────────────────────────────
 * There is a real distinction between "the feed is live" and "the strategy is running", and this page
 * refuses to blur it:
 *
 *   • The FEED below is live and carries its own provider stamp and staleness banner.
 *   • The STRATEGY is NOT trading. There is no protocol to score with, so nothing is being entered,
 *     exited or sized. That is a `StatusCard` with tone `warn`, not a green "active" badge.
 *
 * ⚠️ A page that shows a live market table under a strategy's name, with no statement of whether the
 * strategy is acting on it, is the most misleading thing this area could contain — the reader would
 * reasonably assume entries are being generated. The status card is why they are not.
 *
 * ⚠️ ONE COMPONENT FOR BOTH SIDES. "Top winners" and "top losers" are the same feed split by
 * direction; what differs is the exposure (`long` / `short`) and the reasoning behind it. Duplicating
 * the page would let the two drift, and the whole point of splitting them is that they are opposites.
 */
export default function StrategyLiveView({
  side,
  headline,
  subtitle,
  listKey,
  listTitle,
  theory,
  whySide,
  strategyId,
}) {
  const isLong = side === 'long';

  return (
    <div className="slv-page">
      {/* One h1 for assistive tech; the nav and breadcrumb carry it visually. */}
      <h1 className="sr-only">{headline}</h1>

      <div className="slv-status-row">
        <StatusCard
          icon={isLong ? '🏆' : '🕳️'}
          value="NOT TRADING"
          label={`${headline} — ${side.toUpperCase()} side`}
          tone="warn"
          detail={
            <>
              <strong>The feed below is live; the strategy is not.</strong> There is no protocol
              wired for this approach yet, so nothing is being scored, sized or entered. What you are
              looking at is the raw material the strategy would consume — the candidates, their move,
              and how old the data is.
              <br />
              <br />
              {whySide}
            </>
          }
        />
      </div>

      <p className="slv-lead">
        {subtitle}{' '}
        <Link to="/strategies/strategy-library">Read the theory in the Strategy Library →</Link>
      </p>

      <section className="slv-theory" aria-label="What the strategy does">
        <h2 className="slv-theory-head">The theory this view exists to test</h2>
        <p className="slv-theory-body">{theory}</p>
      </section>

      {/* The panel owns the provenance strip, the staleness refusal and the exclusion audit. `lists`
          narrows it to the one side this strategy trades — the age warning is NOT narrowed. */}
      <MarketMoversPanel lists={[listKey]} />

      <p className="slv-footnote">
        {listTitle} come from the market-wide movers feed. Symbols here are <strong>not</strong> part
        of our registered universe — that is the point of this view: it shows what the strategy would
        have to reach outside our own symbols to trade. Symbol: <code>{strategyId}</code>
      </p>
    </div>
  );
}
