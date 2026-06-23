/**
 * Condition Detector Service (Q301)
 * =================================
 * Runs pre-scoring to produce a ConditionVector — a snapshot of current
 * market conditions that activation gates use to decide which directives
 * should fire.
 *
 * Uses existing directive implementations where possible (adx, hurst-memory,
 * session-timing-filter) plus simple calculations for others.
 */

import { Injectable, Logger } from '@nestjs/common';
import { isScoringDemo } from '../../config/scoring-mode';
import {
  ConditionVector,
  DirectiveInput,
  TradingSession,
} from './interfaces/directive.interface';

/** Session timezone definitions (UTC hour ranges, Mon-Fri only). */
const SESSION_WINDOWS: Record<string, { start: number; end: number }> = {
  Asian: { start: 0, end: 9 }, // 00:00–09:00 UTC (Tokyo/HK/Sydney)
  London: { start: 7, end: 16 }, // 07:00–16:00 UTC
  US: { start: 13, end: 21 }, // 13:00–21:00 UTC (NYSE 9:30–16:00 ET = 13:30–20:00 UTC)
};

/** ATR percentile thresholds for volatility classification. */
const LOW_ATR_PCT = 0.25;
const HIGH_ATR_PCT = 0.75;

@Injectable()
export class ConditionDetectorService {
  private readonly logger = new Logger(ConditionDetectorService.name);

  /** Returns true when running in demo/paper trading mode. */
  private get isDemoMode(): boolean {
    return isScoringDemo();
  }

  /**
   * Produce a ConditionVector from market data.
   * Runs ADX, Hurst, and ATR calculations against the provided bars.
   */
  detect(input: DirectiveInput): ConditionVector {
    const bars = input.bars;
    if (bars.length < 20) {
      this.logger.warn(
        `ConditionDetector: insufficient bars (${bars.length}) for ${input.symbol} — returning defaults`,
      );
      return this.defaultVector();
    }

    const closes = bars.map((b: { close: number }) => b.close);
    const highs = bars.map((b: { high: number }) => b.high);
    const lows = bars.map((b: { low: number }) => b.low);

    // ── ADX (14-period) ──
    const adx = this.computeADX(highs, lows, closes, 14);

    // ── Hurst Exponent ──
    const hurst = this.computeHurst(closes.slice(-50));

    // ── ATR Percentile ──
    const atr14 = this.computeATR(highs, lows, closes, 14);
    const atrPercentile = this.computeATRPercentile(atr14, highs, lows, closes);

    // ── Ensemble regime score (Q303) ──
    // Weighted: 0.40 Hurst, 0.35 ADX, 0.25 Volatility
    const adxNormalized = Math.min(1, adx / 50); // 0–1 (ADX 50+ = strong trend)
    const volComponent = 1 - Math.abs(atrPercentile - 0.5) * 2; // 0–1 (extremes = chaotic)
    const ensembleScore =
      0.40 * hurst +
      0.35 * adxNormalized +
      0.25 * volComponent;

    // ── Regime classification ──
    const regime = this.classifyRegime(ensembleScore, adx);

    // ── Volatility level ──
    const volatility = this.classifyVolatility(atrPercentile);

    // ── Active session ──
    const activeSession = this.detectSession();

    // ── Pre-event check ──
    const preEvent = this.isPreEventWindow();

    return {
      regime,
      regimeStrength: Math.round(ensembleScore * 1000) / 1000,
      regimeComponents: {
        hurst: Math.round(hurst * 1000) / 1000,
        adx: Math.round(adxNormalized * 1000) / 1000,
        volatilityPercentile: Math.round(volComponent * 1000) / 1000,
      },
      hurstExponent: Math.round(hurst * 1000) / 1000,
      volatility,
      activeSession,
      adx: Math.round(adx * 100) / 100,
      atrPercentile: Math.round(atrPercentile * 100) / 100,
      preEvent,
      timestamp: new Date(),
    };
  }

  // ── Private helpers ──

