/**
 * MT5 Engulfing Directive
 * =======================
 * Ported from MetaQuotes MT5 Free Robots — CAD-focused / BullishBearish Engulfing RSI.
 *
 * Pattern: 2-candle bullish/bearish engulfing with RSI(37) confirmation.
 * Source: MT5 Experts/Free Robots/
 *
 * Rules (Bullish Engulfing):
 * - Candle[1] is bearish: open > close
 * - Candle[0] body > average body over 12 periods
 * - Candle[0].close > Candle[1].open (engulfs)
 * - Midpoint[1] < average close (downtrend context)
 * - Candle[0].open < Candle[1].close
 *
 * Confirmation: RSI(37) < 40 for buy, RSI(37) > 60 for sell
 * Pattern detected but unconfirmed → score 30 (weak)
 * Pattern detected AND confirmed → score 85
 */

import { Injectable } from '@nestjs/common';
import { DirectiveInput, DirectiveResult, IDirective } from '../interfaces/directive.interface';
import { rsi, ema } from '../utils/indicators';

const MIN_BARS = 14;
const RSI_PERIOD = 37;
const BODY_AVG_PERIOD = 12;

@Injectable()
export class Mt5EngulfingDirective implements IDirective {
  readonly id = 'mt5-engulfing';
  readonly name = 'MT5 Engulfing Pattern (with RSI confirmation)';
  readonly description = 'MT5-sourced engulfing pattern with RSI(37) confirmation. Proven 2-candle reversal logic from MetaQuotes Free Robots.';
  readonly priority = 55;
  readonly maxScore = 100;
  readonly minBars = { '1d': 14 };
  readonly version = '1.0.0';
  readonly readiness = 'ready' as const;

  calculate(input: DirectiveInput): DirectiveResult {
    const { bars, symbol } = input;
    if (bars.length < MIN_BARS) {
      return { score: 0, confidence: 0.1, reason: `Insufficient data: need ${MIN_BARS} bars, have ${bars.length}.`, signalClass: 'neutral' };
    }

    const closes = bars.map((b) => b.close);
    const rsiValues = rsi(closes, RSI_PERIOD);
    const latestRsi = rsiValues.length > 0 ? rsiValues[rsiValues.length - 1] : 50;

    const prev = bars[bars.length - 2];
    const curr = bars[bars.length - 1];

    const prevBody = prev.close - prev.open;
    const currBody = curr.close - curr.open;
    const prevBearish = prevBody < 0;
    const currBullish = currBody > 0;
    const prevBullish = prevBody > 0;
    const currBearish = currBody < 0;

    // Average body size over BODY_AVG_PERIOD
    const recentBodies = bars.slice(-BODY_AVG_PERIOD).map((b) => Math.abs(b.close - b.open));
    const avgBody = recentBodies.reduce((s, v) => s + v, 0) / recentBodies.length;

    // Downtrend context: midpoint of prev candle < average close over recent period
    const avgClose = closes.slice(-10).reduce((s, v) => s + v, 0) / Math.min(10, closes.length);
    const prevMidpoint = (prev.high + prev.low) / 2;

    // ─── Bullish Engulfing ───────────────────────────────
    if (prevBearish && currBullish && Math.abs(currBody) > avgBody) {
      const engulfs = curr.close > prev.open && curr.open < prev.close;
      const inDowntrend = prevMidpoint < avgClose;
      const confirmed = latestRsi < 40;

      if (engulfs && inDowntrend && confirmed) {
        return {
          score: 85,
          confidence: 0.75,
          reason: `MT5: Bullish Engulfing at ${curr.close.toFixed(2)} | RSI=${latestRsi.toFixed(1)} (confirmed)`,
          signalClass: 'bullish',
        };
      }

      if (engulfs && inDowntrend) {
        return {
          score: 30,
          confidence: 0.3,
          reason: `MT5: Bullish Engulfing at ${curr.close.toFixed(2)} | RSI=${latestRsi.toFixed(1)} (unconfirmed — need RSI < 40)`,
          signalClass: 'neutral',
        };
      }
    }

    // ─── Bearish Engulfing ───────────────────────────────
    if (prevBullish && currBearish && Math.abs(currBody) > avgBody) {
      const engulfs = curr.close < prev.open && curr.open > prev.close;
      const inUptrend = prevMidpoint > avgClose;
      const confirmed = latestRsi > 60;

      if (engulfs && inUptrend && confirmed) {
        return {
          score: 85,
          confidence: 0.75,
          reason: `MT5: Bearish Engulfing at ${curr.close.toFixed(2)} | RSI=${latestRsi.toFixed(1)} (confirmed)`,
          signalClass: 'bearish',
        };
      }

      if (engulfs && inUptrend) {
        return {
          score: 30,
          confidence: 0.3,
          reason: `MT5: Bearish Engulfing at ${curr.close.toFixed(2)} | RSI=${latestRsi.toFixed(1)} (unconfirmed — need RSI > 60)`,
          signalClass: 'neutral',
        };
      }
    }

    return { score: 0, confidence: 0.2, reason: `MT5: No engulfing pattern at ${curr.close.toFixed(2)}`, signalClass: 'neutral' };
  }
}
