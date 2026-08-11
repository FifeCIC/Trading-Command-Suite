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
 * MAX:           130 (50 base + 80 extreme bonus). Protocol can override.
 *
 * See docs/sees-hybrid-scoring.md for the full architecture.
 */

import { Injectable } from '@nestjs/common';
import {
  DirectiveInput,
  DirectiveResult,
  IDirective,
} from '../interfaces/directive.interface';
import { rsi } from '../utils/indicators';

const RSI_PERIOD = 14;
const MIN_BARS = RSI_PERIOD + 2;

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
  readonly version = '2.0.1'; // Hybrid scoring
  readonly readiness = 'ready' as const;
  readonly directionBias = 'bullish' as const;

  calculate(input: DirectiveInput): DirectiveResult {
    const closes = input.bars.map((b) => b.close);
    if (closes.length < MIN_BARS) {
      return {
        score: 0, confidence: 0.1,
        reason: `Insufficient data: need ${MIN_BARS} bars, have ${closes.length}.`,
        signalClass: 'neutral',
      };
    }

    const rsiValues = rsi(closes, RSI_PERIOD);
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
    const baseScore = Math.round(mapRange(currentRsi, 70, 30, 0, 50));

    // ── BONUS (threshold-gated, rare events) ─────────────
    let bonusScore = 0;
    let bonusLabel = '';
    if (currentRsi < 20) {
      bonusScore = 80;
      bonusLabel = 'extreme oversold (3σ)';
    } else if (currentRsi < 25) {
      bonusScore = 50;
      bonusLabel = 'deep oversold (2σ)';
    } else if (currentRsi < 30) {
      bonusScore = 30;
      bonusLabel = 'oversold (1.5σ)';
    }

    // ── CURL (recovery confirmation) ─────────────────────
    const curlBonus = curling ? 10 : 0;

    const totalScore = baseScore + bonusScore + curlBonus;
    const signalClass = totalScore >= 60 ? 'bullish' : totalScore >= 40 ? 'neutral' : 'bearish';
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
