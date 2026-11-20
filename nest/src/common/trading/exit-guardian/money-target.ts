/**
 * money-target.ts — the per-bot MONEY take-profit decision (`takeProfitAmount`), once.
 *
 * ── WHY IT IS A SEPARATE DECISION FROM `tpPct` ──────────────────────────────────────────────────
 * Measured in the guardian's own docblock: `tpPct` is a DISTANCE from entry, so the money it captures
 * drifts with the price level — 0.23% on GER40 at 25,701 is GBP 4.93 and at 30,000 it is GBP 5.75. A
 * five-pound target cannot be expressed as a percentage, so the app has a second, absolute target.
 *
 * ── WHAT IS AND IS NOT EXTRACTED ────────────────────────────────────────────────────────────────
 * The DECISION (`reached`) is here. The close, the retry cadence and the logging stay in the guardian:
 * they are IO, and a pure module that sends orders is not pure.
 *
 * ⚠️ FAIL CLOSED, ALWAYS. Every unknown refuses and returns a reason — a target that cannot be judged
 * must never close a position, and "P&L unreadable" must never be read as zero.
 */

export interface MoneyTargetInput {
  /** `trading_strategy.takeProfitAmount`, in the account currency. NULL/0 = no opinion. */
  targetAmount?: number | null;
  /** Unrealised P&L in the same currency. `null` when the broker did not report one. */
  pnl?: number | null;
}

export interface MoneyTargetVerdict {
  /** FALSE when the bot has no money target — 68 of 69 bots, and that is the default. */
  configured: boolean;
  /** TRUE only when a finite P&L has reached a configured target. */
  reached: boolean;
  /** Why it is not reached, when it is not — so "no target" and "not yet" never look alike. */
  reason: 'not-configured' | 'pnl-unreadable' | 'below-target' | null;
}

export function moneyTargetVerdict(input: MoneyTargetInput): MoneyTargetVerdict {
  const target = Number(input.targetAmount);
  // NULL / 0 is "no opinion", not "close at breakeven". The column defaults to NULL, so this guard is
  // what keeps the inert bots inert.
  if (!Number.isFinite(target) || target <= 0) {
    return { configured: false, reached: false, reason: 'not-configured' };
  }

  if (input.pnl === null || input.pnl === undefined) {
    return { configured: true, reached: false, reason: 'pnl-unreadable' };
  }
  const pnl = Number(input.pnl);
  if (!Number.isFinite(pnl)) {
    return { configured: true, reached: false, reason: 'pnl-unreadable' };
  }

  return pnl >= target
    ? { configured: true, reached: true, reason: null }
    : { configured: true, reached: false, reason: 'below-target' };
}
