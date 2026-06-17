/**
 * Money Flow Index (MFI) Directive
 * ================================
 * Volume-weighted RSI that identifies overbought/oversold conditions
 * using both price and volume data.
 *
 * MFI < 20 = oversold (bullish accumulation signal)
 * MFI > 80 = overbought (bearish distribution signal)
 *
 * TradePress source: includes/scoring-system/directives/mfi.php
 */

import { Injectable } from '@nestjs/common';
import {
  DirectiveInput,
  DirectiveResult,
  IDirective,
} from '../interfaces/directive.interface';
import { mfi } from '../utils/indicators';

const MFI_PERIOD = 14;
const OVERSOLD_THRESHOLD = 20;
const OVERBOUGHT_THRESHOLD = 80;
const MIN_BARS = MFI_PERIOD + 3;

@Injectable()
export class MfiDirective implements IDirective {
  readonly id = 'mfi';
  readonly name = 'Money Flow Index';
  readonly description =
    'Volume-weighted RSI. MFI < 20 = oversold accumulation. MFI > 80 = overbought distribution.';

  readonly priority = 50;
  readonly maxScore = 100;
  readonly version = '1.0.0';

  calculate(input: DirectiveInput): DirectiveResult {
    const highs = input.bars.map(b => b.high);
    const lows = input.bars.map(b => b.low);
    const closes = input.bars.map(b => b.close);
    const volumes = input.bars.map(b => b.volume);

    if (closes.length < MIN_BARS) {
      return {
      signalClass: 'neutral',
      score: 0,
        confidence: 0.1,
        reason: `Insufficient data: need ${MIN_BARS} bars, have ${closes.length}.`,
      };
    }

    const mfiValues = mfi(highs, lows, closes, volumes, MFI_PERIOD);
    if (mfiValues.length < 3) {
      return { score: 0, confidence: 0.1, reason: 'Not enough MFI values calculated.' };
    }

    const currentMfi = mfiValues[mfiValues.length - 1];
    const prevMfi = mfiValues[mfiValues.length - 2];
    const curling = currentMfi > prevMfi;

    // Price trend for divergence detection
    const recentCloses = closes.slice(-5);
    const priceChange = recentCloses[recentCloses.length - 1] - recentCloses[0];

    if (currentMfi <= OVERSOLD_THRESHOLD) {
      // Oversold: money flow exhaustion, potential reversal up
      const depth = (OVERSOLD_THRESHOLD - currentMfi) / OVERSOLD_THRESHOLD; // 0–1
      const score = Math.round(60 + depth * 30 + (curling ? 10 : 0)); // 60–100
      return {
        score,
        confidence: 0.55 + depth * 0.3,
        reason: `MFI oversold at ${currentMfi.toFixed(1)}${curling ? ' and curling up' : ''}. Volume-weighted selling exhaustion — potential accumulation.`,
      };
    }

    if (currentMfi >= OVERBOUGHT_THRESHOLD) {
      // Overbought: money flow extreme, caution for longs
      const height = (currentMfi - OVERBOUGHT_THRESHOLD) / (100 - OVERBOUGHT_THRESHOLD);
      const score = Math.round(25 - height * 15); // 10–25
      return {
        score,
        confidence: 0.5 + height * 0.2,
        reason: `MFI overbought at ${currentMfi.toFixed(1)}. Volume-weighted buying exhaustion — reduced long score.`,
      };
    }

    // Divergence: price up but MFI down = weakness
    if (priceChange > 0 && currentMfi < prevMfi && currentMfi < 50) {
      return {
      signalClass: 'neutral',
      score: 25,
        confidence: 0.45,
        reason: `Bearish MFI divergence: price rising (${priceChange.toFixed(2)}) but money flow declining (${currentMfi.toFixed(1)}). Distribution warning.`,
      };
    }

    // Divergence: price down but MFI up = strength
    if (priceChange < 0 && currentMfi > prevMfi && currentMfi > 40) {
      const score = Math.round(45 + (currentMfi - prevMfi) * 2);
      return {
        score,
        confidence: 0.45,
        reason: `Bullish MFI divergence: price falling but money flow improving (${currentMfi.toFixed(1)}). Accumulation on weakness.`,
      };
    }

    return {
      signalClass: 'neutral',
      score: 35,
      confidence: 0.3,
      reason: `MFI neutral at ${currentMfi.toFixed(1)}. No oversold/overbought or divergence signal.`,
    };
  }
}
