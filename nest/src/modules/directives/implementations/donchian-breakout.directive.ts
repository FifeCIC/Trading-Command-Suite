/**
 * Donchian Channel Breakout
 * ==========================
 * Upper/lower Donchian Channel (20-period highest high / lowest low).
 * Price above upper = new 20-bar high (breakout). Price below lower = breakdown.
 * Derived from MT5 Donchian Channel indicator.
 */
import { Injectable } from '@nestjs/common';
import { DirectiveInput, DirectiveResult, IDirective } from '../interfaces/directive.interface';
import { donchianChannel } from '../utils/indicators';

const PERIOD = 20;
const MIN_BARS = PERIOD + 2;

@Injectable()
export class DonchianBreakoutDirective implements IDirective {
  readonly id = 'donchian-breakout';
  readonly name = 'Donchian Breakout';
  readonly description = 'Donchian Channel breakout. Price > upper = new high breakout. Price < lower = breakdown. Scores momentum.';
  readonly priority = 70;
  readonly maxScore = 100;
  readonly minBars = { '1d': 22 };
  readonly version = '1.0.0';

  calculate(input: DirectiveInput): DirectiveResult {
    const closes = input.bars.map(b => b.close);
    const highs = input.bars.map(b => b.high);
    const lows = input.bars.map(b => b.low);
    if (closes.length < MIN_BARS) {
      return { score: 0, confidence: 0.1, reason: `Need ${MIN_BARS} bars.`, signalClass: 'neutral' };
    }
    const dc = donchianChannel(highs, lows, PERIOD);
    if (dc.upper.length === 0) {
      return { score: 0, confidence: 0.1, reason: 'Could not calculate Donchian.', signalClass: 'neutral' };
    }
    const curClose = closes[closes.length - 1];
    const curUpper = dc.upper[dc.upper.length - 1];
    const curLower = dc.lower[dc.lower.length - 1];
    const curMiddle = dc.middle[dc.middle.length - 1];
    const channelWidth = curUpper - curLower;

    // Breakout above upper
    if (curClose > curUpper) {
      const distance = (curClose - curUpper) / (channelWidth || 1);
      const strength = Math.min(1, distance);
      return {
        score: Math.round(60 + strength * 30),
        confidence: 0.7 + strength * 0.2,
        reason: `Price ${curClose.toFixed(2)} above upper Donchian ${curUpper.toFixed(2)}. New ${PERIOD}-bar high breakout.`,
        signalClass: 'bullish',
      };
    }
    // Breakdown below lower
    if (curClose < curLower) {
      const distance = (curLower - curClose) / (channelWidth || 1);
      const strength = Math.min(1, distance);
      return {
        score: Math.round(50 + strength * 25),
        confidence: 0.6,
        reason: `Price ${curClose.toFixed(2)} below lower Donchian ${curLower.toFixed(2)}. ${PERIOD}-bar breakdown.`,
        signalClass: 'bearish',
      };
    }
    // Position within channel
    const position = (curClose - curLower) / (channelWidth || 1);
    if (position > 0.8) {
      return { score: 35, confidence: 0.4, reason: `Price near upper Donchian (${(position * 100).toFixed(0)}% of channel).`, signalClass: 'bullish' };
    }
    if (position < 0.2) {
      return { score: 25, confidence: 0.4, reason: `Price near lower Donchian (${(position * 100).toFixed(0)}% of channel).`, signalClass: 'bearish' };
    }
    return { score: 10, confidence: 0.2, reason: `Price at ${(position * 100).toFixed(0)}% of Donchian channel — neutral.`, signalClass: 'neutral' };
  }
}
