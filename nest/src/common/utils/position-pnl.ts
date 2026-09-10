/**
 * Canonical position P&L maths — the ONE place direction is applied.
 *
 * Why this exists (2026-09-10, data-quality investigation of the Ladder
 * "Details" panel):
 *
 *   `unrealizedPnlPct` was computed inline in six places as
 *   `((current - avg) / avg) * 100` — correct for longs, INVERTED for shorts.
 *   A profitable short therefore reported a NEGATIVE percentage, so `pnl` and
 *   `pnlPct` disagreed inside the same API payload
 *   (XAUUSD short: pnl +56.13 but pnlPct −1.70%).
 *
 * The frontend already did this correctly
 * (`src/components/mt5/PositionsTable.jsx` → `p.type === 1 ? -1 : 1`), so the
 * backend was the outlier — hence a shared helper instead of another inline
 * formula.
 *
 * Rules:
 *  1. Direction comes from `side`. Never infer it from the sign of the price move.
 *  2. Broker-reported `pnl` is already sign-correct — prefer it over a computed
 *     amount, and only use the computed amount as a fallback.
 *  3. `pnl` and `pnlPct` must always agree in sign. Derive both here together.
 */

/** `'buy' | 'sell' | 0 | 1` — MT5 uses numeric type codes (0 = buy, 1 = sell). */
export type PositionSide = string | number | null | undefined;

/** True when the row states its direction — unknown sides cannot be inferred. */
export function isSideKnown(side: PositionSide): boolean {
  if (typeof side === 'number') return side === 0 || side === 1;
  const s = String(side ?? '').trim().toLowerCase();
  return s === 'buy' || s === 'sell' || s === 'long' || s === 'short' || s === 's' || s === 'l';
}

/** Normalise any broker's side representation to 'buy' | 'sell'. */
export function normalizeSide(side: PositionSide): 'buy' | 'sell' {
  if (typeof side === 'number') return side === 1 ? 'sell' : 'buy';
  const s = String(side ?? '').trim().toLowerCase();
  if (s === 'sell' || s === 'short' || s === 's' || s === '1') return 'sell';
  return 'buy';
}

/** +1 for a long, −1 for a short. Unknown/absent side is treated as long. */
export function sideDirection(side: PositionSide): 1 | -1 {
  return normalizeSide(side) === 'sell' ? -1 : 1;
}

/** Coerce to a finite number, treating null/undefined/'' as "no value". */
function toFiniteNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '' || typeof value === 'boolean') {
    return null;
  }
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * Unrealized P&L as a percentage of cost, side-aware.
 * Returns null when the inputs cannot produce a meaningful percentage — a
 * missing or non-positive price must not be coerced to 0 (that reported a
 * fabricated −100%).
 */
export function unrealizedPnlPct(
  avgPrice: number | null | undefined,
  currentPrice: number | null | undefined,
  side: PositionSide,
): number | null {
  const avg = toFiniteNumber(avgPrice);
  const current = toFiniteNumber(currentPrice);
  if (avg === null || current === null || avg <= 0 || current <= 0) return null;
  return ((current - avg) / avg) * 100 * sideDirection(side);
}

/**
 * Unrealized P&L amount, side-aware. `quantity` is treated as a magnitude, so a
 * broker that reports short size as a negative number still yields the sign of
 * the profit, not a double negative.
 */
export function unrealizedPnlAmount(
  avgPrice: number | null | undefined,
  currentPrice: number | null | undefined,
  quantity: number | null | undefined,
  side: PositionSide,
): number | null {
  const avg = toFiniteNumber(avgPrice);
  const current = toFiniteNumber(currentPrice);
  const qty = toFiniteNumber(quantity);
  if (avg === null || current === null || qty === null || avg <= 0 || current <= 0) {
    return null;
  }
  return (current - avg) * Math.abs(qty) * sideDirection(side);
}

export interface ResolvedPositionPnl {
  /** Sign-correct unrealized P&L amount, or null when it cannot be derived. */
  pnl: number | null;
  /** Sign-aligned percentage of cost, or null when it cannot be derived. */
  pnlPct: number | null;
  /**
   * True when the stored amount contradicted the current prices and was replaced
   * by the price-derived amount (a stale row whose price moved on without it).
   */
  amountOverridden?: boolean;
}
/**
 * Resolve the (pnl, pnlPct) pair for a position row from any data source.
 *
 * Prefers broker-reported values — `brokerPnl` when present, then `brokerPnlPct`
 * — and falls back to the side-aware computation. The returned pair is
 * guaranteed to agree in sign: if the broker's percentage contradicts the
 * resolved amount, the amount wins and the percentage is recomputed.
 */
export function resolvePositionPnl(args: {
  side: PositionSide;
  avgPrice: number | null | undefined;
  currentPrice: number | null | undefined;
  quantity?: number | null;
  brokerPnl?: number | null;
  brokerPnlPct?: number | null;
  /** Decimal places for pnlPct (undefined = raw). */
  roundPctTo?: number;
}): ResolvedPositionPnl {
  const { side, avgPrice, currentPrice, quantity, brokerPnl, brokerPnlPct, roundPctTo } = args;

  const computedAmount = unrealizedPnlAmount(avgPrice, currentPrice, quantity, side);
  const brokerAmount = toFiniteNumber(brokerPnl);
  let pnl = brokerAmount ?? computedAmount;
  let amountOverridden = false;

  // Mixed provenance: a stored amount and a price-derived percentage come from
  // different moments. `price-refresh.service` updates `currentPrice` without
  // recomputing `pnl`, so a row can drift into a self-contradicting pair
  // (QNTM 2026-09-10: pnl +0.22 vs pnlPct −0.30%).
  const amountsDisagree = pnl != null && pnl !== 0
    && computedAmount != null && computedAmount !== 0
    && Math.sign(pnl) !== Math.sign(computedAmount);

  if (amountsDisagree) {
    if (isSideKnown(side)) {
      // Direction is stated, so the price-derived amount is trustworthy — the
      // stored amount is the stale half of the pair.
      pnl = computedAmount;
      amountOverridden = true;
    } else {
      // Direction unknown (legacy row): the price-derived amount may be
      // inverted, so keep the broker amount and publish no percentage rather
      // than a pair that contradicts itself.
      return { pnl, pnlPct: null, amountOverridden };
    }
  }

  const brokerPercent = toFiniteNumber(brokerPnlPct);
  let pnlPct = brokerPercent ?? unrealizedPnlPct(avgPrice, currentPrice, side);

  // Agreement guard: a percentage that contradicts the amount's sign is wrong
  // (this is the exact shape of the reported bug) — recompute from prices.
  if (pnl != null && pnl !== 0 && pnlPct != null && Math.sign(pnlPct) !== Math.sign(pnl)) {
    pnlPct = unrealizedPnlPct(avgPrice, currentPrice, side);
  }

  if (pnlPct != null && roundPctTo !== undefined) {
    const factor = 10 ** roundPctTo;
    pnlPct = Math.round(pnlPct * factor) / factor;
  }

  return { pnl, pnlPct, amountOverridden };
}
