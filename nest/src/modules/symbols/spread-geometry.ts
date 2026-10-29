/**
 * spread-geometry — turns a measured spread percentage into the two other framings a human needs.
 *
 * A percentage alone is unreadable at both ends of the range:
 *   VIX    0.930%  → sounds modest, but a 1% move IS the whole trade and the spread takes 93% of it.
 *   US500  0.005%  → sounds free, and it nearly is: 0.4 of the 77 points in a 1% move.
 *
 * Same defect shape as the rest of this repo: a plausible number with no error. The fix is to print the
 * points and the ticks next to the percentage, so nobody has to convert in their head.
 *
 * ⚠️ UNITS — the caller sends `spreadPct` as PERCENT of price (0.9297 means 0.9297%). This module returns
 * `eatsShareOfOnePctMove` as a FRACTION of a 1% move (0.93 = 93%), and the UI formats it once with ×100.
 * That split exists because the first cut returned the fraction and the page rendered
 * "eats 1% of a 1% move". Returning the raw fraction and formatting in one place is the only version that
 * cannot be printed as a percentage by mistake.
 */

export interface SpreadGeometryInput {
  /** Spread as a PERCENT of price — 0.9297 means 0.9297%. */
  spreadPct: number | null;
  /** Spread in price units — 0.17 on a VIX quote of 18.20. */
  spreadAbs: number | null;
  /** Broker `digits` from `broker_symbol`. VIX is 2 → tick 0.01. */
  digits: number | null;
}

export interface SpreadGeometry {
  /** Size of one tick in price units, derived from `digits` — never guessed. */
  tickSize: number | null;
  /** How many whole ticks the spread spans. 0.17 / 0.01 = 17. */
  ticks: number | null;
  /** FRACTION (0.93 = 93%) of a 1% price move consumed by the spread. */
  eatsShareOfOnePctMove: number | null;
}

/** A 1% move, as a fraction of price. Named so the comparison below is not a magic number. */
const ONE_PCT_MOVE = 0.01;

export function spreadGeometry(input: SpreadGeometryInput): SpreadGeometry {
  const { spreadPct, spreadAbs, digits } = input;

  const tickSize = digits == null ? null : Number((10 ** -digits).toFixed(8));
  const ticks =
    tickSize && spreadAbs != null ? Number((spreadAbs / tickSize).toFixed(2)) : null;
  const eatsShareOfOnePctMove =
    spreadPct == null ? null : Number((spreadPct / 100 / ONE_PCT_MOVE).toFixed(4));

  return { tickSize, ticks, eatsShareOfOnePctMove };
}
