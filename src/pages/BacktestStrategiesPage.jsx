/**
 * BacktestStrategiesPage — `/lab/backtest-strategies` (owner direction, 2026-10-26).
 *
 * A COMPLETE STRATEGY is a bot: a protocol plus execution. So this page asks for everything the
 * protocol page does **and** the execution settings — stop, target, entry bar, costs and sizing —
 * and every one of those starts at the BOT'S OWN VALUE. Changing one is the experiment; the page
 * lists the changes before the run and the engine echoes the same list afterwards
 * (`drivenBy.overridden`).
 *
 * ⚠️ TRADE SIZE IS STILL THE GAP. The bot sizes in LOTS, the backtester in UNITS, and the conversion
 * needs `contractSize`, which the bridge serves but nothing in between keeps (#1143). The page states
 * that rather than printing a size it cannot stand behind.
 */
import BacktestPage from './BacktestPage';

export default function BacktestStrategiesPage() {
  return <BacktestPage subject="strategy" />;
}
