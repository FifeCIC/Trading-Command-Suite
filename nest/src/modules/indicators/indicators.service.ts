import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';

export interface OhlcvBar {
  timestamp: Date;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface SupportResistanceLevels {
  symbol: string;
  timeframe: string;
  pivot: number;
  r1: number; r2: number; r3: number;
  s1: number; s2: number; s3: number;
  roundLevels: number[];
  ma20: number | null;
  ma50: number | null;
  currentPrice: number;
}

export interface VolatilityMetrics {
  symbol: string;
  timeframe: string;
  atr: number | null;
  bollingerWidth: number | null;
  historicalVol: number | null;
  volPercentile: number | null;
}

export interface IndicatorResult {
  symbol: string;
  timeframe: string;
  name: string;
  values: number[];
  currentValue: number | null;
}

@Injectable()
export class IndicatorsService {
  constructor(private readonly prisma: PrismaService) {}

  // ── Data fetching ──────────────────────────────────────

  async getBars(symbol: string, timeframe: string, limit = 200): Promise<OhlcvBar[]> {
    const sym = await this.prisma.symbol.findUnique({ where: { ticker: symbol } });
    if (!sym) return [];

    const bars = await this.prisma.marketBar.findMany({
      where: { symbolId: sym.id, timeframe },
      orderBy: { timestamp: 'asc' },
      take: limit,
      select: { timestamp: true, open: true, high: true, low: true, close: true, volume: true },
    });
    return bars;
  }

  // ── Support & Resistance ───────────────────────────────

  computeSupportResistance(bars: OhlcvBar[], symbol: string, timeframe: string): SupportResistanceLevels {
    if (bars.length === 0) return this.emptySrLevels(symbol, timeframe);

    const last = bars[bars.length - 1];
    const currentPrice = last.close;

    // Pivot point from last complete bar
    const prev = bars.length > 1 ? bars[bars.length - 2] : last;
    const pivot = (prev.high + prev.low + prev.close) / 3;
    const range = prev.high - prev.low;

    const r1 = 2 * pivot - prev.low;
    const r2 = pivot + range;
    const r3 = prev.high + 2 * (pivot - prev.low);
    const s1 = 2 * pivot - prev.high;
    const s2 = pivot - range;
    const s3 = prev.low - 2 * (prev.high - pivot);

    // Round number levels
    const roundBase = Math.round(pivot / 5) * 5;
    const roundLevels = Array.from({ length: 5 }, (_, i) => roundBase + (i - 2) * 5);

    // Moving averages
    const closes = bars.map((b) => b.close);
    const ma20 = closes.length >= 20 ? this.sma(closes.slice(-20)) : null;
    const ma50 = closes.length >= 50 ? this.sma(closes.slice(-50)) : null;

    return {
      symbol, timeframe,
      pivot: +pivot.toFixed(2),
      r1: +r1.toFixed(2), r2: +r2.toFixed(2), r3: +r3.toFixed(2),
      s1: +s1.toFixed(2), s2: +s2.toFixed(2), s3: +s3.toFixed(2),
      roundLevels,
      ma20, ma50,
      currentPrice,
    };
  }

  // ── Volatility ─────────────────────────────────────────

