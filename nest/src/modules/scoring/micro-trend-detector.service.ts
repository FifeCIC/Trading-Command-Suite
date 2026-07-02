import { Injectable, Logger } from '@nestjs/common';

/**
 * MicroTrendDetector — trend analysis for micro-timeframe bars (5s–1m).
 *
 * Computes:
 *   - ADX (Average Directional Index) on micro-timeframes
 *   - Directional persistence (consecutive same-direction candles)
 *   - Trend clarity classification (strong_up → strong_down)
 *   - Sideways market detection (doji clusters, inside bars, low ADX)
 *   - Pattern-based pause signals
 */
@Injectable()
export class MicroTrendDetector {
  private readonly logger = new Logger(MicroTrendDetector.name);

  /**
   * Full trend analysis of a candle series.
   */
  analyze(bars: CandleBar[], patterns?: PatternSignal[]): TrendAnalysis {
    if (!bars || bars.length < 5) {
      return this.emptyAnalysis();
    }

    const closes = bars.map((b) => b.close);
    const highs = bars.map((b) => b.high);
    const lows = bars.map((b) => b.low);

    // ── ADX (14-period, Wilder's smoothing) ──
    const adx = this.computeADX(highs, lows, closes, 14);

    // ── Directional persistence ──
    const persistence = this.computePersistence(bars);

    // ── Trend clarity ──
    const clarity = this.classifyTrendClarity(adx, persistence, bars);

    // ── Pattern signal aggregation ──
    const patternSignal = this.aggregatePatterns(patterns ?? []);

    // ── Sideways detection ──
    const sideways = this.detectSideways(bars, adx);

    // ── Recommendation ──
    const recommendation = this.computeRecommendation(clarity, patternSignal, sideways, adx);

    return {
      adx: Math.round(adx * 10) / 10,
      trendClarity: clarity.clarity,
      trendDirection: clarity.direction,
      trendStrength: Math.round(clarity.strength * 100) / 100,
      persistence: {
        consecutive: persistence.consecutive,
        direction: persistence.direction,
        count: persistence.count,
      },
      patternSignal: patternSignal.signal,
      patternCount: patternSignal.count,
      patternTypes: patternSignal.types,
      sideways,
      recommendation,
      noiseRatio: this.computeNoiseRatio(bars),
    };
  }

  /**
   * Compute ADX using Wilder's smoothing method.
   * Works on any timeframe — tested with 5s through 1d bars.
   */
  private computeADX(
    highs: number[],
    lows: number[],
    closes: number[],
    period: number,
  ): number {
    const n = highs.length;
    if (n < period + 1) return 20; // Default to neutral

    const tr: number[] = [];
    const plusDM: number[] = [];
    const minusDM: number[] = [];

    for (let i = 1; i < n; i++) {
      const h = highs[i];
      const l = lows[i];
      const prevH = highs[i - 1];
      const prevL = lows[i - 1];
      const prevC = closes[i - 1];

      // True Range
      tr.push(
        Math.max(h - l, Math.abs(h - prevC), Math.abs(l - prevC)),
      );

      // Directional Movement
      const upMove = h - prevH;
      const downMove = prevL - l;

      if (upMove > downMove && upMove > 0) {
        plusDM.push(upMove);
        minusDM.push(0);
      } else if (downMove > upMove && downMove > 0) {
        plusDM.push(0);
        minusDM.push(downMove);
      } else {
        plusDM.push(0);
        minusDM.push(0);
      }
    }

    // Wilder's smoothing (exponential-like with alpha = 1/period)
    const smoothedTR = this.wilderSmooth(tr, period);
    const smoothedPDM = this.wilderSmooth(plusDM, period);
    const smoothedMDM = this.wilderSmooth(minusDM, period);

    const dxValues: number[] = [];
    for (let i = 0; i < smoothedTR.length; i++) {
      const pdi = (smoothedPDM[i] / smoothedTR[i]) * 100;
      const mdi = (smoothedMDM[i] / smoothedTR[i]) * 100;
      const dx = Math.abs(pdi - mdi) / (pdi + mdi + 0.0001) * 100;
      dxValues.push(dx);
    }

    // ADX = smoothed DX
    const adxValues = this.wilderSmooth(dxValues, period);
    return adxValues[adxValues.length - 1] ?? 20;
  }

  /**
   * Wilder's smoothing: first value is simple average, subsequent use EMA-like.
   */
  private wilderSmooth(values: number[], period: number): number[] {
    if (values.length < period) return values;
    const result: number[] = [];

    // First value = simple average
    let sum = 0;
    for (let i = 0; i < period; i++) sum += values[i];
    result.push(sum / period);

    // Subsequent = (prev * (period-1) + current) / period
    for (let i = period; i < values.length; i++) {
      result.push((result[result.length - 1] * (period - 1) + values[i]) / period);
    }

    return result;
  }