  private defaultVector(): ConditionVector {
    // In demo/paper mode, default to trending so directives fire
    const demo = this.isDemoMode;

    return {
      regime: demo ? 'trending' : 'chaotic',
      regimeStrength: demo ? 0.70 : 0.35,
      regimeComponents: { hurst: 0.5, adx: 0.4, volatilityPercentile: 0.5 },
      hurstExponent: 0.5,
      volatility: 'normal',
      activeSession: this.detectSession(),
      adx: demo ? 35 : 20,
      atrPercentile: 0.5,
      preEvent: false,
      timestamp: new Date(),
    };
  }

  /** Q303 ensemble-based classification. */
  private classifyRegime(ensembleScore: number, _adx: number): 'trending' | 'ranging' | 'chaotic' {
    // In demo mode, be more permissive — let directives fire
    const demo = this.isDemoMode;
    const chaoticThreshold = demo ? 0.15 : 0.35;
    const trendingThreshold = demo ? 0.40 : 0.65;

    if (ensembleScore > trendingThreshold) return 'trending';
    if (ensembleScore < chaoticThreshold) return 'chaotic';
    return 'ranging';
  }

  /**
   * Check if we're within 30min of a major economic event.
   * Uses known schedule dates — can be extended with an economic calendar API.
   */
  private isPreEventWindow(): boolean {
    const now = new Date();
    // Known FOMC dates for 2026
    const events: { date: string; time: string; label: string }[] = [
      { date: '2026-06-17', time: '14:00', label: 'FOMC Decision' },
      { date: '2026-07-29', time: '14:00', label: 'FOMC Decision' },
      { date: '2026-09-17', time: '14:00', label: 'FOMC Decision' },
    ];

    for (const evt of events) {
      const eventDate = new Date(`${evt.date}T${evt.time}:00-04:00`); // US Eastern
      const diffMs = Math.abs(now.getTime() - eventDate.getTime());
      if (diffMs < 30 * 60 * 1000) return true;
    }
    return false;
  }

  private classifyVolatility(percentile: number): 'low' | 'normal' | 'high' {
    if (percentile < LOW_ATR_PCT) return 'low';
    if (percentile > HIGH_ATR_PCT) return 'high';
    return 'normal';
  }

  private detectSession(): TradingSession {
    const now = new Date();
    const day = now.getUTCDay();
    // Weekend = off-hours
    if (day === 0 || day === 6) return 'off-hours';

    const hour = now.getUTCHours();
    // Check sessions in priority order (overlap favors US > London > Asian)
    if (hour >= SESSION_WINDOWS.US.start && hour <= SESSION_WINDOWS.US.end) return 'US';
    if (hour >= SESSION_WINDOWS.London.start && hour <= SESSION_WINDOWS.London.end) return 'London';
    if (hour >= SESSION_WINDOWS.Asian.start && hour <= SESSION_WINDOWS.Asian.end) return 'Asian';
    return 'off-hours';
  }

  // ── Technical indicator calculations ──

  private computeADX(highs: number[], lows: number[], closes: number[], period: number): number {
    if (highs.length < period + 1) return 20;
    const tr: number[] = [];
    const plusDM: number[] = [];
    const minusDM: number[] = [];

    for (let i = 1; i < highs.length; i++) {
      const h = highs[i];
      const l = lows[i];
      const prevH = highs[i - 1];
      const prevL = lows[i - 1];
      const prevC = closes[i - 1];

      const trueRange = Math.max(
        h - l,
        Math.abs(h - prevC),
        Math.abs(l - prevC),
      );
      tr.push(trueRange);

      const upMove = h - prevH;
      const downMove = prevL - l;
      plusDM.push(upMove > downMove && upMove > 0 ? upMove : 0);
      minusDM.push(downMove > upMove && downMove > 0 ? downMove : 0);
    }

    // Wilder's smoothing for initial value
    const atr = this.wildersSmooth(tr, period);
    const plusDI = this.wildersSmooth(plusDM, period).map(
      (v, i) => atr[i] > 0 ? (v / atr[i]) * 100 : 0,
    );
    const minusDI = this.wildersSmooth(minusDM, period).map(
      (v, i) => atr[i] > 0 ? (v / atr[i]) * 100 : 0,
    );

    const dx: number[] = [];
    for (let i = 0; i < plusDI.length; i++) {
      const sum = plusDI[i] + minusDI[i];
      dx.push(sum > 0 ? (Math.abs(plusDI[i] - minusDI[i]) / sum) * 100 : 0);
    }

    // ADX = smoothed DX
    let adxSum = 0;
    const adxLen = Math.min(period, dx.length);
    for (let i = dx.length - adxLen; i < dx.length; i++) {
      adxSum += dx[i];
    }
    return adxLen > 0 ? adxSum / adxLen : 20;
  }