  computeVolatility(bars: OhlcvBar[], symbol: string, timeframe: string): VolatilityMetrics {
    if (bars.length < 20) return { symbol, timeframe, atr: null, bollingerWidth: null, historicalVol: null, volPercentile: null };

    const closes = bars.map((b) => b.close);

    // ATR (14)
    const atr = this.atr(bars, 14);

    // Bollinger Bands width (20,2)
    const sma20 = this.sma(closes.slice(-20));
    const std20 = this.stdDev(closes.slice(-20), sma20);
    const upperBand = sma20 + 2 * std20;
    const lowerBand = sma20 - 2 * std20;
    const bollingerWidth = +(upperBand - lowerBand).toFixed(2);

    // Historical volatility (std dev of log returns, annualized)
    const returns = [];
    for (let i = 1; i < closes.length; i++) {
      returns.push(Math.log(closes[i] / closes[i - 1]));
    }
    const avgReturn = returns.reduce((a, v) => a + v, 0) / returns.length;
    const varReturn = returns.reduce((a, v) => a + (v - avgReturn) ** 2, 0) / returns.length;
    const dailyVol = Math.sqrt(varReturn);
    const historicalVol = +(dailyVol * Math.sqrt(252) * 100).toFixed(1);

    // Vol percentile (simple: where current ATR sits in range of last 50 ATRs)
    let volPercentile: number | null = null;
    if (bars.length >= 50) {
      const atrs: number[] = [];
      for (let i = 13; i < bars.length; i++) {
        atrs.push(this.atr(bars.slice(Math.max(0, i - 14), i + 1), 14) ?? 0);
      }
      const sortedAtrs = atrs.sort((a, b) => a - b);
      const currentAtr = atr ?? 0;
      const rank = sortedAtrs.filter((v) => v < currentAtr).length;
      volPercentile = +((rank / sortedAtrs.length) * 100).toFixed(0);
    }

    return {
      symbol, timeframe,
      atr: atr !== null ? +atr.toFixed(3) : null,
      bollingerWidth,
      historicalVol,
      volPercentile,
    };
  }

  // ── Individual indicators ──────────────────────────────

  computeIndicator(bars: OhlcvBar[], name: string, period: number, symbol: string, timeframe: string): IndicatorResult {
    const closes = bars.map((b) => b.close);
    let values: number[] = [];
    let currentValue: number | null = null;

    switch (name) {
      case 'rsi': {
        values = this.rsi(closes, period || 14);
        break;
      }
      case 'macd': {
        const result = this.macd(closes);
        values = result.macdLine;
        break;
      }
      case 'sma': {
        values = this.smaSeries(closes, period || 20);
        break;
      }
      case 'ema': {
        values = this.emaSeries(closes, period || 20);
        break;
      }
      case 'atr': {
        values = this.atrSeries(bars, period || 14);
        break;
      }
      case 'adx': {
        values = this.adx(bars, period || 14);
        break;
      }
      case 'cci': {
        values = this.cci(bars, period || 20);
        break;
      }
      case 'mfi': {
        values = this.mfi(bars, period || 14);
        break;
      }
      default:
        values = [];
    }

    currentValue = values.length > 0 ? +values[values.length - 1].toFixed(2) : null;
    return { symbol, timeframe, name: name.toUpperCase(), values, currentValue };
  }

  // ── Correlation ────────────────────────────────────────

  computeCorrelation(barsA: OhlcvBar[], barsB: OhlcvBar[]): number | null {
    const minLen = Math.min(barsA.length, barsB.length);
    if (minLen < 5) return null;

    const returnsA = [];
    const returnsB = [];
    for (let i = 1; i < minLen; i++) {
      returnsA.push(Math.log(barsA[i].close / barsA[i - 1].close));
      returnsB.push(Math.log(barsB[i].close / barsB[i - 1].close));
    }

    return this.pearsonCorrelation(returnsA, returnsB);
  }

  // ── Sector performance ─────────────────────────────────

  computeSectorPerformance(barsByEtf: Record<string, OhlcvBar[]>): Record<string, { d1: number; w1: number; m1: number }> {
    const result: Record<string, { d1: number; w1: number; m1: number }> = {};
    for (const [etf, bars] of Object.entries(barsByEtf)) {
      if (bars.length < 2) continue;
      const last = bars[bars.length - 1].close;
      const d1Idx = Math.max(0, bars.length - 2);
      const w1Idx = Math.max(0, bars.length - 6);
      const m1Idx = Math.max(0, bars.length - 22);
      result[etf] = {
        d1: +(((last - bars[d1Idx].close) / bars[d1Idx].close) * 100).toFixed(1),
        w1: +(((last - bars[w1Idx].close) / bars[w1Idx].close) * 100).toFixed(1),
        m1: +(((last - bars[m1Idx].close) / bars[m1Idx].close) * 100).toFixed(1),
      };
    }
    return result;
  }

