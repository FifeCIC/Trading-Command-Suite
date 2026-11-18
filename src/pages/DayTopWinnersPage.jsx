import StrategyLiveView from './StrategyLiveView';

/**
 * DayTopWinnersPage — the LONG side of the day's big movers.
 *
 * Split from "Day's Top Losers" 2026-11-18 (owner): *"I want you to split that strategy into Days Top
 * Winners and Days Top Losers: we will have them entered onto [the Strategy Library] as two new
 * strategies: one for shorting and one for going long!"*
 *
 * ⚠️ TWO STRATEGIES, NOT ONE WITH A TOGGLE. A winners list is entered LONG — momentum continuation —
 * while a losers list is entered SHORT, and the two need opposite things: a long wants the move to
 * keep going and needs a stop under structure, a short of a falling stock is fighting borrow costs,
 * gap risk and the fact that prices floor at zero. One page with a direction switch would have to
 * hold both sets of rules and would state neither.
 *
 * The copy lives beside the view rather than in the library data because it describes what the READER
 * is looking at on THIS page; the strategy's own theory is a library entry.
 */
export default function DayTopWinnersPage() {
  return (
    <StrategyLiveView
      side="long"
      strategyId="day-top-winners"
      headline="Day's Top Winners — the long side"
      listTitle="Top gainers"
      listKey="winners"
      subtitle={
        'The biggest gainers in the whole market today, including symbols we do not hold and have ' +
        'never scored. This is the LONG half of the movers idea: the candidates a momentum-entry ' +
        'strategy would choose from.'
      }
      theory={
        'Momentum continuation: a large single-session gain is treated as evidence of a catalyst — ' +
        'news, an earnings surprise, an upgrade — rather than as noise, and the assumption under test ' +
        'is that the buying continues into the next session. The failure mode is equally well known ' +
        'and is the reason this is a THEORY and not a switch: big gainers mean-revert hard, so the ' +
        'entry needs a volume and velocity filter, an exhaustion check, and a stop that is closer ' +
        'than a normal trend trade would use. Nothing here is wired to a protocol yet.'
      }
      whySide={
        'Long because the list is ranked by gains: the direction of the move is the direction of the ' +
        'trade, and the risk is that the move is already over by the time it is visible.'
      }
    />
  );
}
