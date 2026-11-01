/**
 * VWAP Confluence — Simple AND-Gate & Full Bands
 * ===============================================
 *
 * TWO MODES (controlled by constructor param, both registered as separate directives):
 *
 * 1. SIMPLE (mode='simple'): Price near VWAP + RSI confirming + Volume elevated = BUY.
 *    Prop-firm staple. Quick mean-reversion signal at institutional reference level.
 *
 * 2. BANDS (mode='bands'): VWAP ±1σ/±2σ standard deviation bands.
 *    Price in -2σ zone = deep discount (strong buy).
 *    Price in +2σ zone = overextended (sell/short).
 *    Bands computed from VWAP deviation history for precision entries.
 *
 * Both modes internally compute VWAP, RSI, and volume to avoid circular
 * dependencies between directives.
 */

import { Injectable } from '@nestjs/common';
import {
  DirectiveInput,
  DirectiveResult,
  IDirective,
} from '../interfaces/directive.interface';
import { rsi, sma } from '../utils/indicators';
import { resolveParams, type NumericParamSpec } from '../parameters';

const RSI_PERIOD = 14;
const VOL_PERIOD = 20;
const MIN_BARS = Math.max(RSI_PERIOD, VOL_PERIOD) + 5;

/**
 * Tunable knobs, SHARED by both classes in this file (#1165). Defaults ARE the constants above —
 * BASELINE proves the equality for both.
 *
 * ⚠️ These two knobs are defined ONCE and read by `VwapConfluenceSimpleDirective` and
 * `VwapConfluenceBandsDirective`, because they always carried the same constants and a divergence
 * between the two would be a bug nobody would notice — the two variants differ in how they SCORE a
 * confluence, not in what they measure. Declaring the spec once makes that explicit.
 *
 * Measured 2026-11-01: the RSI period is one of the three confluence conditions, so a 7-period RSI
 * satisfies it at different bars from a 14-period one; the volume period sets the "is this volume
 * significant" baseline the confluence is judged against.
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
    why: 'Measured 2026-11-01 (#1166 method): RSI is one of the confluence conditions, so its period decides on which bars that condition is satisfied — a shorter period crosses the level sooner and more often.',
    source: 'vwap-confluence.directive.ts:27 RSI_PERIOD',
  },
  {
    key: 'volPeriod',
    label: 'Volume baseline period',
    type: 'number',
    default: VOL_PERIOD,
    min: 3,
    max: 80,
    step: 1,
    unit: 'bars',
    chart: 'series',
    why: 'Measured 2026-11-01: "volume above its baseline" is the second confluence condition, and this period IS the baseline. A 20-bar baseline on a 15m chart is five hours; on a daily chart it is a month.',
    source: 'vwap-confluence.directive.ts:28 VOL_PERIOD',
  },
];

/** Cumulative VWAP from highs, lows, closes, volumes */
function computeVwap(highs: number[], lows: number[], closes: number[], volumes: number[]): number {
  let cumTpVol = 0;
  let cumVol = 0;
  for (let i = 0; i < closes.length; i++) {
    const tp = (highs[i] + lows[i] + closes[i]) / 3;
    cumTpVol += tp * volumes[i];
    cumVol += volumes[i];
  }
  return cumVol === 0 ? closes[closes.length - 1] : cumTpVol / cumVol;
}

/** Standard deviation of price deviations from VWAP */
function computeVwapStdDev(highs: number[], lows: number[], closes: number[], volumes: number[], vwap: number): number {
  const deviations: number[] = [];
  for (let i = 0; i < closes.length; i++) {
    const tp = (highs[i] + lows[i] + closes[i]) / 3;
    deviations.push(tp - vwap);
  }
  const mean = deviations.reduce((a, b) => a + b, 0) / deviations.length;
  const variance = deviations.reduce((sum, d) => sum + (d - mean) ** 2, 0) / deviations.length;
  return Math.sqrt(variance);
}

export type VwapMode = 'simple' | 'bands';

