/**
 * Multi-Timeframe Trend Alignment
 * =================================
 * Scores trend alignment across daily, hourly, and 15-minute timeframes.
 *
 * Thesis: Higher timeframes define bias; lower timeframes define entry timing.
 * A speed trading entry is highest-probability when all timeframes point the
 * same direction.
 *
 * Trend detection uses EMA alignment (9 > 21 > 50), ADX strength,
 * and VWAP position on each timeframe.
 *
 * maxScore: 120 — strong alignment provides high confidence for entries.
 *
 * @see docs/theories/multi-timeframe-speed-trading.md
 */

import { Injectable } from '@nestjs/common';
import {
  DirectiveInput,
  DirectiveResult,
  IDirective,
  MarketBar,
} from '../interfaces/directive.interface';

const ALIGNMENT_PERFECT = 120;
const ALIGNMENT_TWO_OF_THREE = 80;
const ALIGNMENT_WEAK = 40;
const ALIGNMENT_NONE = 0;

// Minimum bars required per timeframe for reliable EMA/ADX computation
const MIN_BARS = 20;

@Injectable()
export class MultiTimeframeTrendDirective implements IDirective {
  readonly id = 'multi-timeframe-trend';
  readonly name = 'Multi-Timeframe Trend Alignment';
  readonly description =
    'Scores trend alignment across daily, hourly, and 15M timeframes using EMA structure, ADX strength, and VWAP position. Higher confidence when all timeframes agree.';
  readonly priority = 80;
  readonly maxScore = 120;
  readonly minBars = { '1d': 20, '1h': 20, '15m': 20 };
  readonly version = '1.0.0';

  calculate(input: DirectiveInput): DirectiveResult {
    const { dayBars, hourBars, min15Bars } = input;

    // Score each timeframe independently
    const dayTrend = this.analyzeTrend(dayBars, '1D');
    const hourTrend = this.analyzeTrend(hourBars, '1H');
    const min15Trend = this.analyzeTrend(min15Bars, '15M');

    const availableCount = [dayTrend, hourTrend, min15Trend].filter(
      (t) => t.available,
    ).length;

    if (availableCount === 0) {
      return {
        score: 0,
        confidence: 0,
        reason:
          'Insufficient higher-timeframe data. Need dayBars, hourBars, or min15Bars on DirectiveInput.',
        signalClass: 'neutral',
      };
    }

    // Count aligned directions
    const bullishCount = [dayTrend, hourTrend, min15Trend].filter(
      (t) => t.available && t.direction === 'bullish',
    ).length;
    const bearishCount = [dayTrend, hourTrend, min15Trend].filter(
      (t) => t.available && t.direction === 'bearish',
    ).length;
    const totalAvailable = availableCount;

    // Determine alignment quality
    let alignmentScore: number;
    let alignmentLabel: string;

    if (totalAvailable >= 3 && bullishCount === 3) {
      alignmentScore = ALIGNMENT_PERFECT;
      alignmentLabel = 'Perfect bullish — all timeframes aligned up';
    } else if (totalAvailable >= 3 && bearishCount === 3) {
      alignmentScore = ALIGNMENT_PERFECT;
      alignmentLabel = 'Perfect bearish — all timeframes aligned down';
    } else if (bullishCount >= 2 && bearishCount === 0) {
      alignmentScore = ALIGNMENT_TWO_OF_THREE;
      alignmentLabel = `${bullishCount}/${totalAvailable} bullish — partial alignment`;
    } else if (bearishCount >= 2 && bullishCount === 0) {
      alignmentScore = ALIGNMENT_TWO_OF_THREE;
      alignmentLabel = `${bearishCount}/${totalAvailable} bearish — partial alignment`;
    } else if (bullishCount >= 2) {
      // Bullish majority with some bearish
      alignmentScore = Math.round(
        ALIGNMENT_WEAK + (bullishCount / totalAvailable) * 30,
      );
      alignmentLabel = `Mixed — ${bullishCount}B/${bearishCount}S`;
    } else if (bearishCount >= 2) {
      alignmentScore = Math.round(
        ALIGNMENT_WEAK + (bearishCount / totalAvailable) * 30,
      );
      alignmentLabel = `Mixed — ${bearishCount}S/${bullishCount}B`;
    } else {
      alignmentScore = ALIGNMENT_NONE;
      alignmentLabel = 'No alignment — conflicting signals';
    }

    // ADX strength bonus: strong trends deserve higher conviction
    const avgAdx =
      [dayTrend, hourTrend, min15Trend]
        .filter((t) => t.available && t.adx != null)
        .reduce((sum, t) => sum + (t.adx ?? 0), 0) /
      Math.max(1, availableCount);

    const adxBonus = Math.min(15, Math.max(0, (avgAdx - 20) * 0.75));
    const finalScore = Math.min(
      this.maxScore,
      Math.round(alignmentScore + adxBonus),
    );

    // Determine overall direction
    const netDirection =
      bullishCount > bearishCount
        ? 'bullish'
        : bearishCount > bullishCount
          ? 'bearish'
          : 'neutral';

    // Confidence based on alignment strength and ADX
    const confidence = Math.min(
      0.95,
      alignmentScore / this.maxScore + (avgAdx > 25 ? 0.1 : 0),
    );

    const details = [
      dayTrend.available
        ? `1D: ${dayTrend.direction}${dayTrend.strengthLabel ? ` (${dayTrend.strengthLabel})` : ''}`
        : '1D: N/A',
      hourTrend.available
        ? `1H: ${hourTrend.direction}${hourTrend.strengthLabel ? ` (${hourTrend.strengthLabel})` : ''}`
        : '1H: N/A',
      min15Trend.available
        ? `15M: ${min15Trend.direction}${min15Trend.strengthLabel ? ` (${min15Trend.strengthLabel})` : ''}`
        : '15M: N/A',
    ].join(' | ');

    return {
      score: finalScore,
      confidence: Number(confidence.toFixed(2)),
      reason: `${alignmentLabel}. ADX avg: ${avgAdx.toFixed(0)}. ${details}`,
      signalClass: netDirection,
    };
  }