  private wildersSmooth(values: number[], period: number): number[] {
    if (values.length < period) return values;
    const result: number[] = [];
    // Initial value = simple average
    let sum = 0;
    for (let i = 0; i < period; i++) sum += values[i];
    result.push(sum / period);
    // Wilder's smoothing: EMA with alpha = 1/period
    for (let i = period; i < values.length; i++) {
      result.push(result[result.length - 1] + (values[i] - result[result.length - 1]) / period);
    }
    return result;
  }

  /** Simplified R/S Hurst exponent (0–1). >0.6 = trending, <0.4 = mean-reverting. */
  private computeHurst(closes: number[]): number {
    if (closes.length < 30) return 0.5;
    const returns: number[] = [];
    for (let i = 1; i < closes.length; i++) {
      if (closes[i - 1] > 0) returns.push(closes[i] / closes[i - 1] - 1);
    }
    if (returns.length < 20) return 0.5;

    // Simplified: use lag-1 autocorrelation as proxy for Hurst
    const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
    let num = 0, den = 0;
    for (let i = 0; i < returns.length; i++) {
      den += (returns[i] - mean) ** 2;
      if (i > 0) num += (returns[i] - mean) * (returns[i - 1] - mean);
    }
    if (den === 0) return 0.5;
    const rho = num / den;
    // Hurst = 0.5 + rho/2 (approximation for AR(1) process)
    return Math.max(0, Math.min(1, 0.5 + rho / 2));
  }

  private computeATR(
    highs: number[], lows: number[], closes: number[], period: number,
  ): number {
    if (highs.length < period + 1) return 0;
    const tr: number[] = [];
    for (let i = 1; i < highs.length; i++) {
      tr.push(Math.max(
        highs[i] - lows[i],
        Math.abs(highs[i] - closes[i - 1]),
        Math.abs(lows[i] - closes[i - 1]),
      ));
    }
    const smoothed = this.wildersSmooth(tr, period);
    return smoothed[smoothed.length - 1] ?? 0;
  }

  /** Approximate where current ATR falls in the 90-day distribution. */
  private computeATRPercentile(
    currentATR: number,
    highs: number[],
    lows: number[],
    closes: number[],
  ): number {
    if (currentATR <= 0 || closes.length < 15) return 0.5;
    // Compute rolling ATR(14) values over the last ~90 periods
    const atrValues: number[] = [];
    const window = 14;
    for (let i = window; i < closes.length; i++) {
      const hSlice = highs.slice(i - window, i + 1);
      const lSlice = lows.slice(i - window, i + 1);
      const cSlice = closes.slice(i - window, i + 1);
      const trSum = hSlice.reduce((s, h, j) => {
        const trVal = Math.max(
          h - lSlice[j],
          Math.abs(h - (cSlice[j - 1] ?? cSlice[j])),
          Math.abs(lSlice[j] - (cSlice[j - 1] ?? cSlice[j])),
        );
        return s + trVal;
      }, 0);
      atrValues.push(trSum / window);
    }
    if (atrValues.length < 5) return 0.5;
    const below = atrValues.filter((v) => v < currentATR).length;
    return below / atrValues.length;
  }
}
