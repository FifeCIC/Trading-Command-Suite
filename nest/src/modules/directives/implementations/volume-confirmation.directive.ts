/**
 * Volume Confirmation
 * ===================
 * Bullish setups score higher with volume support.
 * Compares recent volume to the 20-period average.
 */

import { Injectable } from '@nestjs/common';
import {
  DirectiveInput,
  DirectiveResult,
  IDirective,
} from '../interfaces/directive.interface';
import { sma } from '../utils/indicators';
import { resolveParams, type NumericParamSpec } from '../parameters';

const VOLUME_MA_PERIOD = 20;
// ⚠️ +2, not +1. The comparison now needs the last COMPLETE bar plus the 20 before it — the newest
// bar is excluded because it is still accumulating (see the note in calculate()).
const MIN_BARS = VOLUME_MA_PERIOD + 2;

/** The three volume-ratio tiers. Defaults are the constants this directive has always used. */
const SURGE_RATIO = 2.0;
const ELEVATED_RATIO = 1.3;

/**
 * Tunable knobs (#1165). Defaults are the constants above — BASELINE proves the equality.
 *
 * ⚠️ `surgeRatio` and `elevatedRatio` were unmeasurable on the original fixture set: five of seven
 * series held CONSTANT volume, so the last complete bar was exactly 1.00× its own average and every
 * tier comparison landed in the "normal" branch. The `mean-reverting` fixture now carries a genuine
 * volume surge (2.37× its 20-bar average, measured 2026-11-01), which is what makes the tiers
 * provable — 88 at the default, 100 when `surgeRatio` is raised past it, and 100 when
 * `elevatedRatio` is raised past it. A knob nobody can test is a knob a user will tune blind.
 */
const PARAMS: readonly NumericParamSpec[] = [
  {
    key: 'averagePeriod',
    label: 'Average period',
    type: 'number',
    default: VOLUME_MA_PERIOD,
    min: 3,
    max: 60,
    step: 1,
    unit: 'bars',
    chart: 'series',
    why: 'Measured 2026-11-01 (#1166 method): a 20-bar average is a month of daily hours but 20 hours intraday, so the same threshold means "unusual today" on one cadence and "unusual this month" on another. The surge fixture moves 89 → 92 between a 20- and a 5-bar window.',
    source: 'volume-confirmation.directive.ts:23 VOLUME_MA_PERIOD',
  },
  {
    key: 'surgeRatio',
    label: 'Surge threshold',
    type: 'number',
    default: SURGE_RATIO,
    min: 1.2,
    max: 4,
    step: 0.1,
    unit: '× average',
    chart: 'threshold',
    why: 'Measured 2026-11-01: 2× average is a genuine surge on a liquid FX pair and routine on a small-cap, so the tier boundary decides whether the same volume is confirmation or noise (fixture: 89 at 2×, 100 when raised to 4×).',
    source: 'volume-confirmation.directive.ts:78 `ratio >= 2.0`',
  },
  {
    key: 'elevatedRatio',
    label: 'Above-average threshold',
    type: 'number',
    default: ELEVATED_RATIO,
    min: 0.8,
    max: 1.8,
    step: 0.05,
    unit: '× average',
    chart: 'threshold',
    why: 'Measured 2026-11-01: at 0.8× a merely normal bar scores 55+, at 1.3× it scores 30 — the lower tier boundary moves ordinary bars out of "confirmation" entirely.',
    source: 'volume-confirmation.directive.ts:82 `ratio >= 1.3`',
  },
];

@Injectable()
export class VolumeConfirmationDirective implements IDirective {
  readonly id = 'volume-confirmation';
  readonly name = 'Volume Confirmation';
  readonly category = 'ratio' as const;
  readonly description =
    'Scores symbols where recent volume exceeds the average.';
  readonly priority = 60;
  readonly maxScore = 100;
  readonly minScore = 1;
  readonly minBars = { '1d': 21 }; // Raised from 85 — the bonus structure in calculate() can reach 100
  readonly version = '1.1.0';
  readonly readiness = 'ready' as const;
  readonly directionBias = 'neutral' as const;
  readonly params = PARAMS;

  calculate(input: DirectiveInput): DirectiveResult {
    const { bars } = input;
    const { values } = resolveParams(this.id, this.params, input.params);
    const averagePeriod = values.averagePeriod as number;
    const surgeRatio = values.surgeRatio as number;
    const elevatedRatio = values.elevatedRatio as number;

    if (bars.length < Math.max(MIN_BARS, averagePeriod + 2)) {
      return {
        score: 0,
        confidence: 0.1,
        reason: `Insufficient data: need ${Math.max(MIN_BARS, averagePeriod + 2)} bars, have ${bars.length}.`,
        signalClass: 'neutral',
      };
    }

    // ⚠️ BOTH SIDES MUST BE COMPLETE BARS — the newest bar is excluded from BOTH.
    //
    // The 20-bar average was built from complete bars while the numerator was the CURRENT,
    // partially-accumulated one, so the ratio measured how far through the bar we were rather than
    // how much volume there was. Measured 2026-10-20 00:12Z, newest 1h bar 12.8 minutes old
    // (~21% complete): XAUUSD 0.02x, VIX 0.06x, BTC 0.01x. Three unrelated markets do not all
    // trade at 1-6% of average volume (#1130). Effect: this directive sat at 0-1/100 for most of
    // every bar while holding its FULL capacity in the protocol's denominator — the same
    // permanent-dilution shape as the always-neutral directives in #1131.
    //
    // Now: the last FINISHED bar, against the 20 finished bars before it.
    const volumes = bars.map((b) => b.volume);
    const currentVolume = volumes[volumes.length - 2];
    const avgVolume = sma(volumes.slice(0, -2), averagePeriod);

    if (avgVolume <= 0) {
      return {
        score: 0,
        confidence: 0.1,
        reason: 'Average volume is zero — no reference for comparison.',
        signalClass: 'neutral',
      };
    }

    const ratio = currentVolume / avgVolume;

    let score: number;
    let reason: string;

    if (ratio >= surgeRatio) {
      // Very high volume — strong confirmation
      score = 85 + Math.min(15, (ratio - surgeRatio) * 10);
      reason = `Strong volume surge: ${ratio.toFixed(2)}x average (${currentVolume.toLocaleString()} vs avg ${Math.round(avgVolume).toLocaleString()}).`;
    } else if (ratio >= elevatedRatio) {
      // Above-average volume — good confirmation
      score = 55 + (ratio - elevatedRatio) * 43;
      reason = `Above-average volume: ${ratio.toFixed(2)}x (${currentVolume.toLocaleString()} vs avg ${Math.round(avgVolume).toLocaleString()}).`;
    } else if (ratio >= 0.8) {
      // Normal volume — neutral
      score = 30 + (ratio - 0.8) * 50;
      reason = `Normal volume: ${ratio.toFixed(2)}x average. No strong confirmation.`;
    } else {
      // Below-average volume — weak
      score = ratio * 37;
      reason = `Below-average volume: ${ratio.toFixed(2)}x average. Weak participation.`;
    }

    const confidence =
      ratio >= 1.3 ? Math.min(0.85, 0.5 + (ratio - 1) * 0.3) : 0.4;

    return {
      score: Math.max(0, Math.min(this.maxScore, Math.round(score))),
      confidence: Number(confidence.toFixed(2)),
      reason,
      // 2026-08-14: volume magnitude is direction-neutral — this directive does NOT
      // check bar direction (close vs open), so high volume ≠ bullish and low volume ≠ bearish.
      // Declared directionBias='neutral'; signalClass must match.
      signalClass: 'neutral',
    };
  }
}