  /**
   * Analyze trend direction for a single timeframe.
   * Uses EMA 9/21/50 alignment, ADX, and VWAP position.
   */
  private analyzeTrend(
    bars: MarketBar[] | undefined,
    label: string,
  ): TrendAnalysis {
    if (!bars || bars.length < MIN_BARS) {
      return {
        available: false,
        direction: 'neutral',
        strengthLabel: null,
        adx: null,
      };
    }

    const closes = bars.map((b) => b.close);
    const highs = bars.map((b) => b.high);
    const lows = bars.map((b) => b.low);
    const volumes = bars.map((b) => b.volume);

    // EMA alignment
    const ema9 = this.ema(closes, 9);
    const ema21 = this.ema(closes, 21);
    const ema50 = this.ema(closes, 50);

    const ema9Last = ema9[ema9.length - 1];
    const ema21Last = ema21[ema21.length - 1];
    const ema50Last = ema50[ema50.length - 1];

    const emaAligned =
      ema9Last != null && ema21Last != null && ema50Last != null;
    const bullishEma =
      emaAligned && ema9Last! > ema21Last! && ema21Last! > ema50Last!;
    const bearishEma =
      emaAligned && ema9Last! < ema21Last! && ema21Last! < ema50Last!;

    // ADX
    const adx = this.adx(highs, lows, closes, 14);

    // VWAP
    const vwapVals = this.vwap(highs, lows, closes, volumes);
    const lastClose = closes[closes.length - 1];
    const lastVwap = vwapVals[vwapVals.length - 1];
    const aboveVwap = lastVwap != null && lastClose > lastVwap;

    // Price vs EMA 50 (long-term bias)
    const aboveEma50 = ema50Last != null && lastClose > ema50Last;

    // Determine direction
    let direction: 'bullish' | 'bearish' | 'neutral';
    let strengthLabel: string | null = null;

    if (bullishEma && aboveVwap && aboveEma50) {
      direction = 'bullish';
      strengthLabel = adx > 25 ? 'strong' : adx > 20 ? 'moderate' : 'weak';
    } else if (bearishEma && !aboveVwap && !aboveEma50) {
      direction = 'bearish';
      strengthLabel = adx > 25 ? 'strong' : adx > 20 ? 'moderate' : 'weak';
    } else if (bullishEma || (aboveVwap && aboveEma50)) {
      direction = 'bullish';
      strengthLabel = 'weak';
    } else if (bearishEma || (!aboveVwap && !aboveEma50)) {
      direction = 'bearish';
      strengthLabel = 'weak';
    } else {
      direction = 'neutral';
    }

    return {
      available: true,
      direction,
      strengthLabel,
      adx,
    };
  }

