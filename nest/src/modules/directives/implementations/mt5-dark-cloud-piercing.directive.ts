/**
 * MT5 Dark Cloud / Piercing Line Patterns
 * =========================================
 * Bearish Dark Cloud Cover: strong green candle followed by red opening above
 * previous close and closing below midpoint.
 * Bullish Piercing Line: strong red candle followed by green opening below
 * previous close and closing above midpoint.
 * Derived from MT5: DarkCloud PiercingLine CCI.mq5
 */
import { Injectable } from '@nestjs/common';
import { DirectiveInput, DirectiveResult, IDirective } from '../interfaces/directive.interface';
import { cci } from '../utils/indicators';

const CCI_PERIOD = 37;
const MIN_BARS = CCI_PERIOD + 4;

@Injectable()
export class Mt5DarkCloudPiercingDirective implements IDirective {
  readonly id = 'mt5-dark-cloud-piercing';
  readonly name = 'MT5 Dark Cloud / Piercing Line';
  readonly description = 'Dark Cloud Cover (bearish reversal) and Piercing Line (bullish reversal) with CCI(37) confirmation.';
  readonly priority = 65;
  readonly maxScore = 100;
  readonly minBars = { '1d': 41 };
  readonly version = '1.0.0';
  readonly readiness = 'ready' as const;

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

    // Bearish Dark Cloud Cover
    // Prev: strong green (close > open by at least 0.5%)
    // Current: opens above prev close, closes below midpoint of prev candle
    const prevBody = Math.abs(closes[last - 1] - opens[last - 1]);
    const prevMidpoint = (closes[last - 1] + opens[last - 1]) / 2;
    const prevStrongBullish = closes[last - 1] > opens[last - 1] && prevBody / opens[last - 1] > 0.005;
    const darkCloud = prevStrongBullish &&
      opens[last] > closes[last - 1] && // opens above prev close
      closes[last] < opens[last] && // current is red
      closes[last] > prevMidpoint && closes[last] < closes[last - 1]; // closes below midpoint but above prev close

    // Bullish Piercing Line
    // Prev: strong red (close < open by at least 0.5%)
    // Current: opens below prev close, closes above midpoint of prev candle
    const prevStrongBearish = opens[last - 1] > closes[last - 1] && prevBody / opens[last - 1] > 0.005;
    const piercing = prevStrongBearish &&
      opens[last] < closes[last - 1] && // opens below prev close
      closes[last] > opens[last] && // current is green
      closes[last] < prevMidpoint && closes[last] > opens[last - 1]; // closes above midpoint but below prev open

    if (darkCloud) {
      const cciConfirms = curCci > 50 && curCci < prevCci;
      const score = cciConfirms ? 80 : 35;
      return {
        score,
        confidence: cciConfirms ? 0.8 : 0.5,
        reason: cciConfirms
          ? `Dark Cloud Cover + CCI(${CCI_PERIOD}) confirms bearish reversal (${curCci.toFixed(1)}, declining).`
          : `Dark Cloud Cover pattern, CCI(${CCI_PERIOD}) = ${curCci.toFixed(1)} — no confirmation.`,
        signalClass: 'bearish',
      };
    }
    if (piercing) {
      const cciConfirms = curCci < -50 && curCci > prevCci;
      const score = cciConfirms ? 85 : 35;
      return {
        score,
        confidence: cciConfirms ? 0.85 : 0.5,
        reason: cciConfirms
          ? `Piercing Line + CCI(${CCI_PERIOD}) confirms bullish reversal (${curCci.toFixed(1)}, rising).`
          : `Piercing Line pattern, CCI(${CCI_PERIOD}) = ${curCci.toFixed(1)} — no confirmation.`,
        signalClass: 'bullish',
      };
    }
    return { score: 0, confidence: 0.1, reason: 'No dark cloud or piercing pattern detected.', signalClass: 'neutral' };
  }
}