@Injectable()
export class VwapConfluenceSimpleDirective implements IDirective {
  readonly id = 'vwap-confluence-simple';
  readonly name = 'VWAP Confluence (Simple AND-Gate)';
  readonly category = 'oscillator' as const;
  readonly description =
    'Price at VWAP + RSI confirming + volume elevated = high-confidence mean-reversion entry. Prop-firm staple.';
  readonly priority = 78;
  readonly maxScore = 105;
  readonly minScore = 1;
  readonly minBars = { '1d': 5 };
  readonly version = '1.1.0';
  readonly readiness = 'ready' as const;
  readonly directionBias = 'neutral' as const;
  readonly params = PARAMS;

  calculate(input: DirectiveInput): DirectiveResult {
    const { values } = resolveParams(this.id, this.params, input.params);
    const rsiPeriod = values.rsiPeriod as number;
    const volPeriod = values.volPeriod as number;

    const closes = input.bars.map((b) => b.close);
    const highs = input.bars.map((b) => b.high);
    const lows = input.bars.map((b) => b.low);
    const volumes = input.bars.map((b) => b.volume);

    const requiredBars = Math.max(MIN_BARS, Math.max(rsiPeriod, volPeriod) + 5);
    if (closes.length < requiredBars) {
      return { score: 0, confidence: 0.1, reason: `Need ${requiredBars} bars, have ${closes.length}.`, signalClass: 'neutral' };
    }

    const lastClose = closes[closes.length - 1];
    const vwapVal = computeVwap(highs, lows, closes, volumes);
    const distPct = ((lastClose - vwapVal) / vwapVal) * 100;

    // ── VWAP proximity check ──
    const vwapProximity = Math.abs(distPct) < 0.5; // Within 0.5% of VWAP
    const vwapNearness = Math.max(0, 1 - Math.abs(distPct) / 2); // 0-2% → 1-0

    // ── RSI check ──
    const rsiValues = rsi(closes, rsiPeriod);
    const lastRsi = rsiValues.length > 0 ? rsiValues[rsiValues.length - 1] : 50;
    const rsiOk = lastRsi > 40 && lastRsi < 65; // Not oversold, not overbought — "just right"
    const rsiScore = lastRsi > 35 && lastRsi < 60 ? 1 : Math.max(0, 1 - Math.abs(lastRsi - 47) / 30);

    // ── Volume check ──
    const recentVols = volumes.slice(-volPeriod);
    const avgVol = recentVols.reduce((a, b) => a + b, 0) / recentVols.length;
    const lastVol = volumes[volumes.length - 1];
    const volRatio = avgVol > 0 ? lastVol / avgVol : 1;
    const volScore = Math.min(1, volRatio / 1.5); // 1.5x avg = full score

    // ── AND-gate: all 3 must confirm ──
    const allConfirm = vwapProximity && rsiOk && volRatio > 0.8;

    if (allConfirm) {
      const strength = (vwapNearness * 0.35 + rsiScore * 0.35 + volScore * 0.30);
      // Price below VWAP = better buy (discount)
      const discountBonus = distPct < 0 ? Math.min(15, Math.abs(distPct) * 5) : 0;
      const score = 60 + strength * 30 + discountBonus;
      return {
        score: Math.round(Math.min(score, this.maxScore)),
        confidence: Math.min(0.90, 0.55 + strength * 0.30),
        reason: `VWAP confluence CONFIRMED: price ${distPct > 0 ? '+' : ''}${distPct.toFixed(2)}% from VWAP, RSI ${lastRsi.toFixed(0)}, vol ${volRatio.toFixed(1)}x avg. ${discountBonus > 0 ? 'Discount bonus applied.' : ''}`,
        signalClass: 'bullish',
      };
    }

    // Partial confirmation — proportional score
    const partialScore = (vwapNearness * 15 + (rsiOk ? 15 : rsiScore * 10) + volScore * 10);
    const missing: string[] = [];
    if (!vwapProximity) missing.push(`VWAP distance ${distPct.toFixed(1)}%`);
    if (!rsiOk) missing.push(`RSI ${lastRsi.toFixed(0)}`);
    if (volRatio < 0.8) missing.push(`volume ${volRatio.toFixed(1)}x`);

    return {
      score: Math.round(partialScore),
      confidence: 0.3,
      reason: `VWAP confluence NOT met: ${missing.join(', ')}.`,
      signalClass: 'neutral',
    };
  }
}

// ── BANDS VARIANT ──