  // ── Indicator helpers (self-contained, no external deps) ──

  private ema(values: number[], period: number): (number | null)[] {
    const result: (number | null)[] = new Array(values.length).fill(null);
    if (values.length < period) return result;

    const k = 2 / (period + 1);
    let ema = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
    result[period - 1] = ema;

    for (let i = period; i < values.length; i++) {
      ema = values[i] * k + ema * (1 - k);
      result[i] = ema;
    }
    return result;
  }

  private adx(
    highs: number[],
    lows: number[],
    closes: number[],
    period: number,
  ): number {
    if (highs.length < period + 1) return 0;

    const tr: number[] = [];
    const plusDm: number[] = [];
    const minusDm: number[] = [];

    for (let i = 1; i < highs.length; i++) {
      const hDiff = highs[i] - highs[i - 1];
      const lDiff = lows[i - 1] - lows[i];
      tr.push(
        Math.max(
          highs[i] - lows[i],
          Math.abs(highs[i] - closes[i - 1]),
          Math.abs(lows[i] - closes[i - 1]),
        ),
      );
      plusDm.push(hDiff > lDiff && hDiff > 0 ? hDiff : 0);
      minusDm.push(lDiff > hDiff && lDiff > 0 ? lDiff : 0);
    }

    const atr = this.wilderSmooth(tr, period);
    const smoothedPlusDm = this.wilderSmooth(plusDm, period);
    const smoothedMinusDm = this.wilderSmooth(minusDm, period);

    const diPlus =
      atr[atr.length - 1] > 0
        ? (smoothedPlusDm[smoothedPlusDm.length - 1] / atr[atr.length - 1]) *
          100
        : 0;
    const diMinus =
      atr[atr.length - 1] > 0
        ? (smoothedMinusDm[smoothedMinusDm.length - 1] /
            atr[atr.length - 1]) *
          100
        : 0;

    const dx =
      diPlus + diMinus > 0
        ? (Math.abs(diPlus - diMinus) / (diPlus + diMinus)) * 100
        : 0;

    return dx;
  }

  private wilderSmooth(values: number[], period: number): number[] {
    const result = new Array(values.length).fill(0);
    if (values.length < period) return result;

    result[period - 1] = values.slice(0, period).reduce((a, b) => a + b, 0);
    for (let i = period; i < values.length; i++) {
      result[i] = result[i - 1] - result[i - 1] / period + values[i];
    }
    return result;
  }

  private vwap(
    highs: number[],
    lows: number[],
    closes: number[],
    volumes: number[],
  ): (number | null)[] {
    const result: (number | null)[] = [];
    let cumPv = 0;
    let cumV = 0;
    for (let i = 0; i < closes.length; i++) {
      const tp = (highs[i] + lows[i] + closes[i]) / 3;
      cumPv += tp * (volumes[i] || 0);
      cumV += volumes[i] || 0;
      result.push(cumV > 0 ? cumPv / cumV : null);
    }
    return result;
  }
}

interface TrendAnalysis {
  available: boolean;
  direction: 'bullish' | 'bearish' | 'neutral';
  strengthLabel: string | null;
  adx: number | null;
}
