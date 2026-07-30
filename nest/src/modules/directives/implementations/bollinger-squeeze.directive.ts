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

const BB_PERIOD = 20;
const SQUEEZE_LOOKBACK = 50;
const MIN_BARS = BB_PERIOD + SQUEEZE_LOOKBACK + 2;

@Injectable()
export class BollingerBandSqueezeDirective implements IDirective {
  readonly id = 'bollinger-band-squeeze';
  readonly name = 'Bollinger Band Squeeze';
  readonly description = 'Hybrid: continuous percentile base + bonus for extreme squeezes.';
  readonly priority = 50;
  readonly maxScore = 90;
  readonly minBars = { '1d': 72 };
  readonly version = '2.0.0';
  readonly readiness = 'ready' as const;

  calculate(input: DirectiveInput): DirectiveResult {
    const closes = input.bars.map(b => b.close);
    if (closes.length < MIN_BARS) {
      return { signalClass: 'neutral', score: 0, confidence: 0.1, reason: `Insufficient data: need ${MIN_BARS} bars, have ${closes.length}.` };
    }
    const { bandwidth } = bollingerBands(closes, BB_PERIOD);
    if (bandwidth.length < SQUEEZE_LOOKBACK) {
      return { signalClass: 'neutral', score: 0, confidence: 0.1, reason: 'Not enough bandwidth values.' };
    }

    const currentBW = bandwidth[bandwidth.length - 1];
    const lookbackSlice = bandwidth.slice(-SQUEEZE_LOOKBACK);
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
      signalClass: totalScore >= 60 ? 'bullish' : 'neutral',
      score: totalScore,
      confidence,
      reason: `BB squeeze: bandwidth at ${percentilePct}th percentile (${currentBW.toFixed(2)}%). ${parts.join(' ')}=${totalScore}/${this.maxScore}`,
      metadata: { baseScore, bonusScore, bonusLabel, percentile: percentilePct, currentBW },
    };
  }
}
