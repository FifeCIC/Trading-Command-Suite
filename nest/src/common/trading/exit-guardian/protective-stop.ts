/**
 * protective-stop.ts — THE protective stop price, once.
 *
 * ── WHY THIS EXISTS (2026-11-20) ───────────────────────────────────────────────────────────────
 * The same expression was written in two places and both call it "the protective stop":
 *
 *   `automation/stop-guardian.service.ts`  ·  `protectiveSl()`      — entry × (1 ∓ slPct/100)
 *   `backtest/backtest.service.ts`         ·  the bracket's slPrice — entry × (1 ∓ slPct/100)
 *
 * The first places a FLOOR at the broker; the second tests a simulated level against every bar. Two
 * implementations of one formula is how a 1% stop becomes 1% in one place and 1% rounded elsewhere —
 * and neither would report it.
 *
 * ⚠️ THE ROUNDING IS PART OF THE RULE, NOT A DISPLAY CHOICE. The guardian rounds to 5 decimal places
 * because that is what it sends to the broker as a price; a backtest that skipped the rounding would
 * test a level the live path never places. `decimals` is explicit so a caller cannot "tidy" it.
 *
 * ⚠️ **`slPct: 0` MEANS TWO DIFFERENT THINGS IN THE TWO CALLERS**, and that is recorded rather than
 * resolved here, because changing either would alter behaviour that is already in use:
 *   · LIVE (this function, matching `Number(x ?? 1) || 1`): 0 falls back to **1%**.
 *   · BACKTEST: `doBrackets = slPct > 0 && tpPct > 0`, so 0 means **no bracket at all**.
 * A negative value is REFUSED here (`null`) rather than reproducing live's stop-above-entry arithmetic.
 * Register row 238; both readings are asserted in `exit-decisions.spec.ts`.
 *
 * Part of the #1242 extraction. Pure: no Nest, no Prisma, no clock.
 */
import type { TradeSide } from './simulated-tsl';

export interface ProtectiveStopInput {
  side: TradeSide;
  /** The reference price the percentage is measured from. */
  entryPrice: number;
  /** Distance in percent. `null`/0/negative means NO STOP, which is the caller's decision to make. */
  slPct?: number | null;
  /** Decimal places the price is expressed to. Defaults to the guardian's 5. */
  decimals?: number;
}

/**
 * The stop price, or `null` when the inputs cannot express one.
 *
 * ⚠️ `null` IS NOT "no stop needed" — it is "not configured or not measurable". A caller that treats
 * `null` as 0 would place a stop at the entry price and close every trade on the next tick.
 */
export function protectiveStopPrice(input: ProtectiveStopInput): number | null {
  const entry = Number(input.entryPrice);
  if (!Number.isFinite(entry) || entry <= 0) return null;

  const pct = Number(input.slPct ?? 1) || 1;
  if (!Number.isFinite(pct) || pct <= 0) return null;

  const decimals = Number.isInteger(input.decimals) ? (input.decimals as number) : 5;
  const raw = input.side === 'buy' ? entry * (1 - pct / 100) : entry * (1 + pct / 100);
  if (!Number.isFinite(raw) || raw <= 0) return null;

  return Number(raw.toFixed(decimals));
}

/**
 * Is the stop hit on this bar?
 *
 * ⚠️ BAR ORDER CANNOT BE RECOVERED. With OHLC, a bar that traded both the stop and the target has an
 * unknowable sequence, so the caller must decide which is tested first and SAY SO — the backtest's
 * documented choice is stop-before-target (`STOP FIRST` in the trade loop). This function answers one
 * question only, so that choice stays visible at the call site rather than hiding here.
 */
export function protectiveStopHit(input: {
  side: TradeSide;
  stopPrice: number;
  /** The bar's adverse extreme: `low` for a buy, `high` for a sell. */
  adverseExtreme: number;
}): boolean {
  if (!Number.isFinite(input.stopPrice) || !Number.isFinite(input.adverseExtreme)) return false;
  return input.side === 'buy'
    ? input.adverseExtreme <= input.stopPrice
    : input.adverseExtreme >= input.stopPrice;
}
