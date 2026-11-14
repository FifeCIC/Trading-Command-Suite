/**
 * trade-basis.ts — the two derived figures that made #1135 unreadable, as PURE functions.
 *
 * ⚠️ WHY THIS IS A SEPARATE MODULE. Both numbers were computed inline inside `run()`, which needs a
 * database, a protocol and a window to reach — so neither could be tested, and #1135's acceptance
 * criterion ("each fix carries a guard test that has been observed to fail without it") could not be
 * met. The arithmetic here is UNCHANGED from what `run()` did; only its address moved.
 *
 * ── WHAT THE UNITS ARE, because that is the whole of #1135 part 1 ─────────────────────────────
 *
 *   `pnl`                      per trade    = netPnl                        ← CURRENCY
 *   `pnlPct`                   per trade    = netPnl / notional × 100       ← % OF THE POSITION
 *   `totalPnl`                 per run      = Σ pnl                         ← CURRENCY
 *   `avgTradePnl`              per run      = mean of `pnlPct`              ← % OF THE POSITION
 *   `avgTradePnlPctOfAccount`  per run      = totalPnl / accountSize …      ← % OF THE ACCOUNT
 *
 * ⚠️ `avgTradePnl` and `avgTradePnlPctOfAccount` are BOTH percentages and are NOT interchangeable.
 * The first is a percentage of the position; the second of the account. With the pre-#1142 floor a
 * BTC position committed ~10× the account, which is where the measured 11.5× gap came from. Do not
 * scale one to match the other — publish both and name the unit.
 *
 * ⚠️ And `avgNotionalFractionOfAccount` (next to these on the result) is a FRACTION, not a percent:
 * 0.994 means 99.4% (#1265 — renamed from `avgNotionalPct` so the unit is in the name). The relation
 * is `avgTradePnlPctOfAccount ≈ avgTradePnl × avgNotionalFractionOfAccount`, with no /100 — verified
 * 0.3104 × 0.994 = 0.3085 against a measured 0.3079.
 */

export interface TradeBasisInput {
  /** Σ of every trade's `pnl`, in CURRENCY. */
  totalPnl: number;
  /** The run's DECLARED starting account — the only denominator that does not move. */
  accountSize: number;
  /** Count of trades actually opened. */
  tradeCount: number;
  /** Count of entry signals produced (trades + refusals). */
  signalCount: number;
  /** Count of signals refused because the position was unaffordable. */
  sizingRefusalCount: number;
}

export interface TradeBasis {
  /** Mean currency P&L per trade as a PERCENT OF THE DECLARED ACCOUNT. */
  avgTradePnlPctOfAccount: number;
  /** `signalCount - tradeCount`. Published whether or not it reconciles. */
  signalsWithoutTrade: number;
  /** A warning string when the populations do not reconcile, else null. */
  populationMismatch: string | null;
}

/**
 * The affordability refusal is the ONLY path that turns an entry signal into no trade, so
 * `signals − trades` MUST equal the refusal count. Equality is expected and is not evidence of the
 * old #980 conflation. A MISMATCH means a second separator was introduced without being counted,
 * and the two numbers a reader compares have silently stopped describing the same thing.
 *
 * ⚠️ Reported, never thrown: a mismatch makes the REPORT wrong, not the measurement, and discarding
 * a completed run would be worse than recording it with the disagreement stated.
 */
export function tradeBasis(input: TradeBasisInput): TradeBasis {
  const { totalPnl, accountSize, tradeCount, signalCount, sizingRefusalCount } = input;

  // `accountSize > 0` guards the division; `(tradeCount || 1)` reproduces the original: a run with
  // no trades must not produce NaN/Infinity, and `totalPnl` is 0 in that case anyway.
  const avgTradePnlPctOfAccount =
    accountSize > 0 ? (totalPnl / (accountSize * (tradeCount || 1))) * 100 : 0;

  const signalsWithoutTrade = signalCount - tradeCount;

  const populationMismatch =
    signalsWithoutTrade === sizingRefusalCount
      ? null
      : `${signalCount} signals − ${tradeCount} trades = ${signalsWithoutTrade}, but ` +
        `${sizingRefusalCount} sizing refusal(s) were recorded. Something else is now separating ` +
        'signals from trades without being counted (#1135).';

  return { avgTradePnlPctOfAccount, signalsWithoutTrade, populationMismatch };
}