  // ═══════════════════════════════════════════════════════
  // Math helpers
  // ═══════════════════════════════════════════════════════

  private sma(values: number[]): number {
    return values.reduce((a, v) => a + v, 0) / values.length;
  }

  private stdDev(values: number[], mean: number): number {
    const variance = values.reduce((a, v) => a + (v - mean) ** 2, 0) / values.length;
    return Math.sqrt(variance);
  }

  private atr(bars: OhlcvBar[], period: number): number | null {
    if (bars.length < 2) return null;
    const trueRanges: number[] = [];
    for (let i = 1; i < bars.length; i++) {
      const high = bars[i].high, low = bars[i].low, prevClose = bars[i - 1].close;
      trueRanges.push(Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose)));
    }
    if (trueRanges.length < period) return null;
    return trueRanges.slice(-period).reduce((a, v) => a + v, 0) / period;
  }

  private rsi(closes: number[], period: number): number[] {
    if (closes.length < period + 1) return [];
    const gains: number[] = [], losses: number[] = [];
    for (let i = 1; i < closes.length; i++) {
      const diff = closes[i] - closes[i - 1];
      gains.push(diff > 0 ? diff : 0);
      losses.push(diff < 0 ? -diff : 0);
    }
    const rsiValues: number[] = [];
    let avgGain = gains.slice(0, period).reduce((a, v) => a + v, 0) / period;
    let avgLoss = losses.slice(0, period).reduce((a, v) => a + v, 0) / period;
    for (let i = period; i < gains.length; i++) {
      if (avgLoss === 0) { rsiValues.push(100); }
      else { rsiValues.push(100 - 100 / (1 + avgGain / avgLoss)); }
      avgGain = (avgGain * (period - 1) + gains[i]) / period;
      avgLoss = (avgLoss * (period - 1) + losses[i]) / period;
    }
    return rsiValues;
  }

  private macd(closes: number[]): { macdLine: number[]; signalLine: number[] } {
    const ema12 = this.emaSeriesRaw(closes, 12);
    const ema26 = this.emaSeriesRaw(closes, 26);
    const macdLine: number[] = [];
    for (let i = 0; i < closes.length; i++) {
      macdLine.push(ema12[i] - ema26[i]);
    }
    const signalLine = this.emaSeriesRaw(macdLine, 9);
    return { macdLine, signalLine };
  }

  private emaSeriesRaw(values: number[], period: number): number[] {
    const result: number[] = [];
    const k = 2 / (period + 1);
    let ema = values[0] ?? 0;
    result.push(ema);
    for (let i = 1; i < values.length; i++) {
      ema = values[i] * k + ema * (1 - k);
      result.push(ema);
    }
    return result;
  }

  private smaSeries(closes: number[], period: number): number[] {
    const result: number[] = [];
    for (let i = period - 1; i < closes.length; i++) {
      result.push(this.sma(closes.slice(i - period + 1, i + 1)));
    }
    return result;
  }

  private emaSeries(closes: number[], period: number): number[] {
    return this.emaSeriesRaw(closes, period);
  }

  private atrSeries(bars: OhlcvBar[], period: number): number[] {
    const result: number[] = [];
    for (let i = period; i < bars.length; i++) {
      const atr = this.atr(bars.slice(0, i + 1), period);
      if (atr !== null) result.push(atr);
    }
    return result;
  }

  private adx(bars: OhlcvBar[], period: number): number[] {
    if (bars.length < period * 2) return [];
    const tr: number[] = [], plusDm: number[] = [], minusDm: number[] = [];
    for (let i = 1; i < bars.length; i++) {
      const high = bars[i].high, low = bars[i].low;
      const prevHigh = bars[i - 1].high, prevLow = bars[i - 1].low;
      tr.push(Math.max(high - low, Math.abs(high - prevLow), Math.abs(low - prevHigh)));
      const upMove = high - prevHigh, downMove = prevLow - low;
      plusDm.push(upMove > downMove && upMove > 0 ? upMove : 0);
      minusDm.push(downMove > upMove && downMove > 0 ? downMove : 0);
    }
    const adxValues: number[] = [];
    const smoothTR = this.wilderSmooth(tr, period);
    const smoothPlusDM = this.wilderSmooth(plusDm, period);
    const smoothMinusDM = this.wilderSmooth(minusDm, period);
    for (let i = 0; i < smoothTR.length; i++) {
      const plusDi = smoothTR[i] === 0 ? 0 : (smoothPlusDM[i] / smoothTR[i]) * 100;
      const minusDi = smoothTR[i] === 0 ? 0 : (smoothMinusDM[i] / smoothTR[i]) * 100;
      const dx = (plusDi + minusDi) === 0 ? 0 : (Math.abs(plusDi - minusDi) / (plusDi + minusDi)) * 100;
      adxValues.push(dx);
    }
    return adxValues;
  }

  private wilderSmooth(values: number[], period: number): number[] {
    const result: number[] = [];
    let sum = 0;
    for (let i = 0; i < period && i < values.length; i++) sum += values[i];
    result.push(sum / period);
    for (let i = period; i < values.length; i++) {
      result.push((result[result.length - 1] * (period - 1) + values[i]) / period);
    }
    return result;
  }

  private cci(bars: OhlcvBar[], period: number): number[] {
    const typicalPrices = bars.map((b) => (b.high + b.low + b.close) / 3);
    const result: number[] = [];
    for (let i = period - 1; i < typicalPrices.length; i++) {
      const slice = typicalPrices.slice(i - period + 1, i + 1);
      const mean = this.sma(slice);
      const mad = slice.reduce((a, v) => a + Math.abs(v - mean), 0) / period;
      result.push(mad === 0 ? 0 : (typicalPrices[i] - mean) / (0.015 * mad));
    }
    return result;
  }

  private mfi(bars: OhlcvBar[], period: number): number[] {
    const result: number[] = [];
    for (let i = period; i < bars.length; i++) {
      const slice = bars.slice(i - period, i);
      let posFlow = 0, negFlow = 0;
      for (let j = 1; j < slice.length; j++) {
        const tp = (slice[j].high + slice[j].low + slice[j].close) / 3;
        const prevTp = (slice[j - 1].high + slice[j - 1].low + slice[j - 1].close) / 3;
        const mf = tp * slice[j].volume;
        if (tp > prevTp) posFlow += mf; else negFlow += mf;
      }
      result.push(negFlow === 0 ? 100 : 100 - 100 / (1 + posFlow / negFlow));
    }
    return result;
  }

  private pearsonCorrelation(xs: number[], ys: number[]): number {
    const n = xs.length;
    const meanX = this.sma(xs), meanY = this.sma(ys);
    let cov = 0, varX = 0, varY = 0;
    for (let i = 0; i < n; i++) {
      const dx = xs[i] - meanX, dy = ys[i] - meanY;
      cov += dx * dy;
      varX += dx * dx;
      varY += dy * dy;
    }
    if (varX === 0 || varY === 0) return 0;
    return +(cov / Math.sqrt(varX * varY)).toFixed(2);
  }

  private emptySrLevels(symbol: string, timeframe: string): SupportResistanceLevels {
    return {
      symbol, timeframe,
      pivot: 0, r1: 0, r2: 0, r3: 0, s1: 0, s2: 0, s3: 0,
      roundLevels: [], ma20: null, ma50: null, currentPrice: 0,
    };
  }
}