  /**
   * Directional persistence — count of consecutive same-direction candles
   * and whether the recent candles show consistent direction.
   */
  private computePersistence(bars: CandleBar[]): {
    consecutive: number;
    direction: 'up' | 'down' | 'none';
    count: number;
  } {
    const recent = bars.slice(-8); // Look at last 8 candles
    let upCount = 0;
    let downCount = 0;
    let maxConsecutive = 0;
    let currentConsecutive = 0;
    let currentDir: 'up' | 'down' | null = null;

    for (let i = 0; i < recent.length; i++) {
      const dir = recent[i].close >= recent[i].open ? 'up' : 'down';
      if (dir === 'up') upCount++;
      else downCount++;

      if (dir === currentDir) {
        currentConsecutive++;
      } else {
        currentConsecutive = 1;
        currentDir = dir;
      }
      maxConsecutive = Math.max(maxConsecutive, currentConsecutive);
    }

    const dominantDir = upCount > downCount ? 'up' : downCount > upCount ? 'down' : 'none';

    return {
      consecutive: maxConsecutive,
      direction: dominantDir,
      count: recent.length,
    };
  }

  /**
   * Classify trend clarity from ADX, persistence, and price structure.
   */
  private classifyTrendClarity(
    adx: number,
    persistence: { consecutive: number; direction: string },
    bars: CandleBar[],
  ): { clarity: string; direction: string; strength: number } {
    const recent = bars.slice(-5);
    if (recent.length < 3) return { clarity: 'sideways', direction: 'none', strength: 0 };

    // Direction from price change over the window
    const firstClose = recent[0].close;
    const lastClose = recent[recent.length - 1].close;
    const changePct = ((lastClose - firstClose) / (firstClose || 0.0001)) * 100;

    const direction = changePct > 0.05 ? 'up' : changePct < -0.05 ? 'down' : 'none';

    // Clarity from ADX and persistence
    let clarity: string;
    if (adx > 40 && persistence.consecutive >= 4) clarity = 'strong';
    else if (adx > 25 && persistence.consecutive >= 3) clarity = 'moderate';
    else if (adx > 18 && persistence.consecutive >= 2) clarity = 'weak';
    else if (adx < 15) clarity = 'sideways';
    else clarity = 'weak';

    // Strength: normalized 0-1 from ADX (capped at 60)
    const strength = Math.min(1, adx / 60);

    return {
      clarity,
      direction: clarity === 'sideways' ? 'none' : direction,
      strength,
    };
  }

  /**
   * Aggregate candlestick pattern signals into a single directional signal.
   */
  private aggregatePatterns(patterns: PatternSignal[]): {
    signal: 'bullish' | 'bearish' | 'neutral' | 'none';
    count: number;
    types: string[];
  } {
    if (!patterns.length) return { signal: 'none', count: 0, types: [] };

    let bullish = 0;
    let bearish = 0;
    const types: string[] = [];

    for (const p of patterns) {
      types.push(p.type);
      if (p.signal === 'bullish') bullish++;
      else if (p.signal === 'bearish') bearish++;
    }

    const signal =
      bullish > bearish * 1.5 ? 'bullish' :
      bearish > bullish * 1.5 ? 'bearish' :
      'neutral';

    return { signal, count: patterns.length, types };
  }

  /**
   * Detect sideways/indecision market conditions.
   *
   * Criteria:
   *   - ADX < 18 → no trend
   *   - 2+ doji in last 5 candles → indecision
   *   - 3+ inside bars → compression
   *   - Noise ratio > 0.7 → choppy
   */
  private detectSideways(bars: CandleBar[], adx: number): SidewaysSignal {
    const recent = bars.slice(-8);
    if (recent.length < 3) return { active: false, severity: 0, reasons: [], dojiCount: 0, insideBarCount: 0 };

    const reasons: string[] = [];
    let severity = 0;

    // Low ADX
    if (adx < 18) {
      reasons.push(`Low ADX (${Math.round(adx)}) — no clear trend`);
      severity += 2;
    } else if (adx < 22) {
      reasons.push(`Weak ADX (${Math.round(adx)}) — marginal trend`);
      severity += 1;
    }

    // Doji clusters
    let dojiCount = 0;
    let insideBarCount = 0;
    for (const bar of recent) {
      const body = Math.abs(bar.close - bar.open);
      const range = bar.high - bar.low;
      if (range > 0 && body / range < 0.1) dojiCount++;
      if (bar.high < (bars[bars.indexOf(bar) - 1]?.high ?? Infinity) &&
          bar.low > (bars[bars.indexOf(bar) - 1]?.low ?? -Infinity)) {
        insideBarCount++;
      }
    }

    if (dojiCount >= 2) {
      reasons.push(`${dojiCount} dojis in last ${recent.length} candles — indecision`);
      severity += 2;
    }

    if (insideBarCount >= 3) {
      reasons.push(`${insideBarCount} inside bars — price compression`);
      severity += 2;
    }

    // Noise ratio
    const noise = this.computeNoiseRatio(bars);
    if (noise > 0.7) {
      reasons.push(`High noise ratio (${(noise * 100).toFixed(0)}%) — choppy market`);
      severity += 1;
    }

    return {
      active: severity >= 3,
      severity, // 0-7 scale
      reasons,
      dojiCount,
      insideBarCount,
    };
  }

