/**
 * execution-costs.ts — apply spread and slippage to a backtest entry/exit, AS PERCENTAGES.
 *
 * WHY THIS IS A MODULE AND NOT TWO INLINE LINES (#1146)
 * -----------------------------------------------------
 * The engine used to do:
 *
 *     const entryCost = currentClose + (spread / 2) + slippage;
 *
 * which adds `0.015` to the PRICE. `spread` and `slippage` are stored, labelled and displayed as decimals
 * of price — `BacktestPage.jsx` titles the input *"Slippage as decimal (0.01 = 1%)"* and prints
 * *"break-even move X% of price"* — so the charge came out as `0.015 / price`. Correct only for an
 * instrument priced near 1.00:
 *
 *     VIX (~17.00)      3.0% nominal → 0.088% charged   (17x too little)
 *     BTC (~100,000)    3.0% nominal → ~0.000015%       (effectively free)
 *     a $1 stock        3.0% nominal → 3.0%             (right by accident)
 *
 * MEASURED 2026-10-28: the same window at a nominal 3% and at 0.04% differed by **0.18pp per trade** —
 * `0.03 / 17.00 = 0.176%`. That division IS the bug, and it is why this now lives in one tested function:
 * an inline expression twice in a row can be "fixed" one of the two times.
 *
 * ⚠️ THE UNIT IS THE WHOLE POINT. The cost is a FRACTION of price, so the same configuration charges the
 * same PERCENTAGE whatever the instrument is priced at. If a future change makes the charge depend on the
 * absolute price, `execution-costs.spec.ts` fails.
 */

/**
 * @param close      the bar's close (the "mid" the entry is priced from)
 * @param exitPrice  the level the trade exited at (SL/TP/EOD), in the same units as `close`
 * @param spread     decimal of price — 0.01 = 1% total spread, half of it each side
 * @param slippage   decimal of price — 0.01 = 1%, charged on BOTH entry and exit
 */
export function applyExecutionCosts(
  close: number,
  exitPrice: number,
  spread: number,
  slippage: number,
): { entryCost: number; exitCost: number } {
  // Entry: buy at ask = mid + half the spread + slippage. Exit: sell at bid = price − the same again.
  // Rounded to 8dp so a float artefact cannot leak into a stored price.
  const entryCost = round8(close * (1 + spread / 2 + slippage));
  const exitCost = round8(exitPrice * (1 - spread / 2 - slippage));
  return { entryCost, exitCost };
}

/** The round trip a trade must cover before it is flat, as a FRACTION of price (0.03 = 3%). */
export function roundTripCost(spread: number, slippage: number): number {
  return spread + 2 * slippage;
}

const round8 = (v: number) => Math.round(v * 1e8) / 1e8;
