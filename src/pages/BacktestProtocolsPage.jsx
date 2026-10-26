/**
 * BacktestProtocolsPage — `/lab/backtest` (owner direction, 2026-10-26).
 *
 * ⚠️ WHY A WRAPPER RATHER THAN A SECOND IMPLEMENTATION. The owner asked for the Lab to be split:
 * *"I think I'm complicating things by merging protocol scoring backtesting with full strategy
 * backtesting. The code will be much more complex. Lets separate them."* The two subjects share
 * everything that makes a Lab run honest — the frozen window, the timeframe coverage gate, the
 * comparison guard, the stored run — so a copy would drift and only one copy would get the next fix.
 *
 * `BacktestPage` already knew how to render one subject; it just derived that from a toggle. The
 * split makes the ROUTE the decision, so each page can be linked, bookmarked and described on its
 * own, while the engine-facing logic stays in one place.
 *
 * A protocol produces SCORES. It has no position size, stop, spread or account, so this page's
 * configuration steps never ask for them — see the `scoresOnly` branch in `BacktestPage`.
 */
import BacktestPage from './BacktestPage';

export default function BacktestProtocolsPage() {
  return <BacktestPage subject="protocol" />;
}
