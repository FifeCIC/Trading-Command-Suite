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
 * ── Hybrid Scoring ─────────────────────────────────────────
 * BASE (0–100):  Continuous DXY interpolation: DXY 108→0, DXY 95→100.
 *                Every DXY tick produces a visible score change.
 * BONUS tiers:   yield10Y > 4.5% or < 3.8% → +20 (rate extremes).
 *                VIX > 25 → +15 (fear premium).
 * MAX:           135 (100 base + 35 bonus max).
 *
 * ── Data Sources ─────────────────────────────────────────
 * dxyValue or eurusdValue on DirectiveInput (from DXY pipeline)
 * treasury10Y on DirectiveInput (from Finnhub/FMP, optional)
 * vixValue on DirectiveInput (from VIX regime, optional)
 */

import { Injectable } from '@nestjs/common';
import { DirectiveInput, DirectiveResult, IDirective } from '../interfaces/directive.interface';

// ── Thresholds ────────────────────────────────────────────

const YIELD_HIGH = 4.5;   // 10Y > 4.5% = rising rate pressure
const YIELD_LOW = 3.8;    // 10Y < 3.8% = falling rate tailwind
const VIX_FEAR = 25;      // VIX > 25 = safe-haven bid

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
  readonly description =
    'Hybrid: continuous DXY base for gold + yield/VIX threshold bonuses.';
  readonly priority = 55;
  readonly maxScore = 135; // 100 base + 35 bonus max
  readonly minBars = { '1d': 20 };
  readonly version = '2.0.0'; // Hybrid scoring
  readonly requiredDataFeeds = ['dxy', 'treasury10y', 'vix'];
  readonly readiness = 'beta' as const;

  calculate(input: DirectiveInput): DirectiveResult {
    let dxy = (input as any).dxyValue as number | undefined;
    const eurusd = (input as any).eurusdValue as number | undefined;
    const yield10Y = (input as any).treasury10Y as number | undefined;
    const vix = (input as any).vixValue as number | undefined;

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

    // ── BONUS (threshold-gated, rare events) ─────────────
    let bonusScore = 0;
    const bonusParts: string[] = [];

    // Yield extremes (stackable with VIX)
    if (yield10Y !== undefined && yield10Y > 0) {
      if (yield10Y >= YIELD_HIGH || yield10Y <= YIELD_LOW) {
        bonusScore += 20;
        bonusParts.push(`yield extreme (${yield10Y}%)`);
      }
    }

    // VIX fear premium
    if (vix !== undefined && vix > 0 && vix >= VIX_FEAR) {
      bonusScore += 15;
      bonusParts.push(`VIX=${vix.toFixed(0)}`);
    }

    const bonusLabel = bonusParts.join(' + ');

    // ── Total ─────────────────────────────────────────────
    const totalScore = baseScore + bonusScore;

    let signalClass: 'bullish' | 'bearish' | 'neutral';
    if (totalScore >= 65) signalClass = 'bullish';
    else if (totalScore <= 35) signalClass = 'bearish';
    else signalClass = 'neutral';

    const hasFullData = yield10Y !== undefined && vix !== undefined;
    const confidence = hasFullData ? 0.55 : 0.35;

    const parts: string[] = [`base=${baseScore} (${dxySource}=${dxy})`];
    if (bonusScore > 0) parts.push(`+${bonusScore} bonus (${bonusLabel})`);
    parts.push(`= ${totalScore}/${this.maxScore}`);

    return {
      signalClass,
      score: totalScore,
      confidence,
      reason: `${sym}: ${parts.join(' ')}`,
      metadata: { baseScore, bonusScore, bonusLabel, dxy, dxySource },
    };
  }
}
