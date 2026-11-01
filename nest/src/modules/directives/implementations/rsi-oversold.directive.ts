/**
 * RSI Oversold Reversion — HYBRID BASE+BONUS (Layer C, 2026-07-29)
 * ===================================================================
 * Bullish when RSI(14) is low and curling upward.
 *
 * ── Hybrid Scoring ─────────────────────────────────────────
 * BASE (0–50):   Continuous linear interpolation: RSI 70→0, RSI 30→50.
 *                Every RSI tick produces a visible score change.
 * BONUS tiers:   Rare threshold events that create ladder separation.
 *                RSI < 30 → +30 (1.5σ), RSI < 25 → +50 (2σ), RSI < 20 → +80 (3σ).
 * CURL bonus:    +10 if RSI is rising (recovery signal).
 * MAX:           140 (50 base + 80 extreme bonus + 10 curl).
 *
 * See docs/theories/sees-hybrid-scoring.md (central docs store) for the full architecture — moved
 * out of the repo 2026-09-13.
 */

import { Injectable } from '@nestjs/common';
import {
  DirectiveInput,
  DirectiveResult,
  IDirective,
} from '../interfaces/directive.interface';
import { rsi } from '../utils/indicators';
import { resolveParams, type NumericParamSpec } from '../parameters';

const RSI_PERIOD = 14;
const OVERSOLD_LEVEL = 30;

/**
 * The bonus ladder is expressed as FRACTIONS of `oversoldLevel`, not as three separate constants.
 * At the production level of 30 that resolves to 20 and 25 exactly — deep = 30 × 2/3, extreme = 30 × 5/6
 * — so the default is byte-identical to the pre-parameter scoring (pinned by `directive-parameters.spec.ts`).
 * Scaling matters because three fixed tiers cannot stay coherent under a tunable gate: at level 20 a
 * fixed "deep < 20" tier would be unreachable, and the ladder would silently invert.
 */
const DEEP_FRACTION = 2 / 3;
const EXTREME_FRACTION = 5 / 6;

const PARAMS: readonly NumericParamSpec[] = [
  {
    key: 'rsiPeriod',
    label: 'RSI period',
    type: 'number',
    default: RSI_PERIOD,
    min: 2,
    max: 60,
    step: 1,
    unit: 'bars',
    chart: 'series',
    why: 'Measured 2026-11-01 (#1166): RSI-7 found 58 oversold entries on VIX 1h where RSI-14 found 13, and they shared ONE. The period selects a different opportunity set, not a different setting.',
    source: 'rsi-oversold.directive.ts:26 RSI_PERIOD',
  },
  {
    key: 'oversoldLevel',
    label: 'Oversold level',
    type: 'number',
    default: OVERSOLD_LEVEL,
    min: 10,
    max: 40,
    step: 1,
    chart: 'threshold',
    why: 'Measured 2026-11-01 (#1166): the fixed 30 gate fires 0-4 times over 9 months of daily bars on NVDA/SPY/VIX. A gate calibrated for an instrument that oscillates around 50 does not trip on one that trends. Bounded to 10-40 so the derived bonus ladder stays ordered.',
    source: 'rsi-oversold.directive.ts:140 oversold gate (was `currentRsi < 30`)',
  },
];

/** Linear interpolation: map value from [inMin,inMax] to [outMin,outMax], clamped. */
function mapRange(v: number, inMin: number, inMax: number, outMin: number, outMax: number): number {
  const t = Math.max(0, Math.min(1, (v - inMin) / (inMax - inMin)));
  return outMin + t * (outMax - outMin);
}

