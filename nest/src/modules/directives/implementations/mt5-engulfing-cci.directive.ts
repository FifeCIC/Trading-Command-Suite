/**
 * MT5 Engulfing Pattern with CCI(37) Confirmation
 * ================================================
 * 2-candle bullish/bearish engulfing pattern confirmed by CCI(37) trend.
 * Bullish: green candle fully engulfs previous red. CCI > -100 and rising.
 * Bearish: red candle fully engulfs previous green. CCI < 100 and falling.
 * Derived from MT5: BullishBearish Engulfing CCI.mq5
 */
import { Injectable } from '@nestjs/common';
import { DirectiveInput, DirectiveResult, IDirective } from '../interfaces/directive.interface';
import { cci } from '../utils/indicators';

const CCI_PERIOD = 37;
const MIN_BARS = CCI_PERIOD + 4;

@Injectable()
export class Mt5EngulfingCciDirective implements IDirective {
  readonly id = 'mt5-engulfing-cci';
  readonly name = 'MT5 Engulfing + CCI(37)';
  readonly description = 'MT5-sourced engulfing pattern with CCI(37) confirmation. Pattern detected=30, confirmed=85.';
  readonly priority = 70;

  calculate(input: DirectiveInput): DirectiveResult {
    const closes = input.bars.map(b => b.close);
    const opens = input.bars.map(b => b.open);
    const highs = input.bars.map(b => b.high);
    const lows = input.bars.map(b => b.low);
    if (closes.length < MIN_BARS) {
      return { score: 0, confidence: 0.1, reason: `Need ${MIN_BARS} bars.`, signalClass: 'neutral' };
    }
    const cciValues = cci(highs, lows, closes, CCI_PERIOD);
    if (cciValues.length < 3) {
      return { score: 0, confidence: 0.1, reason: 'Not enough CCI values.', signalClass: 'neutral' };
    }
    const last = closes.length - 1;
    const curCci = cciValues[cciValues.length - 1];
    const prevCci = cciValues[cciValues.length - 2];

    // Bullish engulfing: current green engulfs previous red
    const bullishEngulf = opens[last] < closes[last] && // current is green
      opens[last - 1] > closes[last - 1] && // prev is red
      closes[last] > opens[last - 1] && // close > prev open
      opens[last] < closes[last - 1]; // open < prev close

    // Bearish engulfing: current red engulfs previous green
    const bearishEngulf = opens[last] > closes[last] && // current is red
      opens[last - 1] < closes[last - 1] && // prev is green
      opens[last] > closes[last - 1] && // open > prev close
      closes[last] < opens[last - 1]; // close < prev open

    if (bullishEngulf) {
      const cciOversold = curCci < -100;
      const cciRising = curCci > prevCci;
      const confirmed = cciOversold || (cciRising && curCci > -100);
      const score = confirmed ? 85 : 30;
      return {
        score,
        confidence: confirmed ? 0.85 : 0.5,
        reason: confirmed
          ? `Bullish engulfing detected + CCI(${CCI_PERIOD}) confirmation (${curCci.toFixed(1)}). Strong reversal signal.`
          : `Bullish engulfing detected but CCI(${CCI_PERIOD}) = ${curCci.toFixed(1)} — no confirmation.`,
        signalClass: 'bullish',
      };
    }
    if (bearishEngulf) {
      const cciOverbought = curCci > 100;
      const cciFalling = curCci < prevCci;
      const confirmed = cciOverbought || (cciFalling && curCci < 100);
      const score = confirmed ? 80 : 30;
      return {
        score,
        confidence: confirmed ? 0.8 : 0.5,
        reason: confirmed
          ? `Bearish engulfing detected + CCI(${CCI_PERIOD}) confirmation (${curCci.toFixed(1)}). Strong reversal signal.`
          : `Bearish engulfing detected but CCI(${CCI_PERIOD}) = ${curCci.toFixed(1)} — no confirmation.`,
        signalClass: 'bearish',
      };
    }
    return { score: 0, confidence: 0.1, reason: 'No engulfing pattern detected.', signalClass: 'neutral' };
  }
}
