/**
 * CAD/USD Oil Correlation Directive — HYBRID BASE+BONUS (Layer C, 2026-07-29)
 * ===========================================================================
 * Evaluates Canadian dollar pairs in context of the primary CAD driver:
 * crude oil prices. CAD is a petrocurrency — oil and CAD move together.
 *
 * ── Key Relationships ────────────────────────────────────
 * WTI crude ↑ (oil up)      → bullish CAD (USDCAD ↓, EURCAD ↓, etc.)
 * WTI crude ↓ (oil down)    → bearish CAD (USDCAD ↑)
 * DXY ↑ (strong USD)        → USDCAD rises (USD leg dominates)
 * BOC rate vs Fed rate      → wider spread = stronger CAD
 *
 * ── Hybrid Scoring ─────────────────────────────────────────
 * BASE (0–100):  Continuous DXY interpolation: DXY 108→0, DXY 95→100.
 *                USDCAD: flipped (100-base) since USD is the base currency.
 *                Other CAD pairs: base as-is (USD quote, DXY↑=bearish).
 * BONUS tiers:   WTI > $85 → +25 (strong oil tailwind for CAD).
 * MAX:           125 (100 base + 25 bonus).
 *
 * ── Symbol Coverage ──────────────────────────────────────
 * USDCAD, EURCAD, GBPCAD, AUDCAD, NZDCAD
 *
 * ── Data Sources ─────────────────────────────────────────
 * dxyValue or eurusdValue on DirectiveInput (DXY pipeline)
 * wtiValue on DirectiveInput (MT5 USOIL quote, optional)
 */

import { Injectable } from '@nestjs/common';
import { DirectiveInput, DirectiveResult, IDirective } from '../interfaces/directive.interface';

// ── Thresholds ────────────────────────────────────────────

const OIL_STRONG = 85;  // WTI > $85 = strong oil = CAD tailwind

// ── CAD pair detection ────────────────────────────────────

const CAD_PAIRS = new Set([
  'USDCAD', 'EURCAD', 'GBPCAD', 'AUDCAD', 'NZDCAD',
]);

/** Linear interpolation: map value from [inMin,inMax] to [outMin,outMax], clamped. */
function mapRange(v: number, inMin: number, inMax: number, outMin: number, outMax: number): number {
  const t = Math.max(0, Math.min(1, (v - inMin) / (inMax - inMin)));
  return outMin + t * (outMax - outMin);
}

// ── Directive ─────────────────────────────────────────────

@Injectable()
export class CadUsdOilCorrelationDirective implements IDirective {
  readonly id = 'cad-usd-oil-correlation';
  readonly name = 'CAD/USD Oil Correlation';
  readonly description =
    'Hybrid: continuous DXY base for CAD pairs + oil-price threshold bonuses.';
  readonly category = 'structural' as const;
  readonly priority = 50;
  readonly maxScore = 125; // 100 base + 25 bonus
  readonly minScore = 1;
  readonly minBars = { '1d': 20 };
  readonly version = '2.0.1';
  readonly requiredDataFeeds = ['oil'];
  readonly readiness = 'beta' as const;
  readonly directionBias = 'neutral' as const;

  calculate(input: DirectiveInput): DirectiveResult {
    let dxy = (input as any).dxyValue as number | undefined;
    const eurusd = (input as any).eurusdValue as number | undefined;
    const wti = (input as any).wtiValue as number | undefined;

    const sym = input.symbol.toUpperCase();

    // Only score CAD pairs
    if (!CAD_PAIRS.has(sym)) {
      return {
        signalClass: 'neutral',
        score: 50,
        confidence: 0,
        reason: `${input.symbol} is not a CAD pair — cad-usd-oil-correlation only applies to USDCAD/EURCAD/GBPCAD/AUDCAD/NZDCAD.`,
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
        reason: `No DXY or EURUSD macro data for ${sym}. CAD correlation requires USD strength data. Connect MT5 (EURUSD always available).`,
      };
    }

    // ── BASE (continuous, 0–100) ──────────────────────────
    const isUsdBase = sym === 'USDCAD';
    // DXY 108 (strong USD) → rawBase 0, DXY 95 (weak USD) → rawBase 100
    const rawBase = Math.round(mapRange(dxy, 108, 95, 0, 100));
    // USDCAD: USD is base, so strong USD = bullish for pair → flip
    // Other CAD pairs: USD is quote, strong USD = bearish → rawBase works as-is
    const baseScore = isUsdBase ? 100 - rawBase : rawBase;

    // ── BONUS (threshold-gated, rare events) ─────────────
    let bonusScore = 0;
    let bonusLabel = '';

    if (wti !== undefined && wti > 0 && wti >= OIL_STRONG) {
      bonusScore = 25;
      bonusLabel = `strong oil (WTI=$${wti.toFixed(0)})`;
    }

    // ── Total ─────────────────────────────────────────────
    const totalScore = baseScore + bonusScore;

    let signalClass: 'bullish' | 'bearish' | 'neutral';
    if (totalScore >= 65) signalClass = 'bullish';
    else if (totalScore <= 35) signalClass = 'bearish';
    else signalClass = 'neutral';

    const hasOil = wti !== undefined && wti > 0;
    const confidence = hasOil ? 0.50 : 0.30;

    const parts: string[] = [`base=${baseScore} (${dxySource}=${dxy}, ${isUsdBase ? 'USD base' : 'CAD cross'})`];
    if (bonusScore > 0) parts.push(`+${bonusScore} bonus (${bonusLabel})`);
    parts.push(`= ${totalScore}/${this.maxScore}`);

    return {
      signalClass,
      score: totalScore,
      confidence,
      reason: `${sym}: ${parts.join(' ')}`,
      metadata: { baseScore, bonusScore, bonusLabel, dxy, dxySource, isUsdBase },
    };
  }
}
