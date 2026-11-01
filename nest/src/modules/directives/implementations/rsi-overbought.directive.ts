/**
 * RSI Overbought Warning — HYBRID BASE+BONUS (Layer C, 2026-07-29)
 * ===================================================================
 * Mirror of rsi-oversold. RSI(14) > 70 = overbought, curling down = bearish.
 *
 * ── Hybrid Scoring ─────────────────────────────────────────
 * BASE (0–50):   Continuous: RSI 30→0, RSI 70→50. Every tick visible.
 * BONUS tiers:   RSI > 70 → +30, RSI > 75 → +50, RSI > 85 → +80.
 * CURL bonus:    +10 if RSI is falling (overbought reversal).
 * MAX:           130.
 *
 * See docs/theories/sees-hybrid-scoring.md in the central docs store (moved out of the repo 2026-09-13).
 */

import { Injectable } from '@nestjs/common';
import { DirectiveInput, DirectiveResult, IDirective } from '../interfaces/directive.interface';
import { rsi } from '../utils/indicators';
import { resolveParams, type NumericParamSpec } from '../parameters';

const RSI_PERIOD = 14;
const MIN_BARS = RSI_PERIOD + 2;

/**
 * Tunable knob (#1165). The default IS the constant above — BASELINE proves the equality.
 *
 * ⚠️ A shorter RSI reaches the overbought tiers on smaller moves, so on the SAME bars RSI-7 can be
 * in the `> 70` bonus tier while RSI-14 sits in the neutral base band. That is a different reading of
 * the same market, not a different setting of one — measured on the `noisy-uptrend` fixture.
 */
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
    why: 'Measured 2026-11-01 (#1166 method): RSI-7 clears 70 on a pullback where RSI-14 does not, so the period decides whether the overbought bonus tiers are ever reached. 14 is a daily-chart convention.',
    source: 'rsi-overbought.directive.ts:19 RSI_PERIOD',
  },
];

function mapRange(v: number, inMin: number, inMax: number, outMin: number, outMax: number): number {
  const t = Math.max(0, Math.min(1, (v - inMin) / (inMax - inMin)));
  return outMin + t * (outMax - outMin);
}

@Injectable()
export class RsiOverboughtDirective implements IDirective {
  readonly id = 'rsi-overbought';
  readonly name = 'RSI Overbought Warning';
  readonly description = 'Hybrid: continuous base + threshold bonuses for rare overbought events.';
  readonly category = 'oscillator' as const;
  readonly priority = 50;
  readonly maxScore = 140;
  readonly minScore = 1;
  readonly minBars = { '1d': 16 };
  readonly version = '2.0.1';
  readonly readiness = 'ready' as const;
  readonly directionBias = 'bearish' as const;
  readonly params = PARAMS;

  calculate(input: DirectiveInput): DirectiveResult {
    const { values } = resolveParams(this.id, this.params, input.params);
    const rsiPeriod = values.rsiPeriod as number;
    const closes = input.bars.map(b => b.close);
    const minBars = Math.max(MIN_BARS, rsiPeriod + 2);
    if (closes.length < minBars) {
      return { score: 0, confidence: 0.1, reason: `Insufficient data: need ${minBars} bars, have ${closes.length}.` };
    }
    const rsiValues = rsi(closes, rsiPeriod);
    if (rsiValues.length < 2) {
      return { score: 0, confidence: 0.1, reason: 'Not enough RSI values.' };
    }
    const currentRsi = rsiValues[rsiValues.length - 1];
    const previousRsi = rsiValues[rsiValues.length - 2];
    const curlingDown = currentRsi < previousRsi;

    // BASE: RSI 30→0, RSI 70→50 (higher RSI = more overbought = higher base)
    const baseScore = Math.round(mapRange(currentRsi, 30, 70, 0, 50));

    // BONUS tiers
    let bonusScore = 0;
    let bonusLabel = '';
    if (currentRsi > 85) { bonusScore = 80; bonusLabel = 'extreme overbought (3σ)'; }
    else if (currentRsi > 75) { bonusScore = 50; bonusLabel = 'deep overbought (2σ)'; }
    else if (currentRsi > 70) { bonusScore = 30; bonusLabel = 'overbought (1.5σ)'; }

    const curlBonus = curlingDown ? 10 : 0;
    const totalScore = baseScore + bonusScore + curlBonus;

    const parts = [`base=${baseScore}`];
    if (bonusScore > 0) parts.push(`+${bonusScore} bonus (${bonusLabel})`);
    if (curlBonus > 0) parts.push(`+${curlBonus} curl↓`);

    return {
      signalClass: totalScore >= 60 ? 'bearish' : 'neutral',
      score: totalScore,
      confidence: Number((bonusScore > 0 ? Math.min(0.95, 0.5 + (bonusScore / 80) * 0.4 + (curlingDown ? 0.1 : 0)) : Math.max(0.15, 0.3 + (baseScore / 50) * 0.2)).toFixed(2)),
      reason: `RSI(14)=${currentRsi.toFixed(1)} ${curlingDown ? '↓' : '↑'}: ${parts.join(' ')}=${totalScore}/${this.maxScore}`,
      metadata: { baseScore, bonusScore, bonusLabel, curlBonus, currentRsi },
    };
  }
}
