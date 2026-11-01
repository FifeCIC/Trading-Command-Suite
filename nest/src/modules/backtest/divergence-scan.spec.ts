/**
 * divergence-scan.spec.ts — canary for the chart's detection assembly.
 *
 * Both failure directions are silent and both produce a chart that looks authoritative:
 *   • pair a pivot from the indicator's WARM-UP → a divergence invented by a default (measured: a "hidden
 *     bullish" pair whose earlier RSI was the placeholder 50.00 against a real 46.58)
 *   • carry a score FORWARD past the bar that confirmed it → a sustained reading the scorer never produces,
 *     so the chart disagrees with the run it previews
 *
 * The fixtures are built by hand because the point is the RULE, not the market: a swing list with a known
 * shape makes "did it pair the right two bars" answerable by inspection.
 */
import { scanDivergences, scoreSeriesFor, type DivergenceKind, type KindSelection } from './divergence-scan';
import type { StrengthModel, SwingPoint } from '../directives/utils/divergence';

/** RSI is bounded 0-100, so its denominator is a constant — the model `rsi-divergence.directive.ts` declares. */
const MODEL: StrengthModel = { priceWeight: 3, indWeight: 2, indDenominator: () => 100 };

const ALL: KindSelection = { regularBullish: true, hiddenBullish: true, regularBearish: true, hiddenBearish: true };
const ONLY_REGULAR_BULL: KindSelection = {
  regularBullish: true, hiddenBullish: false, regularBearish: false, hiddenBearish: false,
};

/** The directive's own formulas, mirrored so the spec asserts the SCALE the panel shows. */
const scoreFor = (kind: DivergenceKind, strength: number): number =>
  kind.endsWith('bullish') ? Math.round(Math.min(60 + strength * 40, 110)) : Math.round(Math.max(15 - strength * 12, 0));

const swing = (index: number, price: number, rsi: number): SwingPoint => ({ index, price, indicatorValue: rsi });

/**
 * A regular bullish setup: price makes a LOWER low while RSI makes a HIGHER low. Both pivots sit after
 * the warm-up, so this is a real divergence and must be found.
 */
const BULL_LOWS: SwingPoint[] = [swing(30, 210.0, 32.0), swing(45, 205.0, 38.0)];

