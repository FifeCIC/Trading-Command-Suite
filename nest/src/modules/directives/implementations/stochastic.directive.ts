/**
 * Stochastic Oscillator — HYBRID BASE+BONUS (Layer C, 2026-07-29)
 * ===================================================================
 * BASE (0–50): Continuous: %K 80→0, %K 20→50. Every tick moves.
 * BONUS tiers: %K < 20 → +30, %K < 10 → +50, crossover → +15.
 * MAX: 100.
 */

import { Injectable } from '@nestjs/common';
import { DirectiveInput, DirectiveResult, IDirective } from '../interfaces/directive.interface';
import { stochastic } from '../utils/indicators';
import { resolveParams, type NumericParamSpec } from '../parameters';

const K_PERIOD = 14;
const D_PERIOD = 3;
const BAND = 20;

/**
 * The ladder is derived from ONE band, so a tunable gate cannot produce overlapping or inverted tiers.
 * At the production band of 20: deep = 10, overbought = 80, deep overbought = 90 — exactly the previous
 * constants, which is why the default is byte-identical (pinned by the baseline).
 */
const deepOf = (band: number) => band / 2;
const mirrorOf = (band: number) => 100 - band;

const PARAMS: readonly NumericParamSpec[] = [
  {
    key: 'kPeriod',
    label: '%K period',
    type: 'number',
    default: K_PERIOD,
    min: 2,
    max: 60,
    step: 1,
    unit: 'bars',
    chart: 'series',
    why: 'Measured 2026-11-01 (#1166): Stochastic was the most ROBUST period in the library — 57% of entry events survived a 14 -> 28 change, against 0% for ADX and 7.7% for RSI. Still chart-visible and still symbol-dependent, but the lowest-value period knob.',
    source: 'stochastic.directive.ts:13 K_PERIOD',
  },
  {
    key: 'dPeriod',
    label: '%D smoothing',
    type: 'number',
    default: D_PERIOD,
    min: 1,
    max: 20,
    step: 1,
    unit: 'bars',
    chart: 'series',
    why: 'The signal line the crossover is read from. Smoothing changes WHEN a cross is declared, which is what the %K/%D bonus fires on, so it is not cosmetic even though it barely moves %K itself.',
    source: 'stochastic.directive.ts:14 D_PERIOD',
  },
  {
    key: 'band',
    label: 'Oversold / overbought band',
    type: 'number',
    default: BAND,
    min: 5,
    max: 45,
    step: 1,
    unit: '%K',
    chart: 'threshold',
    why: 'One number sets both bands (overbought mirrors as 100 - band; the deep tiers at half). Fixed 20/80 fired 15-18 times over 7-10 months of daily bars; a trending symbol may never reach it.',
    source: 'stochastic.directive.ts:62 oversold/overbought bands (was `<20` and `>80`)',
  },
];

function mapRange(v: number, inMin: number, inMax: number, outMin: number, outMax: number): number {
  const t = Math.max(0, Math.min(1, (v - inMin) / (inMax - inMin)));
  return outMin + t * (outMax - outMin);
}

@Injectable()
export class StochasticDirective implements IDirective {
  readonly id = 'stochastic';
  readonly name = 'Stochastic Oscillator';
  readonly description = 'Symmetric hybrid: continuous base + oversold/overbought bonuses + crossover bonus.';
  readonly category = 'oscillator' as const;
  readonly priority = 50;
  readonly maxScore = 100;
  readonly minScore = 1;
  readonly minBars = { '1d': 19 };
  readonly version = '2.2.0';
  readonly readiness = 'ready' as const;
  readonly directionBias = 'neutral' as const;

  readonly params = PARAMS;

  calculate(input: DirectiveInput): DirectiveResult {
    const { values } = resolveParams(this.id, this.params, input.params);
    const kPeriod = values.kPeriod as number;
    const dPeriod = values.dPeriod as number;
    const band = values.band as number;
    const deep = deepOf(band);
    const overbought = mirrorOf(band);
    const deepOverbought = mirrorOf(deep);
    const minBars = kPeriod + dPeriod + 2;
    const highs = input.bars.map(b => b.high);
    const lows = input.bars.map(b => b.low);
    const closes = input.bars.map(b => b.close);
    if (closes.length < minBars) {
      return { signalClass: 'neutral', score: 0, confidence: 0.1, reason: `Insufficient data: need ${minBars} bars, have ${closes.length}.` };
    }
    const { k, d } = stochastic(highs, lows, closes, kPeriod, dPeriod);
    if (k.length < 4 || d.length < 3) {
      return { score: 0, confidence: 0.1, reason: 'Not enough stochastic values.' };
    }
    const currentK = k[k.length - 1];
    const prevK = k[k.length - 2];
    const currentD = d[d.length - 1];
    const prevD = d[d.length - 2];
    const crossUp = prevK <= prevD && currentK > currentD;
    const crossDown = prevK >= prevD && currentK < currentD;
    const kRising = currentK > prevK;
    const kFalling = currentK < prevK;

    // Symmetric hybrid: oversold → bullish reversion, overbought → bearish.
    const isBullish = currentK <= 50;
    let baseScore: number;
    let bonusScore = 0;
    let bonusLabel = '';
    if (isBullish) {
      baseScore = Math.round(mapRange(currentK, overbought, band, 0, 50));
      if (currentK < deep) { bonusScore = 50; bonusLabel = 'deep oversold (<10)'; }
      else if (currentK < band) { bonusScore = 30; bonusLabel = 'oversold (<20)'; }
    } else {
      baseScore = Math.round(mapRange(currentK, band, overbought, 0, 50));
      if (currentK > deepOverbought) { bonusScore = 50; bonusLabel = 'deep overbought (>90)'; }
      else if (currentK > overbought) { bonusScore = 30; bonusLabel = 'overbought (>80)'; }
    }

    // CROSSOVER bonus
    const crossBonus = crossUp || crossDown ? 15 : (kRising || kFalling ? 5 : 0);

    const total = Math.min(this.maxScore, baseScore + bonusScore + crossBonus);
    const signalClass = total >= 60 ? (isBullish ? 'bullish' : 'bearish') : 'neutral';
    const parts = [`base=${baseScore}`];
    if (bonusScore > 0) parts.push(`+${bonusScore} bonus (${bonusLabel})`);
    if (crossBonus > 0) parts.push(`+${crossBonus} ${crossUp ? 'crossover-up' : crossDown ? 'crossover-down' : 'trend'}`);

    return {
      signalClass,
      score: total,
      confidence: Number((bonusScore > 0 ? 0.55 + (bonusScore / 50) * 0.3 : 0.3 + (baseScore / 50) * 0.2).toFixed(2)),
      reason: `Stoch K=${currentK.toFixed(1)} D=${currentD.toFixed(1)}: ${parts.join(' ')}=${total}/${this.maxScore}`,
      metadata: { baseScore, bonusScore, bonusLabel, crossBonus, currentK, crossUp, crossDown },
    };
  }
}
