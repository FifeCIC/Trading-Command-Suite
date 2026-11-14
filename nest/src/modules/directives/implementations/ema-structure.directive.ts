/**
 * Price Above EMA Structure — HYBRID BASE+BONUS (Layer C, 2026-07-29)
 * =====================================================================
 * BASE (0–60): Continuous from EMA separation %. Every tick.
 * BONUS: Full alignment (price > fast EMA > slow EMA) → +30. Strong separation → +10.
 * MAX: 100.
 *
 * ⚠️ THE TWO LENGTHS ARE PARAMETERS SINCE 2026-11-13 (#1268), and the DEFAULTS are byte-identical to
 * the constants they replaced (20 / 50), so every protocol that already uses this directive scores
 * exactly as before — that is what the BASELINE guard in `directive-parameters.spec.ts` proves.
 *
 * Before this, `EMA_SHORT`/`EMA_LONG` were literals, so no protocol could ask for a SHORT structure
 * test — lengths in the single digits, where the whole point is price hugging a fast average. Every
 * protocol containing this directive was locked to 20/50, and two strategies wanting different
 * structure lengths could not both be expressed.
 */

import { Injectable } from '@nestjs/common';
import { DirectiveInput, DirectiveResult, IDirective } from '../interfaces/directive.interface';
import { ema } from '../utils/indicators';
import { resolveParams, type NumericParamSpec } from '../parameters';

const EMA_SHORT = 20;
const EMA_LONG = 50;

const PARAMS: readonly NumericParamSpec[] = [
  {
    key: 'emaShort',
    label: 'Fast EMA length',
    type: 'number',
    default: EMA_SHORT,
    min: 2,
    max: 100,
    step: 1,
    unit: 'bars',
    chart: 'series',
    why: 'Measured 2026-11-13 (#1268): fixed at 20, so no protocol could express a SHORT structure test. 20 is a swing horizon; a scalping protocol wants the fast average in single digits, which is where price hugging it is the whole signal.',
    source: 'ema-structure.directive.ts:23 EMA_SHORT',
  },
  {
    key: 'emaLong',
    label: 'Slow EMA length',
    type: 'number',
    default: EMA_LONG,
    min: 5,
    max: 200,
    step: 1,
    unit: 'bars',
    chart: 'series',
    why: 'Fixed at 50 for the same reason. The pair is what the BONUS tier reads: full alignment is price > fast > slow, so the LONG length sets both the trend horizon and the number of bars the directive needs before it can score at all.',
    source: 'ema-structure.directive.ts:24 EMA_LONG',
  },
];

@Injectable()
export class EmaStructureDirective implements IDirective {
  readonly id = 'ema-structure';
  readonly name = 'Price Above EMA Structure';
  readonly description = 'Hybrid: continuous separation base + alignment bonus.';
  readonly priority = 75;
  readonly maxScore = 100;
  readonly minScore = 1;
  readonly minBars = { '1d': EMA_LONG + 1 };
  readonly version = '2.1.0';
  readonly readiness = 'ready' as const;
  readonly category = 'structural' as const;
  readonly directionBias = 'bullish' as const;
  readonly params = PARAMS;

  calculate(input: DirectiveInput): DirectiveResult {
    const { values } = resolveParams(this.id, this.params, input.params);
    const shortPeriod = values.emaShort as number;
    const longPeriod = values.emaLong as number;

    /**
     * ⚠️ A resolved pair can be INVERTED (short >= long). The fast length is CLAMPED under the slow
     * one and the clamp is REPORTED — swapping them silently would change which average is "fast"
     * while the score still looked normal, which is the plausible-number failure this repo keeps
     * finding. The defaults (20/50) never take this branch.
     */
    const clamped = shortPeriod >= longPeriod;
    const fastPeriod = clamped ? Math.max(1, longPeriod - 1) : shortPeriod;
    const minBars = longPeriod + 1;

    const closes = input.bars.map((b) => b.close);
    if (closes.length < minBars) {
      return { score: 0, confidence: 0.1, reason: `Insufficient data: need ${minBars} bars, have ${closes.length}.`, signalClass: 'neutral' };
    }
    const fastEma = ema(closes, fastPeriod);
    const slowEma = ema(closes, longPeriod);
    const currentPrice = closes[closes.length - 1];
    const currentFast = fastEma[fastEma.length - 1];
    const currentSlow = slowEma[slowEma.length - 1];
    const priceAboveFast = currentPrice > currentFast;
    const fastAboveSlow = currentFast > currentSlow;
    const fullAlignment = priceAboveFast && fastAboveSlow;

    // BASE (0–60): price separation from the FAST EMA as % → continuous score
    const priceSep = (currentPrice - currentFast) / currentFast;
    const baseScore = Math.round(Math.min(60, Math.max(0, 30 + priceSep * 100)));

    // BONUS
    let bonusScore = 0;
    let bonusLabel = '';
    if (fullAlignment) {
      bonusScore = 30;
      const emaSep = (currentFast - currentSlow) / currentSlow;
      if (emaSep > 0.02) { bonusScore += 10; bonusLabel = 'full alignment + strong separation'; }
      else { bonusLabel = 'full alignment'; }
    } else if (priceAboveFast) { bonusScore = 10; bonusLabel = `price above EMA${fastPeriod}`; }
    else if (fastAboveSlow) { bonusScore = 5; bonusLabel = 'EMAs aligned (price dipped)'; }

    const total = baseScore + bonusScore;
    const parts = [`base=${baseScore} (${(priceSep*100).toFixed(1)}% above EMA${fastPeriod})`];
    if (bonusScore > 0) parts.push(`+${bonusScore} bonus (${bonusLabel})`);
    if (clamped) parts.push(`[fast EMA clamped ${shortPeriod}→${fastPeriod}: it must be shorter than the slow EMA]`);

    return {
      score: total,
      confidence: Number((fullAlignment ? 0.7 : priceAboveFast ? 0.45 : 0.35).toFixed(2)),
      reason: `Price ${currentPrice.toFixed(2)} vs EMA${fastPeriod} ${currentFast.toFixed(2)} vs EMA${longPeriod} ${currentSlow.toFixed(2)}: ${parts.join(' ')}=${total}/${this.maxScore}`,
      signalClass: fullAlignment ? 'bullish' : 'neutral',
      metadata: { baseScore, bonusScore, bonusLabel, priceSep, fullAlignment, fastPeriod, longPeriod, fastEmaClamped: clamped },
    };
  }
}
