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
 * OUT OF SCOPE:  non-CAD symbols score 0 — no constant contribution.
 *
 * ── Removed tier (2026-09-10, #731) ──────────────────────
 * The old "WTI > $85 → +25" bonus was unreachable: no producer writes
 * `wtiValue`, so 25 of the old maxScore 125 were phantom points that inflated
 * every protocol denominator while never being earnable. maxScore 125 → 100,
 * requiredDataFeeds ['oil'] → ['dxy']. Same fix as `gold-macro-correlation`
 * (2026-08-14). Wire a real oil feed before re-adding an oil tier.
 *
 * ── Symbol Coverage ──────────────────────────────────────
 * USDCAD, EURCAD, GBPCAD, AUDCAD, NZDCAD
 *
 * ── Data Sources ─────────────────────────────────────────
 * dxyValue or eurusdValue on DirectiveInput (DXY pipeline, wired in
 * `protocol-gating.service.ts`). `wtiValue` is NOT wired.
 */

import { Injectable } from '@nestjs/common';
import { DirectiveInput, DirectiveResult, IDirective } from '../interfaces/directive.interface';

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
  readonly maxScore = 100; // 2026-09-10 (#731): was 125 with an unreachable +25 oil tier — the class is the single source of truth for weights
  readonly minScore = 0;   // no-signal / out-of-scope = 0, never a midpoint
  readonly minBars = { '1d': 20 };
  readonly version = '2.1.0'; // 2026-09-10: phantom oil tier removed + scoped floors → 0
  readonly requiredDataFeeds = ['dxy']; // 'oil' dropped — nothing writes wtiValue
  readonly readiness = 'beta' as const;
  readonly directionBias = 'neutral' as const;

  calculate(input: DirectiveInput): DirectiveResult {
    let dxy = (input as any).dxyValue as number | undefined;
    const eurusd = (input as any).eurusdValue as number | undefined;
    const sym = input.symbol.toUpperCase();

    // Only score CAD pairs. Out of scope = NO contribution (was a constant 50,
    // which added a phantom half-score to Opportunity for every other symbol).
    if (!CAD_PAIRS.has(sym)) {
      return {
        signalClass: 'neutral',
        score: 0,
        confidence: 0,
        reason: `${input.symbol} is not a CAD pair — cad-usd-oil-correlation applies to USDCAD/EURCAD/GBPCAD/AUDCAD/NZDCAD only.`,
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
        score: 0, // no evidence = no contribution (was a constant 50)
        confidence: 0,
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

    // ── Total ─────────────────────────────────────────────
    // No bonus tier: every earnable point now comes from the DXY base, so the
    // score is comparable across symbols again.
    const totalScore = baseScore;

    let signalClass: 'bullish' | 'bearish' | 'neutral';
    if (totalScore >= 65) signalClass = 'bullish';
    else if (totalScore <= 35) signalClass = 'bearish';
    else signalClass = 'neutral';

    // Confidence reflects evidence quality, not the (removed) oil tier.
    const confidence = 0.30;

    const parts: string[] = [`base=${baseScore} (${dxySource}=${dxy}, ${isUsdBase ? 'USD base' : 'CAD cross'})`];
    parts.push(`= ${totalScore}/${this.maxScore}`);

    return {
      signalClass,
      score: totalScore,
      confidence,
      reason: `${sym}: ${parts.join(' ')}`,
      metadata: { baseScore, dxy, dxySource, isUsdBase },
    };
  }
}