describe('scanDivergences', () => {
  it('finds a regular bullish pair and reports both legs', () => {
    const out = scanDivergences({
      swingLows: BULL_LOWS, swingHighs: [], rsiOffset: 14, select: ONLY_REGULAR_BULL, strengthModel: MODEL, scoreFor,
    });
    expect(out).toHaveLength(1);
    const d = out[0];
    expect(d.kind).toBe('regular-bullish');
    expect(d.fromIndex).toBe(30);
    expect(d.toIndex).toBe(45);
    expect(d.fromPrice).toBe(210);
    expect(d.toPrice).toBe(205);
    expect(d.fromRsi).toBe(32);
    expect(d.toRsi).toBe(38);
    // price fell 2.38% x 3, RSI rose 6/100 x 2 -> 0.0714 + 0.12 = 0.1914 -> 19.1%
    expect(d.strength).toBeCloseTo(19.1, 1);
    expect(d.score).toBeGreaterThan(60);
  });

  /**
   * ⚠️ THE DEFECT THIS FILE EXISTS FOR. A pivot before the indicator's first bar carries a placeholder, so
   * the pair must not be reported at all — not reported with a caveat, not reported at zero strength.
   *
   * ⚠️ THE FIXTURE MUST ACTUALLY FORM A DIVERGENCE. Price 211 → 210.5 is a lower low and RSI 50 → 56 is a
   * higher low, so WITHOUT the guard this pair IS a regular bullish divergence. An earlier version of this
   * test used RSI 50 → 44, which fails the predicate on its own — it passed for the wrong reason and the
   * guard could be deleted without anything noticing. Canaried by replacing the guard with `=> true`.
   */
  it('IGNORES pivots inside the indicator warm-up', () => {
    const out = scanDivergences({
      swingLows: [swing(9, 211.0, 50), swing(16, 210.5, 56)], // 9 < rsiOffset 14
      swingHighs: [],
      rsiOffset: 14,
      select: ALL,
      strengthModel: MODEL,
      scoreFor,
    });
    expect(out).toEqual([]);
  });

  it('keeps a pair whose FIRST pivot is exactly at the first indicator bar', () => {
    // The boundary case: index === rsiOffset DOES have a real indicator value, so it is eligible and a
    // pair can start there. (`>=` not `>` — an off-by-one here would silently drop the earliest real pair.)
    const out = scanDivergences({
      swingLows: [swing(14, 211.0, 40), swing(45, 210.5, 46)],
      swingHighs: [], rsiOffset: 14, select: ONLY_REGULAR_BULL, strengthModel: MODEL, scoreFor,
    });
    expect(out).toHaveLength(1);
    expect(out[0].fromIndex).toBe(14);
  });

  it('does not pair a warm-up pivot with a later eligible one', () => {
    // The dangerous shape: the SECOND pivot is fine, the FIRST is not. Price 220 → 210 (lower low) with RSI
    // 50 → 56 (higher low) IS a bullish divergence, so without the guard this reports a pair whose earlier
    // RSI was never measured.
    const out = scanDivergences({
      swingLows: [swing(9, 220.0, 50), swing(30, 210.0, 56)],
      swingHighs: [], rsiOffset: 14, select: ONLY_REGULAR_BULL, strengthModel: MODEL, scoreFor,
    });
    expect(out).toEqual([]);
  });

  it('honours the pivot gap window — too close and too far are both rejected', () => {
    const tooClose = scanDivergences({
      swingLows: [swing(30, 210, 30), swing(32, 205, 36)],
      swingHighs: [], rsiOffset: 14, gap: { min: 5, max: 60 }, select: ONLY_REGULAR_BULL, strengthModel: MODEL, scoreFor,
    });
    expect(tooClose).toEqual([]); // 2 bars apart

    const tooFar = scanDivergences({
      swingLows: [swing(30, 210, 30), swing(120, 205, 36)],
      swingHighs: [], rsiOffset: 14, gap: { min: 5, max: 60 }, select: ONLY_REGULAR_BULL, strengthModel: MODEL, scoreFor,
    });
    expect(tooFar).toEqual([]); // 90 bars apart

    const inWindow = scanDivergences({
      swingLows: [swing(30, 210, 30), swing(60, 205, 36)],
      swingHighs: [], rsiOffset: 14, gap: { min: 5, max: 60 }, select: ONLY_REGULAR_BULL, strengthModel: MODEL, scoreFor,
    });
    expect(inWindow).toHaveLength(1); // 30 bars apart
  });

  it('returns NOTHING for a kind that is switched off', () => {
    // A disabled kind must produce no rows at all — a zero-strength row would still draw a marker.
    const out = scanDivergences({
      swingLows: BULL_LOWS, swingHighs: [], rsiOffset: 14, select: { ...ALL, regularBullish: false }, strengthModel: MODEL, scoreFor,
    });
    expect(out).toEqual([]);
  });

  it('emits every pair, not only the last two pivots', () => {
    // The directive only ever asks about the final pair. A chart must show the history.
    const out = scanDivergences({
      swingLows: [swing(20, 220, 30), swing(30, 215, 36), swing(40, 210, 40)],
      swingHighs: [], rsiOffset: 14, select: ONLY_REGULAR_BULL, strengthModel: MODEL, scoreFor,
    });
    expect(out).toHaveLength(2);
    expect(out.map((d) => d.toIndex)).toEqual([30, 40]);
  });

  it('sorts chronologically, because a chart reads left to right', () => {
    const out = scanDivergences({
      swingLows: [swing(20, 220, 30), swing(50, 215, 36)],
      swingHighs: [swing(30, 200, 70), swing(60, 205, 64)],
      rsiOffset: 14, select: ALL, strengthModel: MODEL, scoreFor,
    });
    expect(out.map((d) => d.toIndex)).toEqual([...out.map((d) => d.toIndex)].sort((a, b) => a - b));
  });
});

describe('scoreSeriesFor', () => {
  const bars = Array.from({ length: 10 }, (_, i) => ({ time: `2026-10-0${(i % 9) + 1}T00:00:00.000Z` }));

  it('scores ONLY the confirming bar — never carries forward', () => {
    const series = scoreSeriesFor(bars, [{
      kind: 'regular-bullish', fromIndex: 1, toIndex: 3, fromPrice: 1, toPrice: 1, fromRsi: 1, toRsi: 1,
      strength: 10, score: 80,
    }]);
    expect(series[2].score).toBe(0);   // before the confirmation
    expect(series[3].score).toBe(80);  // the confirming bar
    expect(series[4].score).toBe(0);   // ⚠️ NOT carried forward
  });

  it('prefers the MORE EXTREME claim when one bar confirms two pairs', () => {
    // ⚠️ Score 50 is neutral on this scale (bullish 60-110, bearish 0-15), so "strongest" means "furthest
    // from 50" — not "highest". A bar that confirms both a weak bullish (62) and a strong bearish (3) is
    // ambiguous, and reporting the bearish reading is the conservative answer because it is the stronger
    // claim of the two. Picking "highest" would let a marginal bullish pair mask a strong bearish one.
    const series = scoreSeriesFor(bars, [
      { kind: 'regular-bullish', fromIndex: 1, toIndex: 3, fromPrice: 1, toPrice: 1, fromRsi: 1, toRsi: 1, strength: 1, score: 62 },
      { kind: 'regular-bearish', fromIndex: 2, toIndex: 3, fromPrice: 1, toPrice: 1, fromRsi: 1, toRsi: 1, strength: 1, score: 3 },
    ]);
    expect(series[3].score).toBe(3);
  });

  it('emits one row per bar, so a chart can align it to candles', () => {
    expect(scoreSeriesFor(bars, [])).toHaveLength(bars.length);
  });
});
