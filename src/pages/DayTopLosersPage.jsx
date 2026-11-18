import StrategyLiveView from './StrategyLiveView';

/**
 * DayTopLosersPage - the SHORT side of the day's big movers.
 *
 * THE SHORT SIDE IS NOT THE LONG SIDE MIRRORED, and that is the whole reason it is a separate strategy
 * (the two are separate strategies by decision, not by preference):
 *
 *   - A share price cannot fall below zero, so the payoff of a short is BOUNDED while its loss is not -
 *     the inverse of going long.
 *   - Shorting has frictions a long never sees: borrow availability and cost, and a stock can be hard
 *     to borrow precisely when it is collapsing.
 *   - A stock down 80% is often down because of a real, continuing event (guidance, fraud, dilution),
 *     which makes continuation MORE likely than for an equivalent up-move - and a squeeze is violent.
 *
 * A page that mirrored the winners logic with the sign flipped would be wrong in three ways at once.
 */
export default function DayTopLosersPage() {
  return (
    <StrategyLiveView
      side="short"
      strategyId="day-top-losers"
      headline="Day's Top Losers"
      listTitle="Top losers"
      listKey="losers"
      facts={[
        ['Side', 'SHORT - and the asymmetry is the strategy, not a detail'],
        ['Universe', 'Every listed US share the feed screens - not our watchlists'],
        ['Ranked by', 'Session change %, largest fall first'],
        ['Frictions', 'Borrow must be available and its cost accrued; a squeeze gaps through stops'],
      ]}
      claim="A large single-session fall is a continuing event, because the holders who have not yet sold are still deciding to."
      falsifiedBy="Shorts selected this way producing a return distribution no different from a random liquid short, net of borrow."
      theoryNote={
        'Short because the list is ranked by losses. Two hard constraints: borrow - a collapsing stock ' +
        'may not be shortable at all - and the squeeze, which is why the stop here is tighter than the ' +
        'equivalent long trade.'
      }
    />
  );
}
