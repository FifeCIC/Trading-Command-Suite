/**
 * Wick Filter Directive
 * =====================
 * Detects whether a price spike is a "fakeout" (long wick) or a genuine breakout.
 * 
 * Scoring logic:
 * - Long wick that retraced >50% with normal volume = FAKEOUT (low score, don't move stop)
 * - Long wick with elevated volume and multi-TF confirmation = REAL (high score, move stop)
 * - Normal candle = neutral
 * 
 * Used by Stop Guardian to decide whether to adjust trailing stops.
 */

import { Injectable } from '@nestjs/common';
import { DirectiveInput, DirectiveResult, IDirective } from '../interfaces/directive.interface';
import { atr } from '../utils/indicators';

const WICK_ATR_THRESHOLD = 1.5;   // Wick > 1.5× ATR = significant
const RETRACE_THRESHOLD = 0.5;     // Retrace > 50% of wick = fakeout
const VOL_SPIKE_MULTIPLIER = 1.5;  // Volume > 1.5× average = elevated

@Injectable()
export class WickFilterDirective implements IDirective {
  readonly id = 'wick-filter';
  readonly name = 'Wick Filter';
  readonly description = 'Detects fakeout wicks vs genuine breakouts. Uses ATR, volume, and multi-timeframe logic.';
  readonly priority = 55;
  readonly maxScore = 100;
  readonly version = '1.0.0';

  calculate(input: DirectiveInput): DirectiveResult {
    const bars = input.bars;
    if (bars.length < 10) {
      return { score: 0, confidence: 0.1, reason: 'Insufficient data (need 10+ bars)', signalClass: 'neutral' };
    }

    const last = bars[bars.length - 1];
    const prevBar = bars[bars.length - 2];
    const highs = bars.map((b) => b.high);
    const lows = bars.map((b) => b.low);
    const closes = bars.map((b) => b.close);
    const volumes = bars.map((b) => b.volume);

    const a = atr(highs, lows, closes, 14);
    const lastAtr = a[a.length - 1];

    // ── Wick Analysis ──
    const isBullishBar = last.close >= last.open;
    const upperWick = isBullishBar ? last.high - last.close : last.high - last.open;
    const lowerWick = isBullishBar ? last.open - last.low : last.close - last.low;
    const bodySize = Math.abs(last.close - last.open);
    const totalRange = last.high - last.low;

    // Which wick is dominant?
    const dominantWick = Math.max(upperWick, lowerWick);
    const wickRatio = totalRange > 0 ? dominantWick / totalRange : 0;

    // ── Retrace check ──
    // Did price retrace back through the wick?
    const wickDirection = upperWick > lowerWick ? 'up' : 'down';
    let retraceRatio = 0;
    if (wickDirection === 'up') {
      // Upper wick: did price come back down?
      retraceRatio = upperWick > 0 ? (last.high - last.close) / upperWick : 0;
    } else {
      // Lower wick: did price bounce back up?
      retraceRatio = lowerWick > 0 ? (last.close - last.low) / lowerWick : 0;
    }

    // ── Volume check ──
    const avgVol = volumes.slice(-10, -1).reduce((a, b) => a + b, 0) / 9;
    const volRatio = avgVol > 0 ? last.volume / avgVol : 1;

    // ── Multi-bar context ──
    const prevClose = prevBar.close;
    const priceDirection = last.close > prevClose ? 'up' : 'down';

    // ── Scoring ──
    let score = 0;
    let reason = '';
    let signalClass: 'bullish' | 'bearish' | 'neutral' = 'neutral';

    const isSignificantWick = dominantWick > lastAtr * WICK_ATR_THRESHOLD;
    const isHighRetrace = retraceRatio > RETRACE_THRESHOLD;
    const isElevatedVol = volRatio > VOL_SPIKE_MULTIPLIER;

    if (isSignificantWick && isHighRetrace && !isElevatedVol) {
      // ── FAKEOUT: Big wick, retraced, normal volume ──
      score = 15;
      signalClass = 'neutral';
      reason = `Fakeout wick detected: ${wickDirection}-wick ${(wickRatio * 100).toFixed(0)}% of range, retraced ${(retraceRatio * 100).toFixed(0)}%, vol ${volRatio.toFixed(1)}x avg. Do NOT move stop.`;
    } else if (isSignificantWick && isElevatedVol) {
      // ── REAL BREAK: Big wick + elevated volume ──
      score = 80;
      signalClass = wickDirection === 'up' ? 'bullish' : 'bearish';
      reason = `Genuine breakout: ${wickDirection}-wick ${(wickRatio * 100).toFixed(0)}% of range, vol ${volRatio.toFixed(1)}x avg. Stop adjustment justified.`;
    } else if (isSignificantWick && !isHighRetrace) {
      // ── SUSTAINED: Big wick, didn't retrace ──
      score = 65;
      signalClass = wickDirection === 'up' ? 'bullish' : 'bearish';
      reason = `Sustained ${wickDirection}-move: wick ${(wickRatio * 100).toFixed(0)}% of range, minimal retrace. Momentum intact.`;
    } else if (wickRatio > 0.7 && isHighRetrace) {
      // ── INDECISION: Mostly wick, heavy retrace ──
      score = 30;
      signalClass = 'neutral';
      reason = `Indecision candle: ${(wickRatio * 100).toFixed(0)}% wick, heavy retrace. Market uncertain — hold stop.`;
    } else {
      // ── NORMAL: Nothing notable ──
      score = 50;
      signalClass = 'neutral';
      reason = `Normal price action. Wick ${(wickRatio * 100).toFixed(0)}% of range, ATR ratio ${(dominantWick / lastAtr).toFixed(1)}x.`;
    }

    return {
      score: Math.round(score),
      confidence: 0.4 + (isSignificantWick ? 0.3 : 0.1),
      reason,
      signalClass,
      metadata: {
        wickRatio,
        wickDirection,
        retraceRatio,
        volRatio,
        atrRatio: dominantWick / lastAtr,
        isFakeout: isSignificantWick && isHighRetrace && !isElevatedVol,
        isBreakout: isSignificantWick && isElevatedVol,
      },
    };
  }
}
