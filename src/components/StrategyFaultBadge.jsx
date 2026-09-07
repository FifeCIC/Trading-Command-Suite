import { isFaultyStrategy } from '../core/strategy-filters';

/**
 * StrategyFaultBadge — the "this strategy has a data issue" banner.
 * Single renderer for the faulty predicate + icon/message. The page supplies
 * its own className (and optional style) so presentation stays local while
 * the decision and message text stay in one place.
 */
export default function StrategyFaultBadge({ strategy, className = 'sl-card-warning', style }) {
  if (!isFaultyStrategy(strategy)) return null;
  const pending = strategy.dataStatus === 'pending_bars';
  return (
    <div className={className} style={style}>
      {pending ? '⏳' : '🚫'} {strategy.dataStatusReason || strategy.dataStatus}
    </div>
  );
}
