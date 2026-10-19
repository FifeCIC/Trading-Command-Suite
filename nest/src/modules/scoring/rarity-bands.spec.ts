/**
 * Rarity bands — guard for #1126 (Option A, decided 2026-10-17).
 *
 * THE DEFECT: the percentile rank counted STRICTLY BELOW, so a score equal to the historical
 * maximum scored `(n-1)/n` — 97 at n=30, 98 at n=50. `black-swan` needs `>= 99`, which those
 * samples cannot reach, so the highest score ever recorded was reported as `cyclical` and sized
 * at **2.5×** instead of being flagged as unprecedented. The guard could not fire below ~67
 * snapshots.
 *
 * Option A: make the top band reachable AND re-map `black-swan` from 0× to BASE size (1.0×).
 * The reason for the second half: the multiplier is consumed by
 * `trading-strategy.service.ts` (`size *= evalResult.rarity.sizeMultiplier`), so 0× is a kill
 * switch on the single best setup — and on a protocol whose scores are flat, EVERY score ties the
 * maximum, so 0× zeroed every order. Base size trades the signal without trusting it.
 *
 * ⚠️ THE DECISION NEVER INCREASES EXPOSURE: 1.0× is strictly below the 2.5× that was being
 * applied, so no branch of this change can size an order larger than before.
 */
import {
  RARITY_BANDS,
  RARITY_MIN_SAMPLES,
  classifyRarityBand,
  rarityPercentile,
} from './rarity-bands';

// 30 ascending scores — the old threshold boundary, and the size at which the old rank was 97.
const ASCENDING_30 = Array.from({ length: 30 }, (_, i) => i + 1);

describe('rarityPercentile — the top band must be reachable (#1126)', () => {
  it('ranks a score equal to the window maximum as the 100th percentile', () => {
    // Old behaviour: countBelow = 29 of 30 ⇒ round(96.67) = 97 ⇒ 'cyclical' (2.5×).
    expect(rarityPercentile(ASCENDING_30, 30)).toBe(100);
    expect(classifyRarityBand(rarityPercentile(ASCENDING_30, 30))).toBe('black-swan');
  });

  it('ranks a score ABOVE the maximum as the 100th percentile', () => {
    expect(rarityPercentile(ASCENDING_30, 999)).toBe(100);
  });

  it('leaves mid-range scores on the exclusive rank — the distribution does not shift', () => {
    // 28 of 30 below ⇒ round(93.33) = 93 ⇒ 'exceptional'. Unchanged by the fix.
    expect(rarityPercentile(ASCENDING_30, 29)).toBe(93);
    expect(classifyRarityBand(rarityPercentile(ASCENDING_30, 29))).toBe('exceptional');
    // 14 of 30 below ⇒ round(46.67) = 47 ⇒ 'standard'.
    expect(rarityPercentile(ASCENDING_30, 15)).toBe(47);
  });

  it('handles an empty history without throwing', () => {
    expect(rarityPercentile([], 42)).toBe(50);
  });
});

describe('black-swan sizing is base, never zero (Option A)', () => {
  it('does not zero the position', () => {
    expect(RARITY_BANDS['black-swan'].sizeMultiplier).toBeGreaterThan(0);
  });

  it('is exactly base size — an unprecedented score is not scaled up', () => {
    expect(RARITY_BANDS['black-swan'].sizeMultiplier).toBe(RARITY_BANDS['standard'].sizeMultiplier);
  });

  it('is strictly below the boost it used to receive instead', () => {
    // The change can only ever REDUCE size: 1.0× replaces the 2.5× that cyclical applied.
    expect(RARITY_BANDS['black-swan'].sizeMultiplier)
      .toBeLessThan(RARITY_BANDS['cyclical'].sizeMultiplier);
  });

  it('keeps a flat score history from zeroing every order', () => {
    // Every snapshot identical ⇒ every score ties the maximum ⇒ all 100th percentile.
    const flat = Array.from({ length: 30 }, () => 50);

    expect(rarityPercentile(flat, 50)).toBe(100);
    const band = classifyRarityBand(rarityPercentile(flat, 50));
    expect(band).toBe('black-swan');
    expect(RARITY_BANDS[band].sizeMultiplier).toBeGreaterThan(0);
  });
});

describe('one threshold for both rarity paths (#1126 consolidation)', () => {
  it('is the stricter figure that previously lived only in rarity.service', () => {
    // protocol-gating used 10 and rarity.service used 30; the shared value is 30.
    expect(RARITY_MIN_SAMPLES).toBe(30);
  });

  it('declares every band exactly once', () => {
    expect(Object.keys(RARITY_BANDS).sort()).toEqual(
      ['black-swan', 'cyclical', 'exceptional', 'standard', 'strong'],
    );
  });
});
