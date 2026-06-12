/**
 * MT5 Harami Directive
 * ====================
 * Harami pattern — small candle body inside large previous body.
 * Bullish Harami = small bullish body inside large bearish body
 * Bearish Harami = small bearish body inside large bullish body
 *
 * RSI(37) confirmation: < 40 for buy, > 60 for sell.
 */

import { Injectable } from '@nestjs/common';
import { DirectiveInput, DirectiveResult, IDirective } from '../interfaces/directive.interface';
import { rsi } from '../utils/indicators';

const MIN_BARS = 14;
const RSI_PERIOD = 37;
const HARAMI_BODY_RATIO = 0.4; // Inner body must be < 40% of outer body

@Injectable()
export class Mt5HaramiDirective implements IDirective {
  readonly id = 'mt5-harami';
  readonly name = 'MT5 Harami Pattern (with RSI confirmation)';
  readonly description = 'MT5-sourced harami reversal pattern with RSI(37) confirmation.';
  readonly priority = 50;

  calculate(input: DirectiveInput): DirectiveResult {
    const { bars } = input;
    if (bars.length < MIN_BARS) {
      return { score: 0, confidence: 0.1, reason: `Insufficient data: need ${MIN_BARS} bars, have ${bars.length}.`, signalClass: 'neutral' };
    }

    const closes = bars.map((b) => b.close);
    const rsiValues = rsi(closes, RSI_PERIOD);
    const latestRsi = rsiValues.length > 0 ? rsiValues[rsiValues.length - 1] : 50;

    const prev = bars[bars.length - 2];
    const curr = bars[bars.length - 1];

    const prevBody = Math.abs(prev.close - prev.open);
    const currBody = Math.abs(curr.close - curr.open);
    const prevBearish = prev.close < prev.open;
    const prevBullish = prev.close > prev.open;
    const currBullish = curr.close > curr.open;
    const currBearish = curr.close < curr.open;

    // ─── Bullish Harami ──────────────────────────────────
    if (prevBearish && currBullish && currBody < prevBody * HARAMI_BODY_RATIO) {
      const insidePrev =
        curr.high < prev.high && curr.low > prev.low;
      const confirmed = latestRsi < 40;

      if (insidePrev && confirmed) {
        return {
          score: 80,
          confidence: 0.7,
          reason: `MT5: Bullish Harami at ${curr.close.toFixed(2)} | RSI=${latestRsi.toFixed(1)} (confirmed)`,
          signalClass: 'bullish',
        };
      }

      if (insidePrev) {
        return {
          score: 25,
          confidence: 0.25,
          reason: `MT5: Bullish Harami at ${curr.close.toFixed(2)} | RSI=${latestRsi.toFixed(1)} (unconfirmed)`,
          signalClass: 'neutral',
        };
      }
    }

    // ─── Bearish Harami ──────────────────────────────────
    if (prevBullish && currBearish && currBody < prevBody * HARAMI_BODY_RATIO) {
      const insidePrev =
        curr.high < prev.high && curr.low > prev.low;
      const confirmed = latestRsi > 60;

      if (insidePrev && confirmed) {
        return {
          score: 80,
          confidence: 0.7,
          reason: `MT5: Bearish Harami at ${curr.close.toFixed(2)} | RSI=${latestRsi.toFixed(1)} (confirmed)`,
          signalClass: 'bearish',
        };
      }

      if (insidePrev) {
        return {
          score: 25,
          confidence: 0.25,
          reason: `MT5: Bearish Harami at ${curr.close.toFixed(2)} | RSI=${latestRsi.toFixed(1)} (unconfirmed)`,
          signalClass: 'neutral',
        };
      }
    }

    return { score: 0, confidence: 0.2, reason: `MT5: No harami pattern at ${curr.close.toFixed(2)}`, signalClass: 'neutral' };
  }
}