@Injectable()
export class VwapConfluenceBandsDirective implements IDirective {
  readonly id = 'vwap-confluence-bands';
  readonly name = 'VWAP Confluence (Full Bands)';
  readonly description =
    'VWAP ±1σ/±2σ standard deviation bands. Price in -2σ zone = deep discount (strong buy). Price in +2σ zone = overextended (bearish). Precision entries at institutional levels.';
  readonly priority = 76;
  readonly maxScore = 110;
  readonly version = '1.1.0';
  readonly readiness = 'ready' as const;
  readonly directionBias = 'neutral' as const;
  readonly params = PARAMS;

  calculate(input: DirectiveInput): DirectiveResult {
    const { values } = resolveParams(this.id, this.params, input.params);
    const rsiPeriod = values.rsiPeriod as number;
    const volPeriod = values.volPeriod as number;

    const closes = input.bars.map((b) => b.close);
    const highs = input.bars.map((b) => b.high);
    const lows = input.bars.map((b) => b.low);
    const volumes = input.bars.map((b) => b.volume);

    const requiredBars = Math.max(MIN_BARS, Math.max(rsiPeriod, volPeriod) + 5);
    if (closes.length < requiredBars) {
      return { score: 0, confidence: 0.1, reason: `Need ${requiredBars} bars, have ${closes.length}.`, signalClass: 'neutral' };
    }

    const lastClose = closes[closes.length - 1];
    const vwapVal = computeVwap(highs, lows, closes, volumes);
    const sigma = computeVwapStdDev(highs, lows, closes, volumes, vwapVal);

    if (sigma === 0) {
      return { score: 25, confidence: 0.2, reason: 'Zero VWAP deviation — no band structure.', signalClass: 'neutral' };
    }

    const deviation = (lastClose - vwapVal) / sigma; // How many σ from VWAP

    // ── RSI confirmation ──
    const rsiValues = rsi(closes, rsiPeriod);
    const lastRsi = rsiValues.length > 0 ? rsiValues[rsiValues.length - 1] : 50;

    if (deviation <= -2.0) {
      // Deep discount — strong buy zone (-2σ or lower)
      const depth = Math.min(1, Math.abs(deviation + 2) / 2); // -2σ to -4σ
      const rsiConfirm = lastRsi < 40 ? 1.0 : lastRsi < 55 ? 0.7 : 0.4;
      const score = 75 + depth * 25 * rsiConfirm;
      return {
        score: Math.round(Math.min(score, this.maxScore)),
        confidence: Math.min(0.93, 0.6 + depth * 0.25),
        reason: `VWAP deep discount: ${deviation.toFixed(1)}σ below VWAP ($${vwapVal.toFixed(2)}). -2σ band entry zone. RSI=${lastRsi.toFixed(0)}.`,
        signalClass: 'bullish',
      };
    }

    if (deviation <= -1.0) {
      // Moderate discount — buy zone (-1σ to -2σ)
      const proximity = (Math.abs(deviation) - 1);
      const score = 55 + proximity * 20;
      return {
        score: Math.round(Math.min(score, this.maxScore)),
        confidence: Math.min(0.85, 0.5 + proximity * 0.3),
        reason: `VWAP discount: ${deviation.toFixed(1)}σ below VWAP ($${vwapVal.toFixed(2)}). -1σ band.`,
        signalClass: 'bullish',
      };
    }

    if (deviation >= 2.0) {
      // Overextended — bearish (+2σ or higher)
      return {
        score: 8,
        confidence: 0.8,
        reason: `VWAP overextended: ${deviation.toFixed(1)}σ above VWAP ($${vwapVal.toFixed(2)}). +2σ band — overbought.`,
        signalClass: 'bearish',
      };
    }

    if (deviation >= 1.0) {
      // Above +1σ — caution
      return {
        score: 18,
        confidence: 0.5,
        reason: `VWAP elevated: ${deviation.toFixed(1)}σ above VWAP ($${vwapVal.toFixed(2)}). +1σ band.`,
        signalClass: 'neutral',
      };
    }

    // Within ±1σ — neutral zone
    return {
      score: 30,
      confidence: 0.35,
      reason: `VWAP neutral: ${deviation.toFixed(1)}σ from VWAP ($${vwapVal.toFixed(2)}). Within ±1σ band.`,
      signalClass: 'neutral',
    };
  }
}