@Injectable()
export class RsiOversoldDirective implements IDirective {
  readonly id = 'rsi-oversold';
  readonly name = 'RSI Oversold Reversion';
  readonly category = 'oscillator' as const;
  readonly description =
    'Hybrid scoring: continuous base (RSI 70→0pts, 30→50pts) + threshold bonuses for rare oversold events.';
  readonly priority = 85;
  readonly maxScore = 140;
  readonly minScore = 1; // 50 base + 80 extreme bonus
  readonly minBars = { '1d': 16 };
  readonly version = '2.1.0'; // parameters (M2, #1165)
  readonly readiness = 'ready' as const;
  readonly directionBias = 'bullish' as const;
  readonly params = PARAMS;

  calculate(input: DirectiveInput): DirectiveResult {
    const { values } = resolveParams(this.id, this.params, input.params);
    const rsiPeriod = values.rsiPeriod as number;
    const oversoldLevel = values.oversoldLevel as number;
    const deepLevel = oversoldLevel * DEEP_FRACTION;
    const extremeLevel = oversoldLevel * EXTREME_FRACTION;
    const closes = input.bars.map((b) => b.close);
    if (closes.length < rsiPeriod + 2) {
      return {
        score: 0, confidence: 0.1,
        reason: `Insufficient data: need ${rsiPeriod + 2} bars, have ${closes.length}.`,
        signalClass: 'neutral',
      };
    }

    const rsiValues = rsi(closes, rsiPeriod);
    if (rsiValues.length < 2) {
      return {
        score: 0, confidence: 0.1,
        reason: 'Not enough RSI values to detect curl.',
        signalClass: 'neutral',
      };
    }

    const currentRsi = rsiValues[rsiValues.length - 1];
    const previousRsi = rsiValues[rsiValues.length - 2];

    if (!Number.isFinite(currentRsi) || !Number.isFinite(previousRsi)) {
      return {
        score: 0, confidence: 0.1,
        reason: 'RSI calculation produced non-finite value.',
        signalClass: 'neutral',
      };
    }

    const curling = currentRsi > previousRsi;

    // ── BASE (continuous, 0–50) ──────────────────────────
    // RSI 70 → base 0 (overbought, no oversold signal)
    // RSI 30 → base 50 (at threshold, max base signal)
    // RSI < 30 → base stays at 50 (bonus takes over below threshold)
    const baseScore = Math.round(mapRange(currentRsi, 70, oversoldLevel, 0, 50));

    // ── BONUS (threshold-gated, rare events) ─────────────
    let bonusScore = 0;
    let bonusLabel = '';
    if (currentRsi < extremeLevel) {
      bonusScore = 80;
      bonusLabel = 'extreme oversold (3σ)';
    } else if (currentRsi < deepLevel) {
      bonusScore = 50;
      bonusLabel = 'deep oversold (2σ)';
    } else if (currentRsi < oversoldLevel) {
      bonusScore = 30;
      bonusLabel = 'oversold (1.5σ)';
    }

    // ── CURL (recovery confirmation) ─────────────────────
    const curlBonus = curling ? 10 : 0;

    const totalScore = baseScore + bonusScore + curlBonus;
    const signalClass = totalScore >= 60 ? 'bullish' : 'neutral'; // 2026-08-14: never bearish — bullish-only (oversold reversion) directive; low score = "not oversold", not "bearish"
    const confidence = bonusScore > 0
      ? Math.min(0.95, 0.5 + (bonusScore / 80) * 0.4 + (curling ? 0.1 : 0))
      : Math.max(0.15, 0.3 + (baseScore / 50) * 0.2);

    const parts: string[] = [`base=${baseScore}`];
    if (bonusScore > 0) parts.push(`+${bonusScore} bonus (${bonusLabel})`);
    if (curlBonus > 0) parts.push(`+${curlBonus} curl`);
    parts.push(`= ${totalScore}/${this.maxScore}`);

    return {
      score: totalScore,
      confidence: Number(confidence.toFixed(2)),
      reason: `RSI(14)=${currentRsi.toFixed(1)} ${curling ? '↑' : '↓'}: ${parts.join(' ')}`,
      signalClass,
      metadata: { baseScore, bonusScore, bonusLabel, curlBonus, currentRsi },
    };
  }
}
