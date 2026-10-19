/**
 * Rarity Bands — THE ONE definition.
 *
 * BEFORE 2026-10-17 THIS EXISTED TWICE, with different minimum sample sizes:
 *   • `rarity.service.ts`        — threshold 30, returns `RarityResult`
 *   • `protocol-gating.service.ts` — threshold 10, returns `RarityInfo`
 * So the SAME score could receive two different bands depending on which path ran, and only one
 * of the two tables would be fixed by a future change. Two copies of a sizing table on an
 * order-placing path is the most expensive kind of debt: both drift, one gets the next fix.
 *
 * ── Why `sizeMultiplier` matters ──
 * It is NOT decorative. `trading-strategy.service.ts` (`size *= evalResult.rarity.sizeMultiplier`)
 * scales the ORDER VOLUME, gated by `trading_strategy.useRaritySizing` — which is NOT NULL
 * DEFAULT 1, i.e. ON unless someone turns it off. Measured 2026-10-17: 39 of 40 bots have it on,
 * 2 of them active.
 */

export type RarityBand = 'standard' | 'strong' | 'exceptional' | 'cyclical' | 'black-swan';

export interface RarityBandConfig {
  label: string;
  color: string;
  emoji: string;
  description: string;
  sizeMultiplier: number;
}

/**
 * Minimum snapshots before a rarity band is reported AT ALL.
 *
 * ⚠️ ONE value for both paths, per the 2026-10-17 consolidation. It was 30 in `rarity.service`
 * and 10 in `protocol-gating`; the stricter figure wins because a band drives order size, and
 * scaling an order up on 12 observations is exactly the thin-sample behaviour to avoid.
 * Below this, callers report no band and sizing stays at base.
 */
export const RARITY_MIN_SAMPLES = 30;

export const RARITY_BANDS: Record<RarityBand, RarityBandConfig> = {
  'standard': {
    label: 'Standard',
    color: '#22c55e',
    emoji: '🟢',
    description: 'Common opportunity — trade with base size',
    sizeMultiplier: 1.0,
  },
  'strong': {
    label: 'Strong',
    color: '#3b82f6',
    emoji: '🔵',
    description: 'Above-average convergence — scale up 1.5×',
    sizeMultiplier: 1.5,
  },
  'exceptional': {
    label: 'Exceptional',
    color: '#8b5cf6',
    emoji: '🟣',
    description: 'Rare alignment of directives — scale up 2×',
    sizeMultiplier: 2.0,
  },
  'cyclical': {
    label: 'Cyclical',
    color: '#f59e0b',
    emoji: '🟡',
    description: 'Multi-year event (halving, macro shift) — maximum conviction',
    sizeMultiplier: 2.5,
  },
  'black-swan': {
    label: 'Black Swan',
    color: '#ef4444',
    emoji: '🔴',
    // ── DECISION (2026-10-17, owner — Option A) ──
    // WHAT:       black-swan sizeMultiplier is 1.0 (base size), not 0.
    // WHY:        This multiplier is consumed on the ORDER path (`size *= evalResult.rarity
    //             .sizeMultiplier`). 0× is a kill switch on the single best setup, and on a FLAT
    //             score history every score ties the maximum, so 0× zeroed EVERY order. Base size
    //             trades the signal without trusting it — and 1.0× replaces the 2.5× that was
    //             actually being applied, so this can only REDUCE exposure.
    // INSTEAD OF: 0 (Option B — keeps the guard but refuses the best setup), or leaving black-swan
    //             unreachable (Option C — keeps the guard permanently dead).
    // REVERSE BY: Setting this back to 0. `rarity-bands.spec.ts` fails, so it cannot be silent.
    // REGISTER:   docs/SETTLED-DECISIONS.md row 87
    // GUARD:      nest/src/modules/scoring/rarity-bands.spec.ts
    description: 'Never seen before — trade at BASE size only; verify data before scaling',
    sizeMultiplier: 1.0,
  },
};

export function classifyRarityBand(percentile: number): RarityBand {
  if (percentile >= 99) return 'black-swan';
  if (percentile >= 95) return 'cyclical';
  if (percentile >= 85) return 'exceptional';
  if (percentile >= 70) return 'strong';
  return 'standard';
}

/**
 * Percentile rank of `composite` within `scores`.
 *
 * ⚠️ `scores` MUST be sorted ascending — both call sites order by `composite: 'asc'`.
 *
 * ── The defect this fixes ──
 * The rank counted strictly-below only, so a score EQUAL to the historical maximum scored
 * `(n-1)/n` — 97 at n=30, 98 at n=50. `black-swan` needs `>= 99`, which such a sample can never
 * reach, so the highest score ever recorded was reported as `cyclical` and sized at **2.5×**
 * instead of being flagged as unprecedented. The guard that was supposed to fire could not, at
 * any sample size below ~67.
 *
 * A score at or above the maximum IS the maximum, so it is the 100th percentile. Only that case
 * is corrected — tied mid-range scores keep the exclusive rank, so the rest of the distribution
 * does not shift upward.
 */
export function rarityPercentile(scores: number[], composite: number): number {
  if (scores.length === 0) return 50;

  let countBelow = 0;
  for (const s of scores) {
    if (s < composite) countBelow++;
  }
  const exclusive = Math.round((countBelow / scores.length) * 100);

  const max = scores[scores.length - 1];
  return composite >= max ? 100 : exclusive;
}
