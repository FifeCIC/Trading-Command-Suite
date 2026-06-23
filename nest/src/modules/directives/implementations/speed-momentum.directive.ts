/**
 * Speed Momentum
 * ===============
 * Core speed-trading directive. Measures short-term price velocity
 * (5-candle rate of change) on the active timeframe, amplified by
 * volume confirmation.
 *
 * maxScore: 120 — high ceiling because this is the primary signal
 * for the Bitcoin Speed Protocol and high-vol scalping strategies.
 */

import { Injectable } from '@nestjs/common';
import {
  DirectiveInput,
  DirectiveResult,
  IDirective,
} from '../interfaces/directive.interface';

const LOOKBACK = 5; // 5-candle velocity window
const MIN_BARS = LOOKBACK + 5; // Need extra bars for volume comparison

@Injectable()
export class SpeedMomentumDirective implements IDirective {
  readonly id = 'speed-momentum';
  readonly name = 'Speed Momentum';
  readonly description =
    'Short-term price velocity over 5 candles, amplified by volume confirmation. Core signal for speed/scalp trading on M1-M15 timeframes.';
  readonly priority = 85;
  readonly maxScore = 120;
  readonly version = '1.0.0';

  calculate(input: DirectiveInput): DirectiveResult {
    const bars = input.bars;
    if (!bars || bars.length < MIN_BARS) {
      return {
        score: 0,
        confidence: 0.0,
        reason: `Insufficient bars: need ${MIN_BARS}, have ${bars?.length ?? 0}.`,
        signalClass: 'neutral',
      };
    }

    // ── 5-candle Rate of Change ─────────────────────────
    const latest = bars[bars.length - 1];
    const previous = bars[bars.length - 1 - LOOKBACK];
    const roc = previous.close > 0
      ? ((latest.close - previous.close) / previous.close) * 100
      : 0;

    // ── Volume Confirmation ─────────────────────────────
    const recentBars = bars.slice(-LOOKBACK);
    const olderBars = bars.slice(-LOOKBACK * 2, -LOOKBACK);

    const recentVol = recentBars.reduce((s, b) => s + (b.volume || 0), 0) / LOOKBACK;
    const olderVol = olderBars.length > 0
      ? olderBars.reduce((s, b) => s + (b.volume || 0), 0) / olderBars.length
      : recentVol;

    const volRatio = olderVol > 0 ? recentVol / olderVol : 1;

    // ── Score: ROC magnitude × volume multiplier ────────
    const absRoc = Math.abs(roc);
    let score = Math.min(this.maxScore, absRoc * 80); // 1.5%+ move = 120

    // Volume can amplify up to 2x
    const volMultiplier = Math.min(2.0, Math.max(0.5, volRatio));
    score = Math.round(score * volMultiplier);

    // ── Direction ───────────────────────────────────────
    const direction = roc > 0.15
      ? 'bullish'
      : roc < -0.15
        ? 'bearish'
        : 'neutral';

    // ── Confidence ──────────────────────────────────────
    const confidence = Math.min(0.95, absRoc * 0.4 + (volRatio > 1.2 ? 0.15 : 0));

    // Clamp to declared maxScore
    const clampedScore = Math.min(this.maxScore, Math.max(0, score));

    return {
      score: clampedScore,
      confidence: Number(confidence.toFixed(2)),
      reason: `${direction} velocity: ${roc >= 0 ? '+' : ''}${roc.toFixed(2)}% over ${LOOKBACK} bars. Volume: ${volRatio.toFixed(1)}x avg.`,
      signalClass: direction,
    };
  }
}
