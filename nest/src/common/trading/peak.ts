/**
 * peak.ts — the durable peak record (#998). PURE and exported so it can be tested
 * without a database, a bridge or a clock.
 *
 * ── WHY THIS EXISTS ──
 *
 * Owner, 2026-09-25: *"another later-afternoon to evening drift into the red after sitting with
 * profit… it was steady and we bled that instead of slowly bringing trailing stop up."*
 *
 * Measured that day: FOUR positions were in profit and closed red, three of them by the time
 * stop, and two indices surrendered ~90% of their best move. But **none of that was readable
 * from the database** — it had to be RECONSTRUCTED from `marketbar` highs between `openedAt`
 * and `closedAt`, because no maximum-favourable-excursion column existed anywhere.
 *
 * A reconstruction is an indication. A record is evidence. That difference is the whole reason
 * these helpers exist: without a stored peak, this issue can never be re-verified, because
 * every future answer would be recomputed from bars and would move as the bar data moves.
 *
 * ⚠️ THIS IS A RECORD, NOT AN EXIT ACTION. It must not be gated behind `simTslEnabled` or any
 * other arming switch — a peak is something we OBSERVED, and gating it would make "did we give
 * back profit?" depend on whether an unrelated control happened to be on.
 *
 * ⚠️ THIS FILE CONTAINS NO MATH THAT AFFECTS A TRADING DECISION. It computes a high-water mark
 * and a signed percentage. Nothing here sizes, gates or places anything, so it is NOT subject to
 * `maths-change-requires-ab.instructions.md`. The **decay** half of #998 — using this record to
 * tighten a trail with age — IS a maths change and is deliberately not built here.
 */

/**
 * nextPeak() — the high-water mark, and the ONE rule that makes it trustworthy.
 *
 * ⚠️ A PEAK IS MONOTONIC. Once a position has reached a price, no later reading may lower the
 * recorded peak — not a worse quote, not a smaller one, not a stale one. A peak that can go
 * DOWN is not a peak: it is a last-price field with a misleading name, and every downstream
 * answer about give-back would silently be wrong in the direction that flatters us.
 *
 * ⚠️ AN UNKNOWN CANDIDATE MUST NOT ERASE A KNOWN PEAK. `null`/`NaN`/negative means "we could not
 * price it this tick", which is NOT evidence the peak was lower. Returning `candidate` here
 * would reset the record on every provider blip — the same class of defect as the `||` that made
 * a partial MT5 snapshot look authoritative (#1058).
 *
 * Returns null ONLY when nothing has ever been observed.
 */
export function nextPeak(
  prev: number | null | undefined,
  candidate: number | null | undefined,
): number | null {
  const c = Number(candidate);
  const hasCandidate = candidate != null && Number.isFinite(c);

  const p = Number(prev);
  const hasPrev = prev != null && Number.isFinite(p);

  if (!hasCandidate) return hasPrev ? p : null;
  if (!hasPrev) return c;

  return c > p ? c : p;
}

/**
 * profitPctFor() — the position's profit as a SIGNED percentage of entry, so a peak percentage
 * is comparable across instruments of wildly different price scales.
 *
 * ⚠️ SIGN MATTERS AND IS NOT DECORATION. A peak profit of −0.2% is a materially different fact
 * from a peak of +0.2%, and both are different from "no peak recorded". Flattening the sign, or
 * coalescing null to 0, collapses those three into one — which is precisely the defect
 * `development-status.instructions.md` names as "distinguish fine from cannot judge".
 *
 * ⚠️ SIDE IS READ, NOT ASSUMED. `sell`/`short` gains when price FALLS. Treating every position
 * as long would invert the peak for every short — and invert it in the flattering direction for
 * a losing short, which is the failure mode hardest to notice.
 *
 *   buy / long  → (price − entry) / entry × 100
 *   sell / short → (entry − price) / entry × 100
 *
 * An unknown or missing side is treated as LONG, matching the schema comment on
 * `Position.side` (`// buy | sell`) where long is the overwhelming majority. That choice is
 * stated rather than silent, because it is the one input this function cannot verify.
 *
 * Returns null when it cannot be computed — never 0.
 */
export function profitPctFor(
  side: string | null | undefined,
  entryPrice: number | null | undefined,
  price: number | null | undefined,
): number | null {
  const entry = Number(entryPrice);
  const px = Number(price);

  if (entryPrice == null || !Number.isFinite(entry) || entry === 0) return null;
  if (price == null || !Number.isFinite(px)) return null;

  const s = String(side ?? '').toLowerCase();
  const isShort = s === 'sell' || s === 'short';

  const raw = isShort ? (entry - px) / entry : (px - entry) / entry;
  return raw * 100;
}

/**
 * peakProfitPctFor() — the high-water mark of the signed profit%, using the same monotonic and
 * "unknown must not erase" rules as `nextPeak()`.
 *
 * Kept as its own function rather than `nextPeak(prevProfit, currentProfit)` at the call site so
 * the SIDE and ENTRY are applied once, in one place, and cannot be applied inconsistently by a
 * second caller.
 */
export function peakProfitPctFor(
  prevPeakPct: number | null | undefined,
  side: string | null | undefined,
  entryPrice: number | null | undefined,
  price: number | null | undefined,
): number | null {
  return nextPeak(prevPeakPct, profitPctFor(side, entryPrice, price));
}
