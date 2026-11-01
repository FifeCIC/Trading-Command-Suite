/**
 * divergence-scan.ts — assemble every divergence PAIR in a window, from the canonical predicates.
 *
 * ── WHY THIS IS EXTRACTED RATHER THAN INLINE IN THE SERVICE ──────────────────────────────────────
 * This is where the chart's only real logic lives, and it is where a defect was measured on
 * 2026-11-01: the first version paired pivots that sit inside the RSI WARM-UP, whose indicator value is
 * a neutral `50` placeholder. NVDA 15m reported a "hidden bullish" pair at bars 9→16 whose earlier RSI was
 * **50.00** against a real 46.58 — a divergence manufactured entirely by a default, drawn on a chart, with
 * no error anywhere. A rule that produces plausible output must be testable without a database, so the
 * assembly is a pure function and `divergence-scan.spec.ts` canaries it in both directions.
 *
 * ── IT DOES NOT DECIDE ANYTHING ─────────────────────────────────────────────────────────────────
 * The predicates (`checkBullishDivergence` etc.) and the strength model come from
 * `directives/utils/divergence.ts` — the same code the live directives run. This file only decides WHICH
 * pivots are eligible and how the result is shaped for a chart. That split is deliberate: the detection
 * rule has one home, and a second copy would drift while only one got the next fix.
 */
import {
  checkBearishDivergence,
  checkBullishDivergence,
  checkHiddenBearish,
  checkHiddenBullish,
  computeDivergenceStrength,
  type DivergencePair,
  type PivotGap,
  type StrengthModel,
  type SwingPoint,
} from '../directives/utils/divergence';

export type DivergenceKind = 'regular-bullish' | 'hidden-bullish' | 'regular-bearish' | 'hidden-bearish';

export interface ScanDivergence {
  kind: DivergenceKind;
  /** Bar index of the EARLIER pivot. */
  fromIndex: number;
  /** Bar index of the LATER pivot — the bar the pair is confirmed at. */
  toIndex: number;
  fromPrice: number;
  toPrice: number;
  fromRsi: number;
  toRsi: number;
  /** 0-100, from the canonical `computeDivergenceStrength()`. */
  strength: number;
  /** The score the directive's own formula gives this pair. */
  score: number;
}

/** Which kinds the caller wants. A kind that is off produces no pairs at all — not a zero-strength one. */
export interface KindSelection {
  regularBullish: boolean;
  hiddenBullish: boolean;
  regularBearish: boolean;
  hiddenBearish: boolean;
}

export interface ScanInput {
  swingLows: SwingPoint[];
  swingHighs: SwingPoint[];
  /**
   * The bar index the indicator series starts at. ⚠️ Pivots BEFORE it carry a placeholder indicator value
   * and must not participate — that is the rule this file exists to hold.
   */
  rsiOffset: number;
  gap?: PivotGap;
  select: KindSelection;
  strengthModel: StrengthModel;
  /** The directive's own score formula, passed in so the chart and the scorer cannot disagree on scale. */
  scoreFor: (kind: DivergenceKind, strength: number) => number;
  /** Decimal places for the emitted numbers. Defaults to 5 (price precision), scores use 1. */
  round?: (value: number, dp?: number) => number;
}

const defaultRound = (value: number, dp = 5): number => {
  if (!Number.isFinite(value)) return 0;
  const factor = 10 ** dp;
  return Math.round(value * factor) / factor;
};

/**
 * Scan every consecutive pivot PAIR, not just the last two.
 *
 * ⚠️ The directive asks `checkBullishDivergence(swingLows)`, which the canonical helper answers for the
 * FINAL two pivots only — correct for "what would I score on this bar", useless for a chart, where the
 * question is "where did this fire before?". The PREDICATE is unchanged; only how many pairs it is asked
 * about. A chart that showed one pair per instrument would be answering the wrong question.
 */
export function scanDivergences(input: ScanInput): ScanDivergence[] {
  const { swingLows, swingHighs, rsiOffset, gap, select, strengthModel, scoreFor } = input;
  const round = input.round ?? defaultRound;
  const out: ScanDivergence[] = [];

  /**
   * ⚠️ THE WARM-UP GUARD. A pivot at or before the indicator's first bar has no real indicator value, so
   * it cannot be one half of a divergence — pairing it against a real reading invents a divergence out of
   * a default. Filtered here rather than in the caller so no consumer can forget it.
   */
  const eligible = (s: SwingPoint): boolean => s.index >= rsiOffset;

  const collect = (swings: SwingPoint[], kind: DivergenceKind, test: (slice: SwingPoint[]) => DivergencePair | null): void => {
    const usable = swings.filter(eligible);
    for (let i = 1; i < usable.length; i++) {
      const found = test([usable[i - 1], usable[i]]);
      if (!found) continue;
      const strength = computeDivergenceStrength(found, strengthModel);
      out.push({
        kind,
        fromIndex: usable[i - 1].index,
        toIndex: usable[i].index,
        fromPrice: round(found.price1),
        toPrice: round(found.price2),
        fromRsi: round(found.ind1),
        toRsi: round(found.ind2),
        // Percent with one decimal: the unit a reader compares. The raw 0-1 lives in `strengthModel`.
        strength: round(strength * 100, 1),
        score: scoreFor(kind, strength),
      });
    }
  };

  if (select.regularBullish) collect(swingLows, 'regular-bullish', (s) => checkBullishDivergence(s, gap));
  if (select.hiddenBullish) collect(swingLows, 'hidden-bullish', (s) => checkHiddenBullish(s, gap));
  if (select.regularBearish) collect(swingHighs, 'regular-bearish', (s) => checkBearishDivergence(s, gap));
  if (select.hiddenBearish) collect(swingHighs, 'hidden-bearish', (s) => checkHiddenBearish(s, gap));

  // Chronological, because a chart reads left to right and a list that jumps around is a list nobody
  // can cross-reference against the markers.
  return out.sort((a, b) => a.toIndex - b.toIndex);
}

/**
 * The per-bar score series: the pair CONFIRMED AT that bar, else 0.
 *
 * ⚠️ NOT carried forward. A carried-forward score would show a sustained reading the scorer never
 * produces — `rsi-divergence` returns its divergence score on the bar that confirms the pair and nothing
 * in between, so a chart that kept the last value would disagree with the run it is meant to preview.
 */
export function scoreSeriesFor(
  bars: Array<{ time: string }>,
  divergences: ScanDivergence[],
): Array<{ index: number; time: string; score: number }> {
  // A bar can confirm more than one pair; the strongest claim wins rather than the last one written.
  const scoreAt = new Map<number, number>();
  for (const d of divergences) {
    const existing = scoreAt.get(d.toIndex);
    if (existing == null || Math.abs(d.score - 50) > Math.abs(existing - 50)) scoreAt.set(d.toIndex, d.score);
  }
  return bars.map((bar, index) => ({ index, time: bar.time, score: scoreAt.get(index) ?? 0 }));
}
