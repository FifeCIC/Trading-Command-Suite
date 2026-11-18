import StrategyLiveView from './StrategyLiveView';

/**
 * DayTopLosersPage — the SHORT side of the day's big movers.
 *
 * ⚠️ THE SHORT SIDE IS NOT THE LONG SIDE MIRRORED, and that is the whole reason it is a separate
 * strategy (owner, 2026-11-18: *"one for shorting and one for going long"*):
 *
 *   • A share price cannot fall below zero, so the payoff of a short is BOUNDED while its loss is not
 *     — the inverse of going long.
 *   • Shorting has frictions a long never sees: borrow availability and cost, and the fact that a
 *     stock can be hard to borrow precisely when it is collapsing.
 *   • A stock down 80% is often down because of a real, continuing event (guidance, fraud, dilution),
 *     which makes continuation MORE likely than for an equivalent up-move — and the exhaustion
 *     behaviour is different, because a short squeeze is violent and fast.
 *
 * A page that mirrored the winners logic with the sign flipped would be wrong in three ways at once.
 */
export default function DayTopLosersPage() {
  return (
    <StrategyLiveView
      side="short"
      strategyId="day-top-losers"
      headline="Day's Top Losers — the short side"
      listTitle="Top losers"
      listKey="losers"
      subtitle={
        'The biggest fallers in the whole market today. This is the SHORT half of the movers idea: ' +
        'the candidates a short-side momentum strategy would choose from, with the frictions of ' +
        'shorting treated as part of the strategy rather than as an afterthought.'
      }
      theory={
        'Downside continuation: a large single-session fall is treated as evidence of a catalyst that ' +
        'has not finished — guidance cuts, dilution, an accounting problem — and the assumption under ' +
        'test is that selling continues. What makes this a separate theory rather than a mirror of the ' +
        'winners side is the asymmetry: the gain is capped at 100% while the loss is not, borrow cost ' +
        'accrues for as long as the position is open, and the exit that matters is a squeeze, which ' +
        'arrives faster and larger than an equivalent long-side reversal.'
      }
      whySide={
        'Short because the list is ranked by losses. The two hard constraints are borrow — a collapsing ' +
        'stock may not be shortable at all — and the squeeze, which is the reason a stop here has to ' +
        'be tighter than the equivalent long trade.'
      }
    />
  );
}
