/**
 * Volume Rhythm Directive
 * =======================
 * Analyzes day-of-week volume patterns for institutional trading rhythms.
 *
 * Scores higher when up-day volume exceeds down-day volume (accumulation).
 * Flags anomalous volume days (surge > 1.5x weekday average).
 * Includes day-of-week context in reason.
 *
 * TradePress source: includes/scoring-system/directives/volume-rhythm.php
 */

import { Injectable } from '@nestjs/common';
import { DirectiveInput, DirectiveResult, IDirective } from '../interfaces/directive.interface';

const MIN_BARS = 10; // Need at least 2 weeks
const SURGE_MULTIPLIER = 1.5;

@Injectable()
export class VolumeRhythmDirective implements IDirective {
  readonly id = 'volume-rhythm';
  readonly name = 'Volume Rhythm';
  readonly description = 'Day-of-week volume pattern analysis. Higher score when up-day volume exceeds down-day volume.';

  readonly priority = 50;
  readonly maxScore = 100;
  readonly minBars = { '1d': 10 };
  readonly version = '1.0.0';
  readonly readiness = 'ready' as const;

  calculate(input: DirectiveInput): DirectiveResult {
    const { bars } = input;
    if (bars.length < MIN_BARS) {
      return { score: 0, confidence: 0.1, reason: `Insufficient data: need ${MIN_BARS} bars, have ${bars.length}.` };
    }

    // Separate up days (close > open) and down days
    let upVolume = 0;
    let upCount = 0;
    let downVolume = 0;
    let downCount = 0;
    const weekdayVolumes: Record<number, { sum: number; count: number }> = {};
    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

    for (const bar of bars) {
      const vol = bar.volume;
      const day = new Date(bar.timestamp).getDay();

      if (!weekdayVolumes[day]) weekdayVolumes[day] = { sum: 0, count: 0 };
      weekdayVolumes[day].sum += vol;
      weekdayVolumes[day].count++;

      if (bar.close > bar.open) {
        upVolume += vol;
        upCount++;
      } else {
        downVolume += vol;
        downCount++;
      }
    }

    const avgUpVol = upCount > 0 ? upVolume / upCount : 0;
    const avgDownVol = downCount > 0 ? downVolume / downCount : 0;
    const upDownRatio = avgDownVol > 0 ? avgUpVol / avgDownVol : 1;

    // Find highest-volume weekday
    let maxWeekday = -1;
    let maxWeekdayAvg = 0;
    for (const [day, data] of Object.entries(weekdayVolumes)) {
      const avg = data.sum / data.count;
      if (avg > maxWeekdayAvg) { maxWeekdayAvg = avg; maxWeekday = Number(day); }
    }

    // Check most recent bar for surge
    const recent = bars[bars.length - 1];
    const recentDay = new Date(recent.timestamp).getDay();
    const wd = weekdayVolumes[recentDay];
    const weekdayAvg = wd ? wd.sum / wd.count : recent.volume;
    const isSurge = recent.volume > weekdayAvg * SURGE_MULTIPLIER && recent.volume > 0;

    if (upDownRatio > 1.2) {
      // Accumulation pattern: up-day volume significantly higher
      const strength = Math.min(1, (upDownRatio - 1) / 1); // 1.2–2.2 → 0–1
      const score = Math.round(55 + strength * 30 + (isSurge ? 10 : 0));
      return {
        score,
        confidence: 0.45 + strength * 0.2,
        reason: `Accumulation rhythm: up-day volume ${upDownRatio.toFixed(1)}x down-day volume.${isSurge ? ` ${dayNames[recentDay]} surge ${(recent.volume / weekdayAvg).toFixed(1)}x avg.` : ''} Peak day: ${dayNames[maxWeekday]}.`,
      };
    }

    if (upDownRatio < 0.8) {
      // Distribution pattern: down-day volume higher
      const strength = Math.min(1, (1 - upDownRatio) / 0.5);
      return {
      signalClass: 'neutral',
      score: Math.round(25 - strength * 10),
        confidence: 0.4 + strength * 0.15,
        reason: `Distribution rhythm: down-day volume dominant (ratio ${upDownRatio.toFixed(2)}).${isSurge ? ` ${dayNames[recentDay]} distribution surge.` : ''} Bearish for longs.`,
      };
    }

    if (isSurge) {
      return {
      signalClass: 'neutral',
      score: upDownRatio >= 1 ? 50 : 30,
        confidence: 0.35,
        reason: `${dayNames[recentDay]} volume surge (${(recent.volume / weekdayAvg).toFixed(1)}x avg). Volume anomaly — watch for follow-through.`,
      };
    }

    return {
      signalClass: 'neutral',
      score: 40,
      confidence: 0.3,
      reason: `Neutral volume rhythm (up/down ratio ${upDownRatio.toFixed(2)}). No strong accumulation or distribution pattern.`,
    };
  }
}
