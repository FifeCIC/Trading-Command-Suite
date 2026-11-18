import StrategyLiveView from './StrategyLiveView';

/**
 * DayTopWinnersPage - the LONG side of the day's big movers.
 *
 * Split from "Day's Top Losers" 2026-11-18 (owner): *"I want you to split that strategy into Days Top
 * Winners and Days Top Losers: we will have them entered onto [the Strategy Library] as two new
 * strategies: one for shorting and one for going long!"*
 *
 * TWO STRATEGIES, NOT ONE WITH A TOGGLE. A winners list is entered LONG - momentum continuation - while
 * a losers list is entered SHORT, and the two need opposite things: a long wants the move to keep going
 * and needs a stop under structure; a short of a falling stock is fighting borrow costs, gap risk and
 * the fact that prices floor at zero. One page with a direction switch would have to hold both sets of
 * rules and would state neither.
 */
export default function DayTopWinnersPage() {
  return (
    <StrategyLiveView
      side="long"
      strategyId="day-top-winners"
      headline="Day's Top Winners"
      listTitle="Top gainers"
      listKey="winners"
      facts={[
        ['Side', 'LONG - the direction of the move is the direction of the trade'],
        ['Universe', 'Every listed US share the feed screens - not our watchlists'],
        ['Ranked by', 'Session change %, largest gain first'],
        ['Data', 'Daily change from the provider screener; the age is shown above the table'],
      ]}
      claim="A large single-session gain marks a catalyst, and the buying persists into the next session."
      falsifiedBy="Gainers, held for the defined window with these filters, returning the same distribution as randomly selected liquid shares."
      theoryNote={
        'Long because the list is ranked by gains, and the risk is that the move is already over by the ' +
        'time it is visible. Big gainers mean-revert hard, so this needs a volume filter, an exhaustion ' +
        'check, and a stop closer than a normal trend trade.'
      }
    />
  );
}
