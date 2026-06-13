/**
 * Accumulation/Distribution Line (A/D)
 * ====================================
 * Cumulative CLV * volume. Rising A/D with flat/sideways price = accumulation.
 * Divergence between A/D and price = early reversal signal.
 * Derived from MT5 standard A/D indicator.
 */
import { Injectable } from '@nestjs/common';
import { DirectiveInput, DirectiveResult, IDirective } from '../interfaces/directive.interface';
import { accumulationDistribution } from '../utils/indicators';

const MIN_BARS = 14;

@Injectable()
export class AccumulationDistributionDirective implements IDirective {
  readonly id = 'accumulation-distribution';
  readonly name = 'Accumulation/Distribution';
  readonly description = 'A/D line divergence from price. Rising A/D with flat price = accumulation. Scores divergence quality.';
  readonly priority = 60;

  calculate(input: DirectiveInput): DirectiveResult {
    const closes = input.bars.map(b => b.close);
    const { high, low, volume } = this.extractHLV(input);
    if (closes.length < MIN_BARS) {
      return { score: 0, confidence: 0.1, reason: `Need ${MIN_BARS} bars.`, signalClass: 'neutral' };
    }
    const ad = accumulationDistribution(high, low, closes, volume);
    if (ad.length < MIN_BARS) {
      return { score: 0, confidence: 0.1, reason: 'Could not calculate A/D.', signalClass: 'neutral' };
    }
    // Compare recent A/D slope vs price slope
    const recent = 10;
    const adStart = ad[ad.length - recent];
    const adEnd = ad[ad.length - 1];
    const priceStart = closes[closes.length - recent];
    const priceEnd = closes[closes.length - 1];
    const adRising = adEnd > adStart;
    const priceRising = priceEnd > priceStart;
    const adSlope = (adEnd - adStart) / recent;
    const priceSlope = (priceEnd - priceStart) / recent;

    // Bullish divergence: A/D rising while price flat/down
    if (adRising && !priceRising) {
      const strength = Math.min(1, Math.abs(adSlope) / (Math.abs(priceSlope) + 0.001));
      return {
        score: Math.round(60 + strength * 30),
        confidence: 0.7,
        reason: `Bullish divergence: A/D rising (+${(adSlope).toFixed(0)}) while price ${priceRising ? 'rising less' : 'falling'} (${priceSlope.toFixed(2)}). Accumulation.`,
        signalClass: 'bullish',
      };
    }
    // Bearish divergence: A/D falling while price rising
    if (!adRising && priceRising) {
      const strength = Math.min(1, Math.abs(adSlope) / (Math.abs(priceSlope) + 0.001));
      return {
        score: Math.round(50 + strength * 25),
        confidence: 0.6,
        reason: `Bearish divergence: A/D falling (${adSlope.toFixed(0)}) while price rising. Distribution.`,
        signalClass: 'bearish',
      };
    }
    // Both rising
    if (adRising && priceRising) {
      return { score: 35, confidence: 0.45, reason: `A/D and price both rising. Trend confirmed.`, signalClass: 'bullish' };
    }
    return { score: 10, confidence: 0.25, reason: `A/D slope: ${adSlope.toFixed(0)}, price slope: ${priceSlope.toFixed(2)}.`, signalClass: 'neutral' };
  }

  private extractHLV(input: DirectiveInput): { high: number[]; low: number[]; volume: number[] } {
    return {
      high: input.bars.map(b => b.high),
      low: input.bars.map(b => b.low),
      volume: input.bars.map(b => b.volume),
    };
  }
}
