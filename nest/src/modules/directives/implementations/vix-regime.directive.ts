/**
 * VIX Regime Directive
 * ====================
 * Evaluates market-wide volatility context (VIX-like).
 * Accepts optional vixValue on DirectiveInput or uses default neutral.
 *
 * Low VIX (<15): calm — bullish conditions.
 * Moderate VIX (15–25): cautious — slight penalty.
 * High VIX (>25): defensive — significant penalty.
 *
 * TradePress source: includes/scoring-system/directives/vix-regime.php
 */

import { Injectable } from '@nestjs/common';
import { DirectiveInput, DirectiveResult, IDirective } from '../interfaces/directive.interface';

@Injectable()
export class VixRegimeDirective implements IDirective {
  readonly id = 'vix-regime';
  readonly name = 'VIX Regime';
  readonly description = 'Market-wide volatility regime. Low VIX = calm, high VIX = defensive.';
  readonly category = 'structural' as const;
  readonly priority = 50;
  readonly maxScore = 100;
  readonly minScore = 1;
  readonly minBars = { '1d': 20 };
  readonly version = '1.1.0';
  readonly readiness = 'ready' as const;
  readonly directionBias = 'neutral' as const;

  calculate(input: DirectiveInput): DirectiveResult {
    const vix = (input as any).vixValue as number | undefined;

    if (vix === undefined || vix <= 0) {
      return {
        signalClass: 'neutral',
        score: 45,
        confidence: 0.15,
        reason: `No VIX data provided for ${input.symbol}. Default neutral regime. Connect VIX feed (Finnhub/FMP) or use SPY realized-vol proxy.`,
      };
    }

    if (vix < 12) {
      return {
        signalClass: 'bullish',
        score: 70,
        confidence: 0.55,
        reason: `Low VIX regime (${vix.toFixed(1)}): calm markets. Favorable for long positions.`,
      };
    }

    if (vix < 15) {
      return {
        signalClass: 'bullish',
        score: 60,
        confidence: 0.45,
        reason: `Normal-low VIX regime (${vix.toFixed(1)}): mild conditions. Good for longs.`,
      };
    }

    if (vix < 20) {
      return {
        signalClass: 'neutral',
        score: 50,
        confidence: 0.35,
        reason: `Normal VIX regime (${vix.toFixed(1)}): standard conditions.`,
      };
    }

    if (vix < 25) {
      return {
        signalClass: 'neutral',
        score: 40,
        confidence: 0.4,
        reason: `Moderate VIX regime (${vix.toFixed(1)}): cautious conditions. Slight long penalty.`,
      };
    }

    if (vix < 30) {
      return {
        signalClass: 'bearish',
        score: 25,
        confidence: 0.5,
        reason: `Elevated VIX regime (${vix.toFixed(1)}): defensive. Significant long penalty.`,
      };
    }

    if (vix < 40) {
      return {
        signalClass: 'bearish',
        score: 15,
        confidence: 0.55,
        reason: `High VIX regime (${vix.toFixed(1)}): fear conditions. Heavy long penalty.`,
      };
    }

    return {
      signalClass: 'bearish',
      score: 5,
      confidence: 0.6,
      reason: `Extreme VIX regime (${vix.toFixed(1)}): panic conditions. Minimal long score.`,
    };
  }
}