  /**
   * Compute noise ratio: what portion of price movement is "noise" vs "signal".
   * High noise = lots of wick relative to body = indecision.
   */
  private computeNoiseRatio(bars: CandleBar[]): number {
    if (bars.length < 3) return 0.5;

    let totalBody = 0;
    let totalWick = 0;

    for (const bar of bars) {
      const body = Math.abs(bar.close - bar.open);
      const upperWick = bar.high - Math.max(bar.open, bar.close);
      const lowerWick = Math.min(bar.open, bar.close) - bar.low;
      totalBody += body;
      totalWick += upperWick + lowerWick;
    }

    const total = totalBody + totalWick;
    return total > 0 ? totalWick / total : 0.5;
  }

  /**
   * Determine trading recommendation based on trend clarity, patterns, and sideways signals.
   */
  private computeRecommendation(
    clarity: { clarity: string; direction: string; strength: number },
    patternSignal: { signal: string },
    sideways: SidewaysSignal,
    adx: number,
  ): Recommendation {
    // Sideways = pause
    if (sideways.active && sideways.severity >= 4) {
      return {
        action: 'pause',
        reason: `Sideways market: ${sideways.reasons[0] ?? 'no clear trend'}`,
        confidence: sideways.severity / 7,
      };
    }

    // Strong trend + aligned patterns = trade
    if (
      (clarity.clarity === 'strong' || clarity.clarity === 'moderate') &&
      clarity.direction !== 'none' &&
      patternSignal.signal !== 'none'
    ) {
      const aligned =
        (clarity.direction === 'up' && patternSignal.signal === 'bullish') ||
        (clarity.direction === 'down' && patternSignal.signal === 'bearish');

      if (aligned) {
        return {
          action: 'trade',
          reason: `${clarity.clarity} ${clarity.direction} trend with ${patternSignal.signal} pattern confirmation (ADX ${Math.round(adx)})`,
          confidence: clarity.strength,
        };
      }

      // Strong trend but patterns diverge — still tradeable but lower confidence
      return {
        action: 'trade',
        reason: `${clarity.clarity} ${clarity.direction} trend (patterns neutral)`,
        confidence: clarity.strength * 0.7,
      };
    }

    // Weak trend = caution
    if (clarity.clarity === 'weak' || (clarity.clarity === 'moderate' && patternSignal.signal === 'none')) {
      return {
        action: 'caution',
        reason: `Weak trend (ADX ${Math.round(adx)}) — wait for confirmation`,
        confidence: 0.3,
      };
    }

    // Default = hold/wait
    return {
      action: 'pause',
      reason: 'No clear signal — wait for trend or pattern',
      confidence: 0,
    };
  }

  private emptyAnalysis(): TrendAnalysis {
    return {
      adx: 0,
      trendClarity: 'sideways',
      trendDirection: 'none',
      trendStrength: 0,
      persistence: { consecutive: 0, direction: 'none', count: 0 },
      patternSignal: 'none',
      patternCount: 0,
      patternTypes: [],
      sideways: { active: false, severity: 0, reasons: [], dojiCount: 0, insideBarCount: 0 },
      recommendation: { action: 'pause', reason: 'Insufficient data', confidence: 0 },
      noiseRatio: 0.5,
    };
  }
}

// ── Types ─────────────────────────────────────────────────

export interface CandleBar {
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
  timestamp?: Date | string;
}

export interface PatternSignal {
  type: string;
  signal: 'bullish' | 'bearish' | 'neutral';
  confidence: number;
  index: number;
}

export interface TrendAnalysis {
  adx: number;
  trendClarity: string;       // strong | moderate | weak | sideways
  trendDirection: string;     // up | down | none
  trendStrength: number;      // 0–1
  persistence: {
    consecutive: number;
    direction: 'up' | 'down' | 'none';
    count: number;
  };
  patternSignal: string;      // bullish | bearish | neutral | none
  patternCount: number;
  patternTypes: string[];
  sideways: SidewaysSignal;
  recommendation: Recommendation;
  noiseRatio: number;         // 0–1 (0 = clean trend, 1 = pure noise)
}

export interface SidewaysSignal {
  active: boolean;
  severity: number;           // 0–7
  reasons: string[];
  dojiCount: number;
  insideBarCount: number;
}

export interface Recommendation {
  action: 'trade' | 'caution' | 'pause';
  reason: string;
  confidence: number;         // 0–1
}
