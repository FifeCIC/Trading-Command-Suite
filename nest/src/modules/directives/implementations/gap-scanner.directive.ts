/**
 * Pre-Market Gap Scanner Directive
 * ================================
 *
 * Detects price gaps between the previous session's close and the current
 * session's open. Gap trading has well-documented statistical edges —
 * gaps tend to fill within the first 15-60 minutes of trading.
 *
 * CLASSIFICATION:
 * - Gap Up (>0.5%): Price opened higher than previous close
 * - Gap Down (<-0.5%): Price opened lower than previous close
 * - Flat (±0.5%): Normal open
 *
 * SCORING:
 * - Small gaps (0.5-2%): High fill probability → bullish for gap-down (buy the dip),
 *   bearish for gap-up (fade the rally)
 * - Large gaps (>2%): Gap-and-go potential → bullish for gap-up (momentum continuation),
 *   bearish for gap-down (panic continuation)
 * - Extreme gaps (>5%): News-driven — neutral (unpredictable)
 *
 * DATA REQUIREMENTS:
 * - Previous daily bar (close)
 * - Current intraday bars (open of first bar)
 * - Falls back to neutral if data is missing
 */

import { Injectable } from '@nestjs/common';
import {
  DirectiveInput,
  DirectiveResult,
  IDirective,
} from '../interfaces/directive.interface';

const GAP_THRESHOLD = 0.5; // % — minimum to classify as a gap
const SMALL_GAP_MAX = 2.0; // % — small gaps have high fill probability
const LARGE_GAP_MIN = 2.0; // % — large gaps may gap-and-go
const EXTREME_GAP = 5.0;   // % — news-driven, unpredictable

@Injectable()
export class GapScannerDirective implements IDirective {
  readonly id = 'gap-scanner';
  readonly name = 'Pre-Market Gap Scanner';
  readonly description =
    'Detects overnight/opening price gaps. Small gaps (0.5-2%) tend to fill — fade the gap. Large gaps (>2%) may gap-and-go — follow momentum. Extreme gaps (>5%) are news-driven and unpredictable.';
  readonly priority = 72;
  readonly maxScore = 100;
  readonly minBars = { '1d': 2 };
  readonly version = '1.0.0';
  readonly readiness = 'ready' as const;

  calculate(input: DirectiveInput): DirectiveResult {
    const { bars, dayBars } = input;

    // Use dayBars from input if available; otherwise fall back to main bars
    const dailyBars = dayBars;
    const intradayBars = bars;

    if (!dailyBars || dailyBars.length < 2) {
      // Without daily bars, we cannot determine the previous session's close.
      // Using intraday bars[0].close would be misleading — return neutral.
      return {
        score: 25, confidence: 0.15,
        reason: 'No daily bar data available — gap detection requires previous session close. Provide dayBars on DirectiveInput.',
        signalClass: 'neutral',
      };
    }

    // Standard path: previous daily close vs current first bar open
    const prevDayClose = dailyBars[dailyBars.length - 2].close;
    const currentOpen = bars[bars.length - 1].open;

    return this.evaluateGap(prevDayClose, currentOpen, bars);
  }

  private evaluateGap(prevClose: number, currentOpen: number, bars: any[]): DirectiveResult {
    if (prevClose <= 0 || currentOpen <= 0) {
      return { score: 25, confidence: 0.1, reason: 'Invalid price data for gap calculation.', signalClass: 'neutral' };
    }

    const gapPct = ((currentOpen - prevClose) / prevClose) * 100;
    const absGap = Math.abs(gapPct);

    // ── No significant gap ──
    if (absGap < GAP_THRESHOLD) {
      return {
        score: 25,
        confidence: 0.5,
        reason: `No significant gap: ${gapPct.toFixed(2)}% (threshold: ±${GAP_THRESHOLD}%).`,
        signalClass: 'neutral',
      };
    }

    // ── Extreme gap (news-driven) ──
    if (absGap >= EXTREME_GAP) {
      return {
        score: 30,
        confidence: 0.2,
        reason: `Extreme gap ${gapPct.toFixed(1)}% — likely news-driven, unpredictable. No edge.`,
        signalClass: 'neutral',
      };
    }

    // ── Small gap (0.5-2%) — fade it ──
    if (absGap <= SMALL_GAP_MAX) {
      const strength = (absGap - GAP_THRESHOLD) / (SMALL_GAP_MAX - GAP_THRESHOLD); // 0→1

      if (gapPct > 0) {
        // Gap UP — fade (sell the rally, gap likely to fill downward)
        const score = 15 - strength * 12; // Low score = bearish for long-biased
        return {
          score: Math.round(Math.max(score, 2)),
          confidence: Math.min(0.82, 0.45 + strength * 0.35),
          reason: `Small gap UP ${gapPct.toFixed(2)}% — high fill probability, fade the gap. Strength: ${(strength*100).toFixed(0)}%.`,
          signalClass: 'bearish',
        };
      } else {
        // Gap DOWN — buy the dip (gap likely to fill upward)
        const score = 60 + strength * 30;
        return {
          score: Math.round(Math.min(score, this.maxScore)),
          confidence: Math.min(0.82, 0.45 + strength * 0.35),
          reason: `Small gap DOWN ${gapPct.toFixed(2)}% — high fill probability, buy the dip. Strength: ${(strength*100).toFixed(0)}%.`,
          signalClass: 'bullish',
        };
      }
    }

    // ── Large gap (2-5%) — gap-and-go ──
    const strength = Math.min(1, (absGap - LARGE_GAP_MIN) / (EXTREME_GAP - LARGE_GAP_MIN));

    // Volume confirmation: compare recent volume against 20-bar average
    const recentVol = bars.slice(-5).reduce((s: number, b: any) => s + (b.volume || 0), 0);
    const allVol = bars.slice(-20).reduce((s: number, b: any) => s + (b.volume || 0), 0);
    const avgVol5 = allVol > 0 ? (allVol / 20) * 5 : 0; // Expected 5-bar volume based on 20-bar avg
    const volRatio = avgVol5 > 0 ? recentVol / avgVol5 : 0;
    const hasStrongVolume = volRatio > 1.2; // 20% above average
    const hasSomeVolume = volRatio > 0.3;   // At least some activity

    if (gapPct > 0) {
      // Large gap UP — momentum continuation
      const score = 65 + strength * 25;
      return {
        score: Math.round(Math.min(score, this.maxScore)),
        confidence: Math.min(0.85, 0.5 + strength * 0.30 + (hasStrongVolume ? 0.10 : hasSomeVolume ? 0.03 : 0)),
        reason: `Large gap UP ${gapPct.toFixed(2)}% — gap-and-go potential. Volume: ${volRatio.toFixed(1)}× avg (${hasStrongVolume ? 'confirmed' : hasSomeVolume ? 'moderate' : 'low — caution'}). Strength: ${(strength*100).toFixed(0)}%.`,
        signalClass: 'bullish',
      };
    } else {
      // Large gap DOWN — momentum continuation (bearish)
      return {
        score: Math.round(Math.max(2, 10 - strength * 8)),
        confidence: Math.min(0.85, 0.5 + strength * 0.30),
        reason: `Large gap DOWN ${gapPct.toFixed(2)}% — continuation risk, do not buy. Strength: ${(strength*100).toFixed(0)}%.`,
        signalClass: 'bearish',
      };
    }
  }
}
