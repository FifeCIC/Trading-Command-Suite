/**
 * Bollinger Band Squeeze — HYBRID BASE+BONUS (Layer C, 2026-07-29)
 * ===================================================================
 * Detects BB squeezes — bandwidth at multi-period low.
 *
 * ── Hybrid Scoring ─────────────────────────────────────────
 * BASE (30–60):  Continuous from percentile. Squeeze (0-25%) → 50-60.
 *                Normal (25-75%) → 40. Expansion (75%+) → 30-35.
 * BONUS tiers:   <5th percentile → +30 (extreme squeeze), <10th → +20.
 * MAX:           90.
 */

import { Injectable } from '@nestjs/common';
import { DirectiveInput, DirectiveResult, IDirective } from '../interfaces/directive.interface';
import { bollingerBands } from '../utils/indicators';
import { resolveParams, type NumericParamSpec } from '../parameters';

const BB_PERIOD = 20;
const SQUEEZE_LOOKBACK = 50;
const MIN_BARS = BB_PERIOD + SQUEEZE_LOOKBACK + 2;

/**
 * Tunable knobs (#1165). Defaults ARE the constants above — BASELINE proves the equality.
 *
 * ⚠️ A squeeze is a PERCENTILE OF BANDWIDTH WITHIN A WINDOW, so both numbers change what "tight"
 * means: the band period sets the scale being measured and the lookback sets the population it is
 * ranked against. The `range-compression` fixture (volatility collapsing to 8% of its opening range)
 * is the shape that makes this provable — the same bandwidth sits at a different percentile in a
 * 20-bar window than in a 100-bar one, crossing the squeeze tiers.
 */
const PARAMS: readonly NumericParamSpec[] = [
  {
    key: 'bbPeriod',
    label: 'Band period',
    type: 'number',
    default: BB_PERIOD,
    min: 5,
    max: 80,
    step: 1,
    unit: 'bars',
    chart: 'series',
    why: 'Measured 2026-11-01 (#1166 method): a 20-bar band on a 1h chart tracks one day; the bandwidth it produces is not comparable to a 60-bar band. On the range-compression fixture the percentile crosses the extreme-squeeze tier as the period changes.',
    source: 'bollinger-squeeze.directive.ts:17 BB_PERIOD',
  },
  {
    key: 'squeezeLookback',
    label: 'Percentile lookback',
    type: 'number',
    default: SQUEEZE_LOOKBACK,
    min: 20,
    max: 200,
    step: 1,
    unit: 'bars',
    chart: 'window',
    why: 'Measured 2026-11-01: the current bandwidth is PERCENTILE-RANKED against this window, so a 50-bar lookback on a series that has been quiet for 50 bars ranks as normal, while a 150-bar lookback ranks the same reading as tight — the bonus tiers move on identical price.',
    source: 'bollinger-squeeze.directive.ts:18 SQUEEZE_LOOKBACK',
  },
];

@Injectable()
export class BollingerBandSqueezeDirective implements IDirective {
  readonly id = 'bollinger-band-squeeze';
  readonly name = 'Bollinger Band Squeeze';
  readonly description = 'Hybrid: continuous percentile base + bonus for extreme squeezes.';
  readonly category = 'pattern' as const;
  readonly priority = 50;
  readonly maxScore = 90;
  readonly minScore = 1;
  readonly minBars = { '1d': 72 };
  readonly version = '2.0.1';
  readonly readiness = 'ready' as const;
  readonly directionBias = 'neutral' as const;
  readonly params = PARAMS;

  calculate(input: DirectiveInput): DirectiveResult {
    const { values } = resolveParams(this.id, this.params, input.params);
    const bbPeriod = values.bbPeriod as number;
    const squeezeLookback = values.squeezeLookback as number;
    const closes = input.bars.map(b => b.close);
    const requiredBars = Math.max(MIN_BARS, bbPeriod + squeezeLookback + 2);
    if (closes.length < requiredBars) {
      return { signalClass: 'neutral', score: 0, confidence: 0.1, reason: `Insufficient data: need ${MIN_BARS} bars, have ${closes.length}.` };
    }
    const { bandwidth } = bollingerBands(closes, bbPeriod);
    if (bandwidth.length < squeezeLookback) {
      return { signalClass: 'neutral', score: 0, confidence: 0.1, reason: 'Not enough bandwidth values.' };
    }

    const currentBW = bandwidth[bandwidth.length - 1];
    const lookbackSlice = bandwidth.slice(-squeezeLookback);
    const minBW = Math.min(...lookbackSlice);
    const maxBW = Math.max(...lookbackSlice);
    const bwRange = maxBW - minBW;
    if (bwRange === 0) {
      return { signalClass: 'neutral', score: 0, confidence: 0, reason: 'Zero bandwidth range.' };
    }

    const percentile = (currentBW - minBW) / bwRange; // 0=minimum, 1=maximum
    const percentilePct = Math.round(percentile * 100);

    // ── BASE (continuous, 30–60) ──────────────────────────
    let baseScore: number;
    if (percentile <= 0.25) {
      baseScore = Math.round(50 + (1 - percentile / 0.25) * 10); // 50→60 as squeeze tightens
    } else if (percentile >= 0.75) {
      baseScore = Math.round(35 - ((percentile - 0.75) / 0.25) * 5); // 35→30 as expansion widens
    } else {
      baseScore = 40; // normal range
    }

    // ── BONUS (extreme squeezes only) ─────────────────────
    let bonusScore = 0;
    let bonusLabel = '';
    if (percentile <= 0.05) { bonusScore = 30; bonusLabel = 'extreme squeeze (<5th pct)'; }
    else if (percentile <= 0.10) { bonusScore = 20; bonusLabel = 'tight squeeze (<10th pct)'; }

    const totalScore = baseScore + bonusScore;
    const confidence = bonusScore > 0 ? 0.65 : percentile <= 0.25 ? 0.50 : 0.25;

    const parts = [`base=${baseScore} (p${percentilePct})`];
    if (bonusScore > 0) parts.push(`+${bonusScore} bonus (${bonusLabel})`);

    return {
      signalClass: 'neutral', // 2026-08-14: squeeze is direction-neutral (volatility coiling, not a directional call)
      score: totalScore,
      confidence,
      reason: `BB squeeze: bandwidth at ${percentilePct}th percentile (${currentBW.toFixed(2)}%). ${parts.join(' ')}=${totalScore}/${this.maxScore}`,
      metadata: { baseScore, bonusScore, bonusLabel, percentile: percentilePct, currentBW },
    };
  }
}
