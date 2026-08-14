/**
 * Gold Macro Correlation Directive — HYBRID BASE+BONUS (Layer C, 2026-07-29)
 * ===========================================================================
 * Evaluates gold (XAUUSD, XAGUSD) in context of macro drivers:
 * USD strength (DXY), real yields, safe-haven demand.
 *
 * ── Key Relationships ────────────────────────────────────
 * DXY ↑ (strong USD)       → bearish gold (priced in USD)
 * DXY ↓ (weak USD)         → bullish gold
 * 10Y yield ↑ (rising)     → bearish gold (opportunity cost)
 * 10Y yield ↓ (falling)    → bullish gold
 * VIX ↑ (fear)             → bullish gold (safe haven)
 *
 * ── Scoring ────────────────────────────────────────────────
 * BASE (0–100):  DXY interpolation: DXY 108→0, DXY 95→100.
 * MAX:           100.
 *
 * NOTE (2026-08-14): yield/VIX bonus tiers removed — treasury10Y and
 * vixValue are never written anywhere in the pipeline, so the +35 bonus
 * was unreachable and inflated the denominator. A real-yields/VIX feed is
 * a future data-source gap, not a directive-logic gap.
 *
 * ── Data Sources ─────────────────────────────────────────
 * dxyValue or eurusdValue on DirectiveInput (from EURUSD proxy pipeline)
 */

import { Injectable } from '@nestjs/common';
import { DirectiveInput, DirectiveResult, IDirective } from '../interfaces/directive.interface';

/** Linear interpolation: map value from [inMin,inMax] to [outMin,outMax], clamped. */
function mapRange(v: number, inMin: number, inMax: number, outMin: number, outMax: number): number {
  const t = Math.max(0, Math.min(1, (v - inMin) / (inMax - inMin)));
  return outMin + t * (outMax - outMin);
}

// ── Directive ─────────────────────────────────────────────

@Injectable()
export class GoldMacroCorrelationDirective implements IDirective {
  readonly id = 'gold-macro-correlation';
  readonly name = 'Gold Macro Correlation';
  readonly category = 'structural' as const;
  readonly description =
    'DXY (USD strength) base score for gold — weak USD bullish, strong USD bearish.';
  readonly priority = 55;
  readonly maxScore = 100;
  readonly minScore = 1;
  readonly minBars = { '1d': 20 };
  readonly version = '2.1.0'; // DXY-only scoring (yield/VIX bonus removed 2026-08-14)
  readonly requiredDataFeeds = ['dxy'];
  readonly readiness = 'ready' as const; // promoted beta→ready 2026-08-14 — real DXY input, correct math, dead bonus removed
  readonly directionBias = 'neutral' as const;

  calculate(input: DirectiveInput): DirectiveResult {
    let dxy = (input as any).dxyValue as number | undefined;
    const eurusd = (input as any).eurusdValue as number | undefined;

    const sym = input.symbol.toUpperCase();

    // Only score gold/silver — neutral for everything else
    if (sym !== 'XAUUSD' && sym !== 'XAGUSD' && sym !== 'XAU' && sym !== 'XAG') {
      return {
        signalClass: 'neutral',
        score: 50,
        confidence: 0,
        reason: `${input.symbol} is not a gold/silver symbol — gold-macro-correlation only applies to XAUUSD/XAGUSD.`,
      };
    }

    // ── EURUSD proxy fallback ─────────────────────────────
    let dxySource = 'DXY';
    if ((dxy === undefined || dxy <= 0) && eurusd !== undefined && eurusd > 0) {
      if (eurusd >= 1.15) dxy = 98;
      else if (eurusd >= 1.08) dxy = 103;
      else dxy = 108;
      dxySource = 'EURUSD proxy';
    }

    // ── No macro data at all ──────────────────────────────
    if (dxy === undefined || dxy <= 0) {
      return {
        signalClass: 'neutral',
        score: 50,
        confidence: 0.10,
        reason: `No DXY or EURUSD macro data for ${input.symbol}. Gold macro correlation requires USD strength data. Connect MT5 (EURUSD always available), Finnhub, or Alpha Vantage.`,
      };
    }

    // ── BASE (continuous, 0–100) ──────────────────────────
    // DXY 108 (strong USD) → base 0 (bearish gold)
    // DXY 95 (weak USD)    → base 100 (bullish gold)
    const baseScore = Math.round(mapRange(dxy, 108, 95, 0, 100));

    // ── Total ─────────────────────────────────────────────
    // (2026-08-14) Yield/VIX bonus tiers removed — treasury10Y/vixValue are
    // never written anywhere in the pipeline, so the +35 bonus was
    // unreachable and inflated the denominator.
    const totalScore = baseScore;

    let signalClass: 'bullish' | 'bearish' | 'neutral';
    if (totalScore >= 65) signalClass = 'bullish';
    else if (totalScore <= 35) signalClass = 'bearish';
    else signalClass = 'neutral';

    const confidence = 0.45;

    const parts: string[] = [`base=${baseScore} (${dxySource}=${dxy})`];
    parts.push(`= ${totalScore}/${this.maxScore}`);

    return {
      signalClass,
      score: totalScore,
      confidence,
      reason: `${sym}: ${parts.join(' ')}`,
      metadata: { baseScore, dxy, dxySource },
    };
  }
}
